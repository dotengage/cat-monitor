/**
 * The forecast.
 *
 * Implements the forecasting guide end to end: clean the data, work in marks,
 * weight recent mocks, test the trend for significance rather than eyeballing
 * it, find the binding constraint from variance rather than from the last
 * mock, and replace the single "projected" number with a simulated
 * distribution and a rule-based status.
 *
 * Every number it produces carries the evidence it came from, and where the
 * data cannot support a finding it says so and says what to log next.
 */
import { SECTIONS, SECTION_LABELS } from '../../config/catConfig';
import { daysBetween, formatDate } from '../../domain/date';
import type { AppState, ISODate, SectionKey, TrackStatus } from '../../domain/types';
import { blendCurves, fitCurve, referenceCurve, type Curve } from './curve';
import { cleanData, type CleanMock } from './hygiene';
import { describeContradiction, minePatterns, type PatternReport } from './patterns';
import {
  hashString,
  mean,
  median,
  normal,
  quantile,
  quantileSorted,
  recencyWeights,
  round1,
  sd,
  seededRandom,
  tCritical90,
  variance,
  weightedFit,
  weightedMean,
  weightedPicker,
  weightedSd,
} from './stats';

export { fitCurve } from './curve';
export { cleanData, cleanMock } from './hygiene';
export { PATTERN_LABELS, describeContradiction } from './patterns';
export type { PatternReport, PatternSummary, PatternTag } from './patterns';

/* ------------------------------------------------------------------ */
/* Constants from the guide                                            */
/* ------------------------------------------------------------------ */

const DRAWS = 10_000;
const BOOTSTRAP_WINDOW = 8;
const MIN_FOR_FORECAST = 5;
const MIN_FOR_CONSTRAINT = 3;
const MIN_FOR_TREND = 3;
const DIRECTIONAL_BELOW = 6;
/** Overall spread, in marks, separating FLAT from VOLATILE (rule 4.3). */
const FLAT_SPREAD = 8;
/**
 * A single section's equivalent. If three sections swung independently with
 * equal spread, the paper would swing by root-3 times as much, so one section
 * swinging 8 / root-3 marks is as notable as the paper swinging 8.
 */
const SECTION_FLAT_SPREAD = FLAT_SPREAD / Math.sqrt(3);
const DRIFT_CAP_PER_WEEK = 1.5;
/** Sections carry a third of the paper, and so a third of the drift cap. */
const SECTION_DRIFT_CAP_PER_WEEK = DRIFT_CAP_PER_WEEK / 3;
const TAPER_AFTER_WEEKS = 6;
const TAPER = 0.7;
const PROVIDER_NOISE_POINTS = 3;
/**
 * How far the exam-day reading leans on the real exam's curve. Inside the
 * range your mocks cover, your own curve is good evidence and the two are
 * split evenly. Above your best paper your curve is only extrapolating, so
 * the real exam's takes over across the next REFERENCE_RAMP marks.
 */
const REFERENCE_WEIGHT = 0.5;
const REFERENCE_RAMP = 10;
/**
 * The furthest a bad day falls below the likely percentile. Your worst mock
 * paper is not your worst exam day: the exam is one sitting you have
 * prepared for, without the off days a weekly mock series includes.
 */
const BAD_DAY_DROP = 6;
const HIGH_VARIANCE_SPREAD = 10;
const CLEAN_PAPER_PERCENTILE = 85;
const CLEAN_PAPER_LOW_RATE = 0.5;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type TrendLabel = 'RISING' | 'FALLING' | 'FLAT' | 'VOLATILE' | 'INSUFFICIENT';
export type GapKind = 'CAPABILITY' | 'CONSISTENCY';

export interface Distribution {
  p10: number;
  p50: number;
  p90: number;
}

export interface Level {
  n: number;
  marks: number;
  sd: number;
  low: number;
  high: number;
  percentile?: number;
  percentileLow?: number;
  percentileHigh?: number;
}

export interface TrendAnalysis {
  label: TrendLabel;
  n: number;
  directionalOnly: boolean;
  /** Marks per week, with its 90% interval. */
  slopePerWeek?: number;
  ciLow?: number;
  ciHigh?: number;
  spreadLastFive?: number;
  /** Mean marks of three equal blocks of mocks, oldest first. */
  blocks?: number[];
  blocksRising: boolean;
  leadWithBlocks: boolean;
  summary: string;
}

export interface SectionDiagnostic {
  section: SectionKey;
  n: number;
  mean: number;
  best: number;
  sd: number;
  varianceShare: number;
  ceilingGap: number;
  floorShare: number;
  floorLoss: number;
  floorLevel: number;
  /** Section percentile points per extra mark, at the current level. */
  marginalValue?: number;
  rank: number;
  kind: GapKind;
  why: string;
}

export interface CleanPaper {
  n: number;
  count: number;
  rate: number;
  rule: string;
  combinedBestMarks?: number;
  combinedBestPercentile?: number;
  consistencyHeadline: boolean;
}

export interface Scenario {
  key: 'BAD' | 'LIKELY' | 'GREAT';
  label: string;
  marks: number;
  percentile?: number;
  chance: string;
  conditions: string[];
}

export interface OverallForecast {
  marks: Distribution;
  percentile?: Distribution;
  probability?: number;
  indicative: boolean;
  /** Total drift applied, in marks. */
  drift: number;
  notes: string[];
  window: number;
}

export interface AttemptGuide {
  n: number;
  band?: [number, number];
  accuracyFloor?: number;
  marksPerAttempt?: number;
  marksPer10Accuracy?: number;
}

export interface DilrSets {
  n: number;
  conversion: number;
  marksPerSet: number;
  expected: number[];
}

export interface SectionalCheck {
  n: number;
  latestPercentile?: number;
  averagePercentile?: number;
  difference?: number;
  verdict: string;
}

export interface SectionCard {
  section: SectionKey;
  status: TrackStatus;
  statusRule: string;
  level?: Level;
  latestPercentile?: number;
  recentAveragePercentile?: number;
  recentCount: number;
  trend: TrendAnalysis;
  forecast?: OverallForecast;
  attempts: AttemptGuide;
  dilr?: DilrSets;
  sectional: SectionalCheck;
  diagnostic?: SectionDiagnostic;
  curve?: { method: Curve['method']; pairs: number };
  action: string;
}

export interface HistoryPoint {
  date: ISODate;
  name: string;
  marks?: number;
  percentile?: number;
  analysed: boolean;
}

