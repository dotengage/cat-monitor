/**
 * CAT readiness, trajectory and mock cadence.
 *
 * Deliberately qualitative. There is no honest way to convert five mocks into
 * "87.32% chance of 96 percentile", so this module produces evidence-based
 * labels (ON TRACK / AT RISK / BEHIND / UNCONFIRMED) plus the reasoning behind
 * them, and never a fabricated probability.
 */
import { PHASE_THRESHOLDS, SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { addDays, daysBetween } from '../domain/date';
import type {
  AppState,
  ISODate,
  SectionKey,
  SectionReadiness,
  TrackStatus,
  Trajectory,
  Trend,
} from '../domain/types';
import {
  clamp,
  coverageBySection,
  daysToExam,
  errorRecurrence,
  fullMocks,
  overallPercentileHistory,
  sectionPercentileHistory,
  sectionStats,
  stdev,
  topicStats,
  unanalysedMocks,
  weaknessScores,
  weeklySlope,
} from './derive';

/**
 * Improvement flattens as percentiles rise, and a trend is only evidence for
 * so long. We damp the observed slope and credit at most TRUST_WEEKS of
 * continued improvement, so a steep early trend cannot silently declare a
 * distant target "already achieved".
 */
const PROJECTION_DAMPING = 0.6;
const TRUST_WEEKS = 4;
const PERCENTILE_CEILING = 99.5;

export function classifyTrend(history: { date: ISODate; percentile: number }[]): Trend {
  if (history.length < 2) return 'UNKNOWN';
  const recent = history.slice(-6);
  const slope = weeklySlope(recent);
  const values = recent.map((h) => h.percentile);
  const spread = stdev(values);
  if (spread > 8 && Math.abs(slope) < 1.2) return 'VOLATILE';
  if (slope >= 0.4) return 'IMPROVING';
  if (slope <= -0.4) return 'DECLINING';
  return 'FLAT';
}

/** Noise-reduced current position: weights the most recent mocks highest. */
function smoothedCurrent(history: { percentile: number }[]): number {
  const tail = history.slice(-3);
  if (tail.length === 1) return tail[0].percentile;
  const weights = tail.length === 2 ? [0.35, 0.65] : [0.15, 0.3, 0.55];
  return tail.reduce((acc, h, i) => acc + h.percentile * weights[i], 0);
}

export function calculateTrajectory(state: AppState, today: ISODate): Trajectory {
  const target = state.profile.targetPercentile;
  const daysRemaining = daysToExam(state, today);
  const history = overallPercentileHistory(state);
  const weaknesses = weaknessScores(state, today);
  const constraint = SECTIONS.reduce((a, b) => (weaknesses[b] > weaknesses[a] ? b : a), SECTIONS[0]);

  if (history.length === 0) {
    return {
      status: 'UNCONFIRMED',
      confidence: 'none',
      target,
      trend: 'UNKNOWN',
      daysRemaining,
      constraint: undefined,
      reason:
        'No full mock has been recorded yet, so there is no basis for judging whether the target is realistic. Feasibility stays unconfirmed until a baseline exists.',
      recommendedAction: 'Take one full-length mock under exam conditions and record the sectional breakdown.',
      history,
    };
  }

  const current = history[history.length - 1].percentile;
  const trend = classifyTrend(history);
  const weeksRemaining = daysRemaining / 7;

  if (history.length === 1) {
    const gap = target - current;
    const status: TrackStatus = gap <= 0 ? 'ON_TRACK' : gap <= 14 ? 'AT_RISK' : 'BEHIND';
    return {
      status,
      confidence: 'low',
      current,
      target,
      projected: undefined,
      trend: 'UNKNOWN',
      daysRemaining,
      requiredImprovement: Math.max(0, gap),
      constraint,
      reason:
        gap <= 0
          ? `A single mock at ${fmt(current)} percentile already meets the target, but one data point is not a trend. Treat this as a provisional reading.`
          : `A single baseline at ${fmt(current)} percentile leaves a gap of ${fmt(gap)} percentile points with ${daysRemaining} days to go. One mock cannot establish a trend yet.`,
      recommendedAction:
        `Record a second mock within the next 10-14 days so a trend exists. In the meantime, work on ${SECTION_LABELS[constraint]}, the current constraint.`,
      history,
    };
  }

  const slope = weeklySlope(history.slice(-6));
  const smoothed = smoothedCurrent(history);
  const damping = slope > 0 ? PROJECTION_DAMPING : 0.5;
  const creditedWeeks = slope > 0 ? Math.min(weeksRemaining, TRUST_WEEKS) : weeksRemaining;
  const projected = clamp(smoothed + slope * creditedWeeks * damping, 0, PERCENTILE_CEILING);
  const gap = target - projected;
  const band = state.settings.planning.atRiskBand;

  let status: TrackStatus;
  if (gap <= 0) status = 'ON_TRACK';
  else if (gap <= band + 3) status = 'AT_RISK';
  else status = 'BEHIND';

  const confidence: Trajectory['confidence'] =
    history.length >= 5 ? 'high' : history.length >= 3 ? 'medium' : 'low';

  const trendText =
    trend === 'IMPROVING'
      ? `improving at roughly ${fmt(slope)} percentile points per week`
      : trend === 'DECLINING'
        ? `declining at roughly ${fmt(Math.abs(slope))} percentile points per week`
        : trend === 'VOLATILE'
          ? 'unstable between mocks'
          : 'flat';

  let reason: string;
  let recommendedAction: string;
  if (status === 'ON_TRACK') {
    reason = `Recent mock performance (${fmt(current)} percentile, ${trendText}) is consistent with the ${target} percentile target over the remaining ${daysRemaining} days.`;
    recommendedAction = `Shift emphasis from new learning towards consistency, section balance and mock analysis. ${SECTION_LABELS[constraint]} is still the weakest link.`;
  } else if (status === 'AT_RISK') {
    reason = `The overall trend is ${trendText}, but ${target} percentile needs roughly ${fmt(Math.max(0, target - current))} more percentile points over ${Math.round(weeksRemaining)} weeks. ${SECTION_LABELS[constraint]} appears to be the main constraint.`;
    recommendedAction = `Concentrate the next two weeks on ${SECTION_LABELS[constraint]} and on eliminating repeated error types, rather than broadening topic coverage.`;
  } else {
    reason = `Current trajectory projects to roughly ${fmt(projected)} percentile against a ${target} target. The trend is ${trendText}, which does not close the gap within ${daysRemaining} days at the current rate.`;
    recommendedAction = `Cut low-return topics, concentrate on ${SECTION_LABELS[constraint]} and on accuracy/selection, and either raise sustainable weekly hours or accept a revised target.`;
  }

  return {
    status,
    confidence,
    current,
    target,
    projected: Math.round(projected * 10) / 10,
    trend,
    slopePerWeek: Math.round(slope * 100) / 100,
    daysRemaining,
    requiredImprovement: Math.max(0, Math.round((target - current) * 10) / 10),
    constraint,
    reason,
    recommendedAction,
    history,
  };
}

/* ------------------------------------------------------------------ */
/* Section readiness                                                   */
/* ------------------------------------------------------------------ */

export function sectionReadiness(state: AppState, section: SectionKey, today: ISODate): SectionReadiness {
  const target = state.profile.targetPercentile;
  const history = sectionPercentileHistory(state, section);
  const latest = history[history.length - 1]?.percentile;
  const trend = classifyTrend(history);
  const stats = sectionStats(state)[section];
  const coverage = coverageBySection(state)[section];
  const recurrence = errorRecurrence(state, section, today);

  const parts: { value: number; weight: number }[] = [];
  if (typeof latest === 'number') parts.push({ value: clamp(latest / 100, 0, 1), weight: 4 });
  if (stats.accuracy !== null && stats.attempted >= 15) {
    parts.push({ value: clamp(stats.accuracy / 0.85, 0, 1), weight: 2 });
  }
  parts.push({ value: coverage, weight: 2 });
  parts.push({ value: 1 - recurrence, weight: 1 });
  parts.push({ value: clamp(stats.attempted / 300, 0, 1), weight: 1 });
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const readiness = Math.round((parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight) * 100);

  const weakTopics = topicStats(state)
    .filter((t) => t.section === section && t.attempted >= 8 && (t.accuracy ?? 1) < 0.65)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
    .slice(0, 4)
    .map((t) => ({ topicId: t.topicId, name: t.name, accuracy: Math.round((t.accuracy ?? 0) * 100) / 100 }));

  let status: TrackStatus;
  let reason: string;
  if (typeof latest === 'number') {
    const gap = target - latest;
    status = gap <= 0 ? 'ON_TRACK' : gap <= 10 ? 'AT_RISK' : 'BEHIND';
    reason = `Latest ${SECTION_LABELS[section]} percentile is ${fmt(latest)} against a ${target} target${
      trend === 'UNKNOWN' ? '' : `, trend ${trend.toLowerCase()}`
    }.`;
  } else if (stats.attempted < 30 && coverage < 0.2) {
    status = 'UNCONFIRMED';
    reason = `Not enough ${SECTION_LABELS[section]} data yet - no sectional percentile and only ${stats.attempted} logged questions.`;
  } else {
    status = readiness >= 65 ? 'AT_RISK' : 'BEHIND';
    reason = `No ${SECTION_LABELS[section]} percentile recorded yet. Judged on practice accuracy (${
      stats.accuracy === null ? 'n/a' : Math.round(stats.accuracy * 100) + '%'
    }) and ${Math.round(coverage * 100)}% topic coverage.`;
  }

  const nextAction = buildSectionAction(section, {
    status,
    coverage,
    recurrence,
    weakTopics,
    stats,
    hasPercentile: typeof latest === 'number',
  });

  return {
    section,
    status,
    readiness,
    latestPercentile: latest,
    trend,
    accuracy: stats.accuracy ?? undefined,
    coverage,
    weakTopics,
    errorRecurrence: Math.round(recurrence * 100) / 100,
    nextAction,
    reason,
  };
}

function buildSectionAction(
  section: SectionKey,
  ctx: {
    status: TrackStatus;
    coverage: number;
    recurrence: number;
    weakTopics: { name: string }[];
    stats: { accuracy: number | null; attempted: number; setsAttempted: number; setsSolved: number };
  } & { hasPercentile: boolean },
): string {
  if (!ctx.hasPercentile && ctx.stats.attempted < 30) {
    return `Take a timed ${SECTION_LABELS[section]} sectional and record the percentile - there is no baseline for this section yet.`;
  }
  if (ctx.recurrence >= 0.4) {
    return `Clear the repeated ${SECTION_LABELS[section]} error patterns before adding new practice volume.`;
  }
  if (ctx.weakTopics.length > 0) {
    return `Target ${ctx.weakTopics[0].name} - accuracy there is the lowest in the section.`;
  }
  if (section === 'DILR' && ctx.stats.setsAttempted >= 5) {
    const solveRate = ctx.stats.setsSolved / Math.max(1, ctx.stats.setsAttempted);
    if (solveRate < 0.5) {
      return 'Set selection is the bottleneck: practise picking 2 solvable sets out of 4 within the first 5 minutes.';
    }
  }
  if (ctx.coverage < 0.5) {
    return `Continue building ${SECTION_LABELS[section]} coverage on high-weight topics before increasing timed volume.`;
  }
  return `Maintain timed ${SECTION_LABELS[section]} practice and analyse every incorrect attempt.`;
}

export interface CATReadiness {
  overall: number;
  status: TrackStatus;
  sections: SectionReadiness[];
  trajectory: Trajectory;
  constraint?: SectionKey;
  mocksCompleted: number;
  mocksAnalysed: number;
}

export function calculateCATReadiness(state: AppState, today: ISODate): CATReadiness {
  const sections = SECTIONS.map((s) => sectionReadiness(state, s, today));
  const trajectory = calculateTrajectory(state, today);
  const mocks = fullMocks(state);
  const overall = Math.round(sections.reduce((a, s) => a + s.readiness, 0) / sections.length);
  const constraint = sections.reduce((a, b) => (b.readiness < a.readiness ? b : a)).section;
  return {
    overall,
    status: trajectory.status,
    sections,
    trajectory,
    constraint,
    mocksCompleted: mocks.length,
    mocksAnalysed: mocks.filter((m) => m.analysed).length,
  };
}

/* ------------------------------------------------------------------ */
/* Mock cadence                                                        */
/* ------------------------------------------------------------------ */

export interface MockCadence {
  perWeek: number;
  reason: string;
  nextRecommendedDate: ISODate;
  sectionalsPerWeek: number;
  analysisBacklog: number;
}

/**
 * Mock frequency is derived, never hardcoded. A mock without analysis is worth
 * less than a mock with analysis, so an analysis backlog throttles the cadence.
 */
export function recommendedMockCadence(state: AppState, today: ISODate, weeklyCapacityMin: number): MockCadence {
  const daysRemaining = daysToExam(state, today);
  const mocks = fullMocks(state);
  const backlog = unanalysedMocks(state).length;
  const params = state.settings.planning;
  const mockCost = params.fullMockMin + params.mockAnalysisMin;

  let perWeek: number;
  let reason: string;

  if (mocks.length === 0) {
    perWeek = 1;
    reason = 'No baseline exists yet - one full mock is the highest-value action available.';
  } else if (daysRemaining > PHASE_THRESHOLDS.foundation) {
    perWeek = 0.5;
    reason = 'Foundation phase: one mock per fortnight is enough to track the trend while concepts are still being built.';
  } else if (daysRemaining > PHASE_THRESHOLDS.application) {
    perWeek = 1;
    reason = 'Application phase: weekly mocks with full analysis, supported by sectionals.';
  } else {
    perWeek = 2;
    reason = 'Readiness phase: mock exposure and analysis are now the main lever.';
  }

  if (backlog >= 2) {
    perWeek = Math.min(perWeek, 0.5);
    reason = `${backlog} mocks are still unanalysed. Cadence is reduced until the analysis backlog is cleared - an unanalysed mock adds little.`;
  }

  // Never plan more mocks than the week can actually absorb (mock + analysis).
  const affordable = weeklyCapacityMin > 0 ? Math.floor((weeklyCapacityMin * 0.55) / mockCost) : 0;
  if (mocks.length > 0 && affordable < perWeek) {
    perWeek = Math.max(0.5, affordable);
    reason += ` Weekly capacity supports about ${affordable} full mock${affordable === 1 ? '' : 's'} including analysis.`;
  }

  const lastMock = mocks[mocks.length - 1];
  const gapDays = perWeek >= 2 ? 3 : perWeek >= 1 ? 7 : 14;
  const nextRecommendedDate = lastMock ? addDays(lastMock.date, gapDays) : today;

  const sectionalsPerWeek =
    daysRemaining > PHASE_THRESHOLDS.foundation ? 2 : daysRemaining > PHASE_THRESHOLDS.application ? 3 : 2;

  return {
    perWeek,
    reason,
    nextRecommendedDate: nextRecommendedDate < today ? today : nextRecommendedDate,
    sectionalsPerWeek,
    analysisBacklog: backlog,
  };
}

export function preparationPhase(state: AppState, today: ISODate): 'FOUNDATION' | 'APPLICATION' | 'READINESS' {
  const days = daysBetween(today, state.profile.examDate);
  if (days > PHASE_THRESHOLDS.foundation) return 'FOUNDATION';
  if (days > PHASE_THRESHOLDS.application) return 'APPLICATION';
  return 'READINESS';
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