export interface Forecast {
  target: number;
  daysRemaining: number;
  weeksRemaining: number;
  status: TrackStatus;
  highVariance: boolean;
  statusRule: string;
  confidence: 'none' | 'low' | 'medium' | 'high';
  /** Full mocks with overall marks: the evidence everything below rests on. */
  n: number;
  fullMocks: number;
  analysedMocks: number;
  curve?: {
    method: Curve['method'];
    provisional: boolean;
    pairs: number;
    targetMarks?: number;
    marksPerPointAtTarget?: number;
  };
  level?: Level;
  trend: TrendAnalysis;
  forecast?: OverallForecast;
  scenarios: Scenario[];
  constraint: { established: boolean; top: SectionDiagnostic[]; note: string };
  cleanPaper?: CleanPaper;
  sections: SectionCard[];
  patterns: PatternReport;
  dataQuality: string[];
  headline: string[];
  whatChanged: string[];
  recommendedAction: string;
  history: HistoryPoint[];
  latestPercentile?: number;
  bestPercentile?: number;
  /** Mean overall percentile of the last five full mocks that recorded one. */
  recentAveragePercentile?: number;
  recentAverageCount: number;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export const TREND_WORDS: Record<TrendLabel, string> = {
  RISING: 'Rising',
  FALLING: 'Dipping lately',
  FLAT: 'Steady',
  VOLATILE: 'Up and down',
  INSUFFICIENT: 'Too early to tell',
};

/** What each status is called wherever a person reads it. */
export const STATUS_WORDS: Record<TrackStatus, string> = {
  ON_TRACK: 'On track',
  STRETCH: 'Within reach',
  AT_RISK: 'Closing the gap',
  OFF_TRACK: 'Building up',
  BEHIND: 'Catching up',
  UNCONFIRMED: 'Getting started',
};

const fmt = (n: number, digits = 1) => {
  const factor = 10 ** digits;
  const value = Math.round(n * factor) / factor;
  return Object.is(value, -0) ? '0' : String(value);
};
const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : ''}${fmt(n, digits)}`;
const pct = (share: number) =>
  share < 0.01 ? 'under 1%' : share > 0.99 ? 'over 99%' : `${Math.round(share * 100)}%`;

/** "20" when both ends agree, "18-22" otherwise. */
export function formatBand(band: [number, number]): string {
  return band[0] === band[1] ? String(band[0]) : `${band[0]}-${band[1]}`;
}

function lastFiveAverage(values: (number | undefined)[]): { value?: number; count: number } {
  const recorded = values.filter((v): v is number => typeof v === 'number').slice(-5);
  return { value: recorded.length > 0 ? round1(mean(recorded)) : undefined, count: recorded.length };
}

function blockMeans(values: number[]): number[] {
  const n = values.length;
  const base = Math.floor(n / 3);
  const rem = n % 3;
  const sizes = [base, base + (rem >= 2 ? 1 : 0), base + (rem >= 1 ? 1 : 0)];
  const out: number[] = [];
  let start = 0;
  for (const size of sizes) {
    out.push(mean(values.slice(start, start + size)));
    start += size;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Step 3: current level                                               */
/* ------------------------------------------------------------------ */

export function currentLevel(values: number[], dates: ISODate[], today: ISODate, curve?: Curve | null): Level | undefined {
  if (values.length === 0) return undefined;
  const weights = recencyWeights(dates, today);
  const marks = weightedMean(values, weights);
  const spread = weightedSd(values, weights);
  const level: Level = { n: values.length, marks, sd: spread, low: marks - spread, high: marks + spread };
  if (curve) {
    level.percentile = curve.toPercentile(marks);
    level.percentileLow = curve.toPercentile(level.low);
    level.percentileHigh = curve.toPercentile(level.high);
  }
  return level;
}

/* ------------------------------------------------------------------ */
/* Step 4: trend                                                       */
/* ------------------------------------------------------------------ */

export function analyseTrend(
  points: { date: ISODate; value: number }[],
  today: ISODate,
  flatSpread = FLAT_SPREAD,
): TrendAnalysis {
  const n = points.length;
  const values = points.map((p) => p.value);

  if (n < MIN_FOR_TREND) {
    const summary =
      n === 0
        ? 'No full mocks with marks yet.'
        : n === 1
          ? 'One full mock: no trend yet.'
          : `Two full mocks (${signed(values[1] - values[0], 0)} marks between them): not enough to call a trend yet. One more makes it measurable.`;
    return { label: 'INSUFFICIENT', n, directionalOnly: true, blocksRising: false, leadWithBlocks: false, summary };
  }

  const origin = points[0].date;
  const xs = points.map((p) => daysBetween(origin, p.date));
  const weights = recencyWeights(points.map((p) => p.date), today);
  const fit = weightedFit(xs, values, weights);
  const slopePerWeek = fit.slope * 7;
  const half = fit.se === undefined ? Infinity : tCritical90(fit.df) * fit.se * 7;
  const ciLow = slopePerWeek - half;
  const ciHigh = slopePerWeek + half;

  const lastFive = values.slice(-5);
  const spreadLastFive = Math.max(...lastFive) - Math.min(...lastFive);

  let label: TrendLabel;
  if (ciLow > 0) label = 'RISING';
  else if (ciHigh < 0) label = 'FALLING';
  else label = spreadLastFive < flatSpread ? 'FLAT' : 'VOLATILE';

  const blocks = blockMeans(values);
  const blocksRising = blocks[0] < blocks[1] && blocks[1] < blocks[2];
  const leadWithBlocks = blocksRising && (label === 'FLAT' || label === 'VOLATILE');
  const directionalOnly = n < DIRECTIONAL_BELOW;

  const summary = leadWithBlocks
    ? `Improving: each stretch of mocks averages higher than the last (${blocks.map((b) => fmt(b, 0)).join(', ')} marks), across ${n} full mocks.`
    : `${TREND_WORDS[label]}, about ${signed(slopePerWeek)} marks a week across ${n} full mocks.`;

  return {
    label,
    n,
    directionalOnly,
    slopePerWeek,
    ciLow: Number.isFinite(ciLow) ? ciLow : undefined,
    ciHigh: Number.isFinite(ciHigh) ? ciHigh : undefined,
    spreadLastFive,
    blocks,
    blocksRising,
    leadWithBlocks,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Step 5: binding constraint                                          */
/* ------------------------------------------------------------------ */

function diagnoseSections(
  mocks: CleanMock[],
  today: ISODate,
  curves: Partial<Record<SectionKey, Curve | null>>,
): { established: boolean; all: SectionDiagnostic[]; note: string } {
  // Shares only mean something when every section is measured on the same papers.
  const complete = mocks.filter((m) => SECTIONS.every((s) => m.sections[s]?.marks !== undefined));
  if (complete.length < MIN_FOR_CONSTRAINT) {
    return {
      established: false,
      all: [],
      note: `Not established: needs ${MIN_FOR_CONSTRAINT} full mocks with marks for all three sections (have ${complete.length}). A constraint is never named from fewer.`,
    };
  }

  const weights = recencyWeights(complete.map((m) => m.date), today);
  const series = Object.fromEntries(
    SECTIONS.map((s) => [s, complete.map((m) => m.sections[s]!.marks as number)]),
  ) as Record<SectionKey, number[]>;
  const variances = SECTIONS.map((s) => variance(series[s]));
  const totalVariance = variances.reduce((a, v) => a + v, 0);

  const all = SECTIONS.map((s, i): SectionDiagnostic => {
    const values = series[s];
    const weightedLevel = weightedMean(values, weights);
    const best = Math.max(...values);
    const spread = sd(values);
    const varianceShare = totalVariance === 0 ? 1 / 3 : variances[i] / totalVariance;
    const ceilingGap = best - weightedLevel;
    const q1 = quantile(values, 0.25);
    const bottom = values.filter((v) => v <= q1);
    const sectionMedian = median(values);
    const floorLevel = mean(bottom);
    const curve = curves[s];
    const marginalValue = curve ? 1 / curve.marksPerPoint(curve.toPercentile(weightedLevel)) : undefined;

    /*
     * Rule 5 distinction. Variance does the separating: a capability gap is
     * low-variance by definition, so a section carrying at least its fair
     * third of the paper's swing is a consistency candidate. The ceiling check
     * only confirms there is unrealised upside to recover. It asks for half a
     * standard deviation rather than a whole one because recency weighting
     * pulls the current level towards the latest mock, which can leave a
     * plainly erratic section (3 to 27 marks) just short of a full one.
     */
    const kind: GapKind = varianceShare >= 1 / 3 && ceilingGap >= 0.5 * spread ? 'CONSISTENCY' : 'CAPABILITY';
    const why =
      kind === 'CONSISTENCY'
        ? `${fmt(varianceShare * 100, 0)}% of the paper's swing and a best ${fmt(ceilingGap)} marks above the current level: the marks are there but do not arrive reliably.`
        : `${fmt(varianceShare * 100, 0)}% of the swing with the best only ${fmt(ceilingGap)} marks above the current level: steady, but steadily low.`;

    return {
      section: s,
      n: values.length,
      mean: weightedLevel,
      best,
      sd: spread,
      varianceShare,
      ceilingGap,
      floorShare: bottom.length / values.length,
      floorLoss: sectionMedian - floorLevel,
      floorLevel,
      marginalValue,
      rank: varianceShare * ceilingGap,
      kind,
      why,
    };
  });

  return { established: true, all, note: 'Ranked by variance share times ceiling gap (rule 5).' };
}

function sectionalCheck(section: SectionKey, sectionals: CleanMock[], full: CleanMock[], today: ISODate): SectionalCheck {
  const own = sectionals.filter((m) => m.section === section && m.sections[section]);
  const percentiles = own.map((m) => m.sections[section]?.percentile);
  const latestPercentile = [...percentiles].reverse().find((p): p is number => typeof p === 'number');
  const averagePercentile = lastFiveAverage(percentiles).value;

  const sectionalMarks = own.filter((m) => m.sections[section]?.marks !== undefined);
  const fullMarks = full.filter((m) => m.sections[section]?.marks !== undefined);
  if (sectionalMarks.length < 2 || fullMarks.length < 2) {
    return {
      n: own.length,
      latestPercentile,
      averagePercentile,
      verdict:
        own.length === 0
          ? `No ${SECTION_LABELS[section]} sectionals recorded.`
          : `Too few ${SECTION_LABELS[section]} sectionals with marks to compare against full mocks.`,
    };
  }

  const sMean = weightedMean(
    sectionalMarks.map((m) => m.sections[section]!.marks as number),
    recencyWeights(sectionalMarks.map((m) => m.date), today),
  );
  const fMean = weightedMean(
    fullMarks.map((m) => m.sections[section]!.marks as number),
    recencyWeights(fullMarks.map((m) => m.date), today),
  );
  const difference = sMean - fMean;
  const material = Math.max(3, fMean * 0.1);

  const verdict =
    difference >= material
      ? `Sectionals average ${fmt(sMean)} marks against ${fmt(fMean)} in full mocks (${signed(difference)}). The gap is execution under full-paper conditions, not knowledge.`
      : difference <= -material
        ? `Sectionals average ${fmt(sMean)} marks, below the ${fmt(fMean)} in full mocks. Sectionals are not showing hidden upside.`
        : `Sectionals (${fmt(sMean)}) and full mocks (${fmt(fMean)}) agree within ${fmt(material)} marks.`;

  return { n: own.length, latestPercentile, averagePercentile, difference, verdict };
}

function cleanPaperRate(
  mocks: CleanMock[],
  overallCurve: Curve | null,
  target: number,
  rising: boolean,
): CleanPaper | undefined {
  const complete = mocks.filter((m) => SECTIONS.every((s) => m.sections[s]?.marks !== undefined));
  if (complete.length === 0) return undefined;

  const p60 = Object.fromEntries(
    SECTIONS.map((s) => [s, quantile(complete.map((m) => m.sections[s]!.marks as number), 0.6)]),
  ) as Record<SectionKey, number>;

  const clean = complete.filter((m) =>
    SECTIONS.every((s) => {
      const sec = m.sections[s]!;
      return sec.percentile !== undefined ? sec.percentile >= CLEAN_PAPER_PERCENTILE : (sec.marks as number) >= p60[s];
    }),
  );

  const bests = SECTIONS.map((s) => Math.max(...complete.map((m) => m.sections[s]!.marks as number)));
  const combinedBestMarks = bests.reduce((a, v) => a + v, 0);
  const combinedBestPercentile = overallCurve ? overallCurve.toPercentile(combinedBestMarks) : undefined;
  const rate = clean.length / complete.length;

  return {
    n: complete.length,
    count: clean.length,
    rate,
    rule: `A clean paper has every section at ${CLEAN_PAPER_PERCENTILE}+ percentile, or at or above that section's own 60th percentile of marks where percentile was not recorded.`,
    combinedBestMarks,
    combinedBestPercentile,
    /*
     * Not when marks are rising significantly. In a steady climb every best
     * comes from the latest paper and the early papers sit below each
     * section's own 60th percentile, so the rate looks low - but that is
     * improvement, not inconsistency, and calling it a consistency problem
     * would send someone who is climbing to fix the wrong thing.
     */
    consistencyHeadline:
      !rising && combinedBestPercentile !== undefined && combinedBestPercentile >= target && rate < CLEAN_PAPER_LOW_RATE,
  };
}

/* ------------------------------------------------------------------ */
/* Step 6: simulation                                                  */
/* ------------------------------------------------------------------ */

interface DriftDecision {
  perWeek: number;
  total: number;
  note: string;
}

function decideDrift(
  trend: TrendAnalysis,
  points: { date: ISODate; value: number }[],
  today: ISODate,
  weeksRemaining: number,
  cap: number,
): DriftDecision {
  if (trend.label !== 'RISING' && trend.label !== 'FALLING') {
    return {
      perWeek: 0,
      total: 0,
      note:
        trend.label === 'INSUFFICIENT'
          ? 'No drift applied: too few mocks to measure a trend.'
          : 'No drift applied: the trend interval includes zero, so improvement is not established.',
    };
  }

  const slope = trend.slopePerWeek ?? 0;
  const taper = weeksRemaining > TAPER_AFTER_WEEKS ? TAPER : 1;
  let perWeek: number;
  let note: string;

  if (slope > 0) {
    // Realised rate: what actually happened over the last eight weeks.
    const recent = points.filter((p) => daysBetween(p.date, today) <= 56);
    const realised =
      recent.length >= 2
        ? weightedFit(
            recent.map((p) => daysBetween(recent[0].date, p.date)),
            recent.map((p) => p.value),
          ).slope * 7
        : 0;
    perWeek = Math.min(slope, Math.max(0, realised), cap);
    note =
      perWeek < slope
        ? `Drift capped at ${fmt(perWeek, 2)} marks a week (trend ${fmt(slope, 2)}; realised over 8 weeks ${fmt(realised, 2)}; cap ${fmt(cap, 2)}).`
        : `Drift of ${fmt(perWeek, 2)} marks a week from the trend.`;
  } else {
    perWeek = Math.max(slope, -cap);
    note = `Falling trend applied at ${fmt(perWeek, 2)} marks a week.`;
  }

  if (taper < 1) note += ` Tapered by ${TAPER} because more than ${TAPER_AFTER_WEEKS} weeks remain.`;
  return { perWeek, total: perWeek * weeksRemaining * taper, note };
}

interface SimulationInput {
  best: number;
  trend: TrendAnalysis;
  drift: DriftDecision;
  noise: number;
  curve: Curve | null;
  target: number;
}

function summarise(sorted: number[]): Distribution {
  return {
    p10: quantileSorted(sorted, 0.1),
    p50: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
  };
}

/**
 * Turns raw marks draws into a guarded forecast (rules 6.5 to 6.7). The draws
 * are adjusted, not just the summary numbers, so the probability shown always
 * agrees with the band shown.
 */
function finish(draws: number[], input: SimulationInput, n: number, unanalysedNote?: string): OverallForecast {
  const notes: string[] = [input.drift.note];
  let adjusted = [...draws].sort((a, b) => a - b);

  const p50 = quantileSorted(adjusted, 0.5);
  if (input.trend.label !== 'RISING' && p50 > input.best) {
    const shift = input.best - p50;
    adjusted = adjusted.map((v) => v + shift);
    notes.push(`Likely value held to your demonstrated best (${fmt(input.best)} marks): the trend does not show significant improvement.`);
  }

  const indicative = n < MIN_FOR_FORECAST;
  if (indicative) {
    const centre = quantileSorted(adjusted, 0.5);
    adjusted = adjusted.map((v) => centre + (v - centre) * 1.5);
    notes.push(`Band widened by half and labelled indicative: only ${n} full mock${n === 1 ? '' : 's'} (fewer than ${MIN_FOR_FORECAST}).`);
  }
  if (unanalysedNote) notes.push(unanalysedNote);

  const marks = summarise(adjusted);
  if (!input.curve) return { marks, indicative, drift: input.drift.total, notes, window: Math.min(n, BOOTSTRAP_WINDOW) };

  const curve = input.curve;
  const middle = curve.toPercentile(marks.p50);
  const floorPercentile = middle - BAD_DAY_DROP;
  const floorMarks = curve.toMarks(floorPercentile);
  adjusted = adjusted.map((v) => Math.max(v, floorMarks));
  marks.p10 = Math.max(marks.p10, floorMarks);
  const percentiles = adjusted.map((v) => Math.max(floorPercentile, curve.toPercentile(v)));
  const hits = percentiles.filter((p) => p >= input.target).length;
  return {
    marks,
    percentile: summarise(percentiles),
    probability: hits / percentiles.length,
    indicative,
    drift: input.drift.total,
    notes,
    window: Math.min(n, BOOTSTRAP_WINDOW),
  };
}

/* ------------------------------------------------------------------ */
/* Step 7: status                                                      */
/* ------------------------------------------------------------------ */

export function statusFromGap(target: number, p50: number, spread: number): { status: TrackStatus; highVariance: boolean; rule: string } {
  const gap = target - p50;
  const status: TrackStatus = gap <= 1 ? 'ON_TRACK' : gap <= 4 ? 'STRETCH' : gap <= 8 ? 'AT_RISK' : 'OFF_TRACK';
  const highVariance = spread > HIGH_VARIANCE_SPREAD;
  const rule = gap <= 0 ? `At or above ${fmt(target)} on a typical day.` : `About ${fmt(gap)} points to go to ${fmt(target)}.`;
  return { status, highVariance, rule };
}

/**
 * The one-line read of a status, written to be acted on rather than feared:
 * where you are, how far there is to go, and that the distance is closable.
 */
export function encouragement(status: TrackStatus, target: number, likely?: number): string {
  const gap = likely === undefined ? undefined : Math.max(0, target - likely);
  const toGo = gap === undefined ? '' : ` about ${fmt(gap)} points to go`;
  switch (status) {
    case 'ON_TRACK':
      return `You are on course for ${target}. Keep the routine that got you here.`;
    case 'STRETCH':
      return `${target} is within reach:${toGo}. A few strong papers close this.`;
    case 'AT_RISK':
      return `You are closing in on ${target}:${toGo}. Every analysed mock moves you closer.`;
    case 'OFF_TRACK':
    case 'BEHIND':
      return `You are building towards ${target}:${toGo}. Steady gains add up quickly from here.`;
    default:
      return 'Take a full mock and record its marks and percentile to see where you stand.';
  }
}

/* ------------------------------------------------------------------ */
/* Step 9: attempt and accuracy bands                                  */
/* ------------------------------------------------------------------ */

function attemptGuide(section: SectionKey, mocks: CleanMock[]): AttemptGuide {
  const rows = mocks
    .map((m) => m.sections[section])
    .filter((s): s is NonNullable<typeof s> => s?.marks !== undefined && s.attempts !== undefined);
  if (rows.length < 3) return { n: rows.length };

  const top = [...rows].sort((a, b) => (b.marks as number) - (a.marks as number)).slice(0, Math.max(1, Math.ceil(rows.length / 3)));
  const attempts = top.map((r) => r.attempts as number);
  const accuracies = top.map((r) => r.accuracy).filter((a): a is number => a !== undefined);

  const byAttempts = weightedFit(rows.map((r) => r.attempts as number), rows.map((r) => r.marks as number));
  const withAccuracy = rows.filter((r) => r.accuracy !== undefined);
  const byAccuracy =
    withAccuracy.length >= 3
      ? weightedFit(withAccuracy.map((r) => (r.accuracy as number) * 100), withAccuracy.map((r) => r.marks as number))
      : undefined;

  return {
    n: rows.length,
    band: [Math.min(...attempts), Math.max(...attempts)],
    accuracyFloor: accuracies.length > 0 ? Math.floor((Math.min(...accuracies) * 100) / 5) * 5 : undefined,
    marksPerAttempt: byAttempts.slope,
    marksPer10Accuracy: byAccuracy ? byAccuracy.slope * 10 : undefined,
  };
}

function dilrSets(mocks: CleanMock[]): DilrSets | undefined {
  const rows = mocks.filter(
    (m) => m.setsAttempted !== undefined && m.setsSolved !== undefined && m.sections.DILR?.marks !== undefined,
  );
  if (rows.length < 3) return undefined;
  const attempted = rows.reduce((a, m) => a + (m.setsAttempted as number), 0);
  const solved = rows.reduce((a, m) => a + (m.setsSolved as number), 0);
  const fit = weightedFit(rows.map((m) => m.setsSolved as number), rows.map((m) => m.sections.DILR!.marks as number));
  return {
    n: rows.length,
    conversion: attempted === 0 ? 0 : solved / attempted,
    marksPerSet: fit.slope,
    expected: [0, 1, 2, 3].map((k) => Math.max(0, fit.intercept + fit.slope * k)),
  };
}

/* ------------------------------------------------------------------ */
/* Section actions                                                     */
/* ------------------------------------------------------------------ */

/**
 * One action per section, and never the same advice twice: each branch is
 * written for what that section's marks are actually made of - passages in
 * VARC, sets in DILR, individual questions in QA - and filled with that
 * section's own numbers.
 */
function sectionAction(card: Omit<SectionCard, 'action'>, conceptGap: boolean): string {
  const s = card.section;
  const band = card.attempts.band ? formatBand(card.attempts.band) : undefined;
  const floor = card.attempts.accuracyFloor;
  const d = card.diagnostic;

  if (!card.level) {
    return `Record ${SECTION_LABELS[s]} marks, attempts and percentile in your next full mock; there is nothing to judge ${SECTION_LABELS[s]} on yet.`;
  }

  const sectionalGap = card.sectional.difference ?? 0;
  if (sectionalGap >= Math.max(3, card.level.marks * 0.1)) {
    if (s === 'VARC') return `Your VARC sectionals run ${fmt(sectionalGap)} marks ahead of full-mock VARC. Take VARC with exactly the passage-selection rules you use in sectionals, and take it first.`;
    if (s === 'DILR') return `Your DILR sectionals run ${fmt(sectionalGap)} marks ahead of full-mock DILR. In full mocks, spend the first five minutes choosing two sets and do not switch once committed.`;
    return `Your QA sectionals run ${fmt(sectionalGap)} marks ahead of full-mock QA. In full mocks, do a first pass of only the questions you can start immediately, then return; late-paper fatigue is costing marks.`;
  }

  if (d?.kind === 'CONSISTENCY') {
    if (s === 'VARC') return `VARC swings ${fmt(d.sd)} marks between papers with a best of ${fmt(d.best, 0)}. Fix your RC count${band ? ` (${band} attempts)` : ''} and drop any passage that is not clear after the first read.`;
    if (s === 'DILR') return `DILR has reached ${fmt(d.best, 0)} marks but sits at ${fmt(d.mean)} now. Commit to two sets and leave any set with no progress after twelve minutes.`;
    return `QA swings ${fmt(d.sd)} marks with a best of ${fmt(d.best, 0)}. Keep attempts at ${band ?? 'a fixed number'} and skip any question you cannot start within ninety seconds.`;
  }

  if (card.status === 'ON_TRACK') {
    if (s === 'VARC') return `Hold VARC${band ? ` at ${band} attempts` : ''}${floor ? ` with accuracy above ${floor}%` : ''}. Protect it with daily reading; it needs no extra hours.`;
    if (s === 'DILR') return `Hold DILR at its current set count${card.dilr ? ` (${fmt(card.dilr.conversion * 100, 0)}% of attempted sets solved)` : ''}. Practise set selection, not new set types.`;
    return `Hold QA${band ? ` at ${band} attempts` : ''}${floor ? ` with accuracy above ${floor}%` : ''}. Keep one timed QA drill a week to stay sharp.`;
  }

  if (conceptGap) {
    if (s === 'VARC') return 'Your notes point to concept gaps: rebuild VARC reading foundations with daily RC and a written reason for every wrong option.';
    if (s === 'DILR') return 'Your notes point to concept gaps: work one untimed DILR set per set type you score zero on, then retime it.';
    return 'Your notes point to concept gaps: rebuild the QA topics behind recent errors one at a time, with timed questions after each.';
  }

  if (s === 'VARC') return `Raise VARC accuracy${floor ? ` to at least ${floor}%` : ''}${band ? ` at ${band} attempts` : ''} before attempting more questions; wrong answers are costing more than skipped ones.`;
  if (s === 'DILR') {
    return card.dilr
      ? `Convert more DILR sets: ${fmt(card.dilr.conversion * 100, 0)}% of attempted sets are solved, and each solved set is worth about ${fmt(card.dilr.marksPerSet)} marks. Aim for one more fully solved set per paper.`
      : 'Record DILR sets attempted and solved in each mock; sets, not questions, are the unit DILR is won in.';
  }
  return `Hold QA attempts${band ? ` at ${band}` : ''} and lift accuracy${floor ? ` to ${floor}%` : ''}; fewer, surer questions beat volume.`;
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function sectionCurve(mocks: CleanMock[], section: SectionKey): Curve | null {
  return fitCurve(
    mocks
      .map((m) => m.sections[section])
      .filter((s): s is NonNullable<typeof s> => s?.marks !== undefined && s.percentile !== undefined)
      .map((s) => ({ marks: s.marks as number, percentile: s.percentile as number })),
  );
}

interface SeriesParams {
  drift: number;
  noise: number;
  /** Marks a week by which an older paper is brought up (or down) to today's level. */
  catchUp: number;
}

/**
 * How far a past paper understates today's level. With an established trend
 * an older mock is evidence about who you were then, not now: resampled at
 * face value it drags exam day back towards last month. Only the measured,
 * backward-looking trend is used here; the forward drift is capped separately.
 */
function catchUpRate(trend: TrendAnalysis, cap: number): number {
  const slope = trend.label === 'RISING' || trend.label === 'FALLING' ? trend.slopePerWeek ?? 0 : 0;
  return Math.max(-cap, Math.min(cap, slope));
}

function simulate(
  recent: CleanMock[],
  weights: number[],
  weeksAgo: number[],
  seed: number,
  overall: SeriesParams,
  sections: Record<SectionKey, SeriesParams>,
): { overall: number[]; sections: Record<SectionKey, number[]> } {
  const random = seededRandom(seed);
  const pick = weightedPicker(weights, random);
  const out = { overall: [] as number[], sections: { VARC: [], DILR: [], QA: [] } as Record<SectionKey, number[]> };

  // Whole mocks are resampled, never sections independently: a bad VARC day
  // and a bad QA day tend to be the same day, and summing independent worst
  // cases would badly understate how low a bad paper can go.
  for (let i = 0; i < DRAWS; i += 1) {
    const index = pick();
    const mock = recent[index];
    const age = weeksAgo[index];
    out.overall.push((mock.marks as number) + overall.catchUp * age + overall.drift + normal(random) * overall.noise);
    for (const s of SECTIONS) {
      const marks = mock.sections[s]?.marks;
      if (marks !== undefined) {
        out.sections[s].push(marks + sections[s].catchUp * age + sections[s].drift + normal(random) * sections[s].noise);
      }
    }
  }
  return out;
}

const cache = new WeakMap<AppState, Map<string, Forecast>>();

export function calculateForecast(state: AppState, today: ISODate): Forecast {
  const perState = cache.get(state) ?? new Map<string, Forecast>();
  cache.set(state, perState);
  const hit = perState.get(today);
  if (hit) return hit;

  const result = buildForecast(state, today, true);
  perState.set(today, result);
  return result;
}

function buildForecast(state: AppState, today: ISODate, compare: boolean): Forecast {
  const target = state.profile.targetPercentile;
  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));
  const weeksRemaining = daysRemaining / 7;
  const data = cleanData(state.mocks);
  const { full, marked, sectionals } = data;
  const n = marked.length;
  const patterns = minePatterns(full);

  const history: HistoryPoint[] = full.map((m) => ({
    date: m.date,
    name: m.name,
    marks: m.marks,
    percentile: m.percentile,
    analysed: m.analysed,
  }));
  const percentiles = full.map((m) => m.percentile);
  const recorded = percentiles.filter((p): p is number => typeof p === 'number');
  const recentAverage = lastFiveAverage(percentiles);

  const overallCurve = fitCurve(
    marked.filter((m) => m.percentile !== undefined).map((m) => ({ marks: m.marks as number, percentile: m.percentile as number })),
  );
  // Exam day is the real CAT, so its marks are read partly on the real
  // exam's scale. Current level stays on your mocks' own scale.
  const bestMarks = marked.length > 0 ? Math.max(...marked.map((m) => m.marks as number)) : 0;
  const examCurve = overallCurve
    ? blendCurves(overallCurve, referenceCurve, (m) =>
        m <= bestMarks ? REFERENCE_WEIGHT : REFERENCE_WEIGHT + ((1 - REFERENCE_WEIGHT) * (m - bestMarks)) / REFERENCE_RAMP,
      )
    : null;
  const curves = Object.fromEntries(SECTIONS.map((s) => [s, sectionCurve(marked, s)])) as Record<SectionKey, Curve | null>;

  const points = marked.map((m) => ({ date: m.date, value: m.marks as number }));
  const trend = analyseTrend(points, today);
  const level = currentLevel(points.map((p) => p.value), points.map((p) => p.date), today, overallCurve);

  const window = marked.slice(-BOOTSTRAP_WINDOW);
  const unanalysedRecent = window.filter((m) => !m.analysed).length;
  const unanalysedNote =
    window.length > 0 && unanalysedRecent > window.length / 3
      ? `Forecast weakened: ${unanalysedRecent} of the last ${window.length} mocks are unanalysed, so roughly ${Math.round((unanalysedRecent / window.length) * 100)}% of the evidence has no error analysis behind it.`
      : undefined;

  const confidence: Forecast['confidence'] =
    n === 0 ? 'none' : n < MIN_FOR_FORECAST ? 'low' : n < BOOTSTRAP_WINDOW || unanalysedNote ? 'medium' : 'high';

  /* ---- Constraint and clean paper ---- */
  const diagnosis = diagnoseSections(marked, today, curves);
  // A section only binds if it actually stands out. When every section is
  // steady at its best the ranks are all zero, and naming one would be arbitrary.
  const top = [...diagnosis.all]
    .filter((d) => d.rank > 0.01)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 2);
  if (diagnosis.established && top.length === 0) {
    diagnosis.note = 'No section stands out: none carries both an above-average share of the swing and unrealised upside.';
  }
  const cleanPaper = cleanPaperRate(marked, overallCurve, target, trend.label === 'RISING');

  /* ---- Simulation ---- */
  let forecast: OverallForecast | undefined;
  const sectionForecasts: Partial<Record<SectionKey, OverallForecast>> = {};
  const sectionTrends = {} as Record<SectionKey, TrendAnalysis>;
  const sectionPoints = {} as Record<SectionKey, { date: ISODate; value: number }[]>;
  for (const s of SECTIONS) {
    sectionPoints[s] = marked
      .filter((m) => m.sections[s]?.marks !== undefined)
      .map((m) => ({ date: m.date, value: m.sections[s]!.marks as number }));
    sectionTrends[s] = analyseTrend(sectionPoints[s], today, SECTION_FLAT_SPREAD);
  }

  if (n > 0) {
    const weights = recencyWeights(window.map((m) => m.date), today);
    const overallDrift = decideDrift(trend, points, today, weeksRemaining, DRIFT_CAP_PER_WEEK);
    const overallNoise = overallCurve
      ? PROVIDER_NOISE_POINTS * overallCurve.marksPerPoint(level?.percentile ?? target)
      : 0;

    const sectionParams = {} as Record<SectionKey, SeriesParams>;
    const sectionDrifts = {} as Record<SectionKey, DriftDecision>;
    for (const s of SECTIONS) {
      sectionDrifts[s] = decideDrift(sectionTrends[s], sectionPoints[s], today, weeksRemaining, SECTION_DRIFT_CAP_PER_WEEK);
      const curve = curves[s];
      const sectionLevel = currentLevel(sectionPoints[s].map((p) => p.value), sectionPoints[s].map((p) => p.date), today, curve);
      sectionParams[s] = {
        drift: sectionDrifts[s].total,
        catchUp: catchUpRate(sectionTrends[s], SECTION_DRIFT_CAP_PER_WEEK),
        noise: curve
          ? PROVIDER_NOISE_POINTS * curve.marksPerPoint(sectionLevel?.percentile ?? target)
          : overallNoise / Math.sqrt(3),
      };
    }

    const seed = hashString(`${today}|${window.map((m) => `${m.date}:${m.marks}:${SECTIONS.map((s) => m.sections[s]?.marks ?? '').join(',')}`).join('|')}`);
    const weeksAgo = window.map((m) => daysBetween(m.date, today) / 7);
    const draws = simulate(
      window,
      weights,
      weeksAgo,
      seed,
      { drift: overallDrift.total, noise: overallNoise, catchUp: catchUpRate(trend, DRIFT_CAP_PER_WEEK) },
      sectionParams,
    );

    forecast = finish(
      draws.overall,
      { best: Math.max(...points.map((p) => p.value)), trend, drift: overallDrift, noise: overallNoise, curve: examCurve, target },
      n,
      unanalysedNote,
    );

    for (const s of SECTIONS) {
      if (draws.sections[s].length === 0 || sectionPoints[s].length === 0) continue;
      sectionForecasts[s] = finish(
        draws.sections[s],
        {
          best: Math.max(...sectionPoints[s].map((p) => p.value)),
          trend: sectionTrends[s],
          drift: sectionDrifts[s],
          noise: sectionParams[s].noise,
          curve: curves[s],
          target,
        },
        sectionPoints[s].length,
      );
    }
  }

  /* ---- Overall status ---- */
  let status: TrackStatus = 'UNCONFIRMED';
  let highVariance = false;
  let statusRule: string;
  if (n === 0) {
    statusRule =
      full.length === 0
        ? 'Take a full mock to see where you stand.'
        : 'Record overall marks for your full mocks to see where you stand.';
  } else if (!forecast?.percentile) {
    statusRule = 'Record marks and percentile for two full mocks to see your exam-day percentile.';
  } else {
    const p = forecast.percentile;
    const decided = statusFromGap(target, p.p50, p.p90 - p.p10);
    status = decided.status;
    highVariance = decided.highVariance;
    statusRule = decided.rule;
  }

  /* ---- Section cards ---- */
  const sections: SectionCard[] = SECTIONS.map((s) => {
    const curve = curves[s];
    const sectionLevel = currentLevel(sectionPoints[s].map((p) => p.value), sectionPoints[s].map((p) => p.date), today, curve);
    const sectionPercentiles = full.map((m) => m.sections[s]?.percentile);
    const latestPercentile = [...sectionPercentiles].reverse().find((p): p is number => typeof p === 'number');
    const recent = lastFiveAverage(sectionPercentiles);
    const sectionForecast = sectionForecasts[s];

    let sectionStatus: TrackStatus = 'UNCONFIRMED';
    let sectionRule: string;
    if (!sectionLevel) {
      sectionRule = `Record ${SECTION_LABELS[s]} marks in your next full mock.`;
    } else if (!sectionForecast?.percentile) {
      sectionRule = `Record ${SECTION_LABELS[s]} marks and percentile in two full mocks.`;
    } else {
      const decided = statusFromGap(target, sectionForecast.percentile.p50, sectionForecast.percentile.p90 - sectionForecast.percentile.p10);
      sectionStatus = decided.status;
      sectionRule = decided.rule;
    }

    const base: Omit<SectionCard, 'action'> = {
      section: s,
      status: sectionStatus,
      statusRule: sectionRule,
      level: sectionLevel,
      latestPercentile,
      recentAveragePercentile: recent.value,
      recentCount: recent.count,
      trend: sectionTrends[s],
      forecast: sectionForecast,
      attempts: attemptGuide(s, marked),
      dilr: s === 'DILR' ? dilrSets(marked) : undefined,
      sectional: sectionalCheck(s, sectionals, marked, today),
      diagnostic: diagnosis.all.find((d) => d.section === s),
      curve: curve ? { method: curve.method, pairs: curve.pairs } : undefined,
    };
    return { ...base, action: sectionAction(base, patterns.conceptGapInTopTwo) };
  });

  /* ---- Scenarios ---- */
  const scenarios: Scenario[] = [];
  if (forecast) {
    const averages = sections
      .filter((c) => c.level)
      .map((c) => `${SECTION_LABELS[c.section]} ${fmt(c.level!.marks, 0)}`)
      .join(', ');
    const floorSection = [...diagnosis.all].sort((a, b) => b.floorLoss - a.floorLoss)[0];
    const ceilingSection = [...diagnosis.all].sort((a, b) => b.ceilingGap - a.ceilingGap)[0];
    const values = points.map((p) => p.value);

    const bad = floorSection
      ? [`${SECTION_LABELS[floorSection.section]} has an off day (about ${fmt(floorSection.floorLevel, 0)} marks) while the rest holds.`]
      : [`A paper like your weakest recent mock (${fmt(Math.min(...values.slice(-BOOTSTRAP_WINDOW)), 0)} marks).`];

    const great = ceilingSection
      ? [
          `${SECTION_LABELS[ceilingSection.section]} matches its best (${fmt(ceilingSection.best, 0)} marks).`,
          'The other two sections hold their usual level.',
        ]
      : [`A paper like your best recent mock (${fmt(Math.max(...values.slice(-BOOTSTRAP_WINDOW)), 0)} marks).`];

    const likely = averages ? [`Sections land near their recent level (${averages} marks).`] : ['A typical paper by your recent standard.'];

    const pctl = forecast.percentile;
    scenarios.push(
      { key: 'BAD', label: 'Off day', marks: forecast.marks.p10, percentile: pctl?.p10, chance: 'Your floor', conditions: bad },
      { key: 'LIKELY', label: 'Likely', marks: forecast.marks.p50, percentile: pctl?.p50, chance: 'Your typical paper', conditions: likely },
      { key: 'GREAT', label: 'Great day', marks: forecast.marks.p90, percentile: pctl?.p90, chance: 'When it all clicks', conditions: great },
    );
  }

  /* ---- Data quality ---- */
  const dataQuality = [...data.quality];
  if (unanalysedNote) dataQuality.push(unanalysedNote);
  const unanalysed = full.filter((m) => !m.analysed).length;
  if (unanalysed > 0 && !unanalysedNote) dataQuality.push(`${unanalysed} full mock${unanalysed === 1 ? '' : 's'} unanalysed; their notes are missing from the error patterns.`);
  if (overallCurve?.provisional) {
    dataQuality.push(`Marks-to-percentile mapping is provisional: interpolated from ${overallCurve.pairs} pairs (a fitted curve needs 5).`);
  }
  if (dataQuality.length === 0) {
    dataQuality.push(n === 0 ? 'Nothing to check yet: no full mocks recorded.' : `No data problems found in ${n} full mock${n === 1 ? '' : 's'}.`);
  }

  /* ---- Headline ---- */
  const headline: string[] = [];
  headline.push(encouragement(status, target, forecast?.percentile?.p50));
  if (level) {
    headline.push(
      level.percentile !== undefined
        ? `Current level: about ${fmt(level.percentile)} percentile (${fmt(level.marks, 0)} marks).`
        : `Current level: about ${fmt(level.marks, 0)} marks.`,
    );
  }
  if (forecast?.percentile && forecast.probability !== undefined) {
    const p = forecast.percentile;
    headline.push(
      `Exam day: likely ${fmt(p.p50)} percentile; ${fmt(p.p10)} on an off day, ${fmt(p.p90)} on a great one.`,
      `Chance of reaching ${target}: ${pct(forecast.probability)}.`,
    );
  } else if (forecast) {
    headline.push(`Exam day: likely ${fmt(forecast.marks.p50, 0)} marks.`);
  }
  headline.push(`Trend: ${trend.summary}`);

  /* ---- Recommendation (rule 8.4 governs topic advice) ---- */
  let recommendedAction: string;
  const lead = top[0];
  if (full.length === 0) {
    recommendedAction = 'Take one full-length mock under exam conditions and record marks and percentile for the paper and each section.';
  } else if (n === 0) {
    recommendedAction = 'Record overall marks for each full mock, not just percentile. Every part of the forecast is worked in marks.';
  } else if (!overallCurve) {
    recommendedAction = 'Record the overall percentile for your next full mock. With two marks-and-percentile pairs the forecast can convert marks into percentile.';
  } else if (cleanPaper?.consistencyHeadline) {
    recommendedAction = `Your section bests together already make ${fmt(cleanPaper.combinedBestMarks!, 0)} marks, enough for ${target}. The work now is putting them in the same paper${lead ? `, starting with ${SECTION_LABELS[lead.section]}` : ''}: a fixed attempt plan and a firm rule for when to move on.`;
  } else if (diagnosis.established && lead) {
    const card = sections.find((c) => c.section === lead.section)!;
    recommendedAction =
      lead.kind === 'CONSISTENCY'
        ? `${SECTION_LABELS[lead.section]} is where your next marks are: steadier papers there lift the whole score. ${card.action}`
        : `${SECTION_LABELS[lead.section]} is where your next marks are. ${card.action}`;
  } else if (diagnosis.established) {
    recommendedAction = 'No single section is holding the score back. Keep each section inside its attempt band and protect the routine that produced your recent papers.';
  } else {
    const more = MIN_FOR_CONSTRAINT - Math.min(MIN_FOR_CONSTRAINT, n);
    recommendedAction = `Take and analyse ${more || 1} more full mock${more === 1 ? '' : 's'} with section marks recorded, so your focus area can be found.`;
  }

  const result: Forecast = {
    target,
    daysRemaining,
    weeksRemaining,
    status,
    highVariance,
    statusRule,
    confidence,
    n,
    fullMocks: full.length,
    analysedMocks: full.filter((m) => m.analysed).length,
    curve: overallCurve
      ? {
          method: overallCurve.method,
          provisional: overallCurve.provisional,
          pairs: overallCurve.pairs,
          targetMarks: examCurve!.toMarks(target),
          marksPerPointAtTarget: examCurve!.marksPerPoint(target),
        }
      : undefined,
    level,
    trend,
    forecast,
    scenarios,
    constraint: { established: diagnosis.established, top, note: diagnosis.note },
    cleanPaper,
    sections,
    patterns,
    dataQuality,
    headline,
    whatChanged: [],
    recommendedAction,
    history,
    latestPercentile: recorded[recorded.length - 1],
    bestPercentile: recorded.length > 0 ? Math.max(...recorded) : undefined,
    recentAveragePercentile: recentAverage.value,
    recentAverageCount: recentAverage.count,
  };

  if (compare) result.whatChanged = whatChanged(state, today, result, marked);
  return result;
}

/* ------------------------------------------------------------------ */
/* What changed (output block 2)                                       */
/* ------------------------------------------------------------------ */

function whatChanged(state: AppState, today: ISODate, now: Forecast, marked: CleanMock[]): string[] {
  if (marked.length < 2) return ['First report: there is no earlier forecast to compare against.'];
  const latest = marked[marked.length - 1];
  const before = buildForecast({ ...state, mocks: state.mocks.filter((m) => m.id !== latest.id) }, today, false);
  const lines: string[] = [`Since ${latest.name} (${formatDate(latest.date)}):`];

  if (now.level && before.level) {
    const a = before.level.percentile;
    const b = now.level.percentile;
    lines.push(
      a !== undefined && b !== undefined
        ? `Current level moved from ${fmt(a)} to ${fmt(b)} percentile (${signed(now.level.marks - before.level.marks)} marks).`
        : `Current level moved from ${fmt(before.level.marks)} to ${fmt(now.level.marks)} marks.`,
    );
  }
  const p0 = before.forecast?.percentile?.p50;
  const p1 = now.forecast?.percentile?.p50;
  if (p0 !== undefined && p1 !== undefined && fmt(p0) !== fmt(p1)) {
    lines.push(`Likely exam-day percentile moved from ${fmt(p0)} to ${fmt(p1)}.`);
  }
  const c0 = before.forecast?.probability;
  const c1 = now.forecast?.probability;
  if (c0 !== undefined && c1 !== undefined) {
    lines.push(
      pct(c0) === pct(c1)
        ? `Chance of ${now.target} holding at ${pct(c1)}.`
        : `Chance of ${now.target} moved from ${pct(c0)} to ${pct(c1)}.`,
    );
  }
  if (before.status !== now.status) lines.push(`Status moved from ${STATUS_WORDS[before.status]} to ${STATUS_WORDS[now.status]}.`);
  if (before.trend.label !== now.trend.label) {
    lines.push(`Trend moved from ${TREND_WORDS[before.trend.label].toLowerCase()} to ${TREND_WORDS[now.trend.label].toLowerCase()}.`);
  }
  return lines;
}

/** Re-exported for the UI: a forecast's patterns as readable sentences. */
export function contradictionText(forecast: Forecast): string[] {
  return forecast.patterns.contradictions.map(describeContradiction);
}

export const forecastConstants = { DRAWS, BOOTSTRAP_WINDOW, MIN_FOR_FORECAST };
