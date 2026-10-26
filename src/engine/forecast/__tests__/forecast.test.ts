/**
 * Forecast tests.
 *
 * Organised around the guide: each named bug ("flat", "blame QA",
 * "projected = current") and each hard rule gets a test that would have
 * failed against the old engine.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../domain/date';
import type { Mock } from '../../../domain/types';
import { makeMock, makeState, TODAY } from '../../__tests__/fixtures';
import { analyseTrend, calculateForecast, cleanMock, statusFromGap } from '../index';
import { findContradictions, minePatterns, tagText } from '../patterns';

interface Row {
  marks: number;
  pct?: number;
  v: number;
  d: number;
  q: number;
  vp?: number;
  dp?: number;
  qp?: number;
  notes?: string;
  analysed?: boolean;
}

/** One full mock per week, the last one today. */
function series(rows: Row[]): Mock[] {
  return rows.map((r, i) =>
    makeMock({
      id: `m${i}`,
      name: `Mock ${i + 1}`,
      date: addDays(TODAY, -7 * (rows.length - 1 - i)),
      overallScore: r.marks,
      overallPercentile: r.pct ?? 0,
      analysed: r.analysed ?? true,
      mainMistakes: r.notes,
      sections: {
        VARC: { score: r.v, percentile: r.vp ?? 0, attempts: 18, correct: 12, incorrect: 6 },
        DILR: { score: r.d, percentile: r.dp ?? 0, attempts: 12, correct: 6, incorrect: 6 },
        QA: { score: r.q, percentile: r.qp ?? 0, attempts: 20, correct: 12, incorrect: 8 },
      },
    }),
  );
}

/** A plausible marks-to-percentile relationship to generate test data from. */
const pctFor = (marks: number) => Math.round((100 / (1 + Math.exp(-(-3.2 + 0.06 * marks)))) * 10) / 10;
const sectionPctFor = (marks: number) => Math.round((100 / (1 + Math.exp(-(-2.5 + 0.12 * marks)))) * 10) / 10;

function row(marks: number, v: number, d: number, q: number, extra: Partial<Row> = {}): Row {
  return { marks, pct: pctFor(marks), v, d, q, vp: sectionPctFor(v), dp: sectionPctFor(d), qp: sectionPctFor(q), ...extra };
}

const forecastOf = (mocks: Mock[]) => calculateForecast(makeState({ mocks }), TODAY);

/* ------------------------------------------------------------------ */

describe('step 1: data hygiene', () => {
  it('treats a percentile of 0 as missing, never as a score of zero', () => {
    const clean = cleanMock(makeMock({ overallPercentile: 0 }));
    expect(clean.percentile).toBeUndefined();
    expect(clean.marks).toBe(80);
  });

  it('treats attempts of 0 alongside a nonzero score as missing', () => {
    const clean = cleanMock(
      makeMock({ sections: { VARC: { score: 30, percentile: 85, attempts: 0, correct: 0, incorrect: 0 } } }),
    );
    expect(clean.sections.VARC?.attempts).toBeUndefined();
    expect(clean.sections.VARC?.accuracy).toBeUndefined();
    expect(clean.sections.VARC?.marks).toBe(30);
  });

  it('keeps a genuine zero score when attempts were made', () => {
    const clean = cleanMock(
      makeMock({ sections: { DILR: { score: 0, percentile: 0, attempts: 6, correct: 2, incorrect: 4 } } }),
    );
    expect(clean.sections.DILR?.marks).toBe(0);
  });

  it('drops a section that is nothing but untouched form fields', () => {
    const clean = cleanMock(
      makeMock({ sections: { QA: { score: 0, percentile: 0, attempts: 0, correct: 0, incorrect: 0 } } }),
    );
    expect(clean.sections.QA).toBeUndefined();
  });

  it('recovers overall marks from the sections when the overall was left blank', () => {
    const clean = cleanMock(makeMock({ overallScore: undefined }));
    expect(clean.marks).toBe(30 + 18 + 32);
  });

  it('never mixes sectionals into the full-mock series', () => {
    const mocks = [...series([row(60, 25, 15, 20), row(64, 26, 16, 22), row(66, 27, 17, 22)])];
    mocks.push(makeMock({ id: 's1', kind: 'sectional', section: 'QA', overallScore: 999, date: TODAY }));
    const f = forecastOf(mocks);
    expect(f.n).toBe(3);
    expect(f.history.every((h) => h.marks !== 999)).toBe(true);
  });

  it('averages only the last five recorded percentiles, skipping blanks', () => {
    const rows = [50, 60, 70, 80, 90, 100].map((m) => row(m, 30, 15, 20));
    rows[5].pct = undefined; // the latest mock has no percentile
    const f = forecastOf(series(rows));
    const lastFive = [50, 60, 70, 80, 90].map(pctFor);
    expect(f.recentAveragePercentile).toBeCloseTo(lastFive.reduce((a, v) => a + v, 0) / 5, 1);
    expect(f.recentAverageCount).toBe(5);
  });

  it('always reports on data quality, even when the data is clean', () => {
    const f = forecastOf(series([row(60, 25, 15, 20), row(64, 26, 16, 22), row(66, 27, 17, 22)]));
    expect(f.dataQuality.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe('step 4: the "flat" bug', () => {
  const points = (values: number[]) => values.map((value, i) => ({ date: addDays(TODAY, -7 * (values.length - 1 - i)), value }));

  it('calls a steady climb RISING', () => {
    expect(analyseTrend(points([50, 54, 57, 61, 65, 68, 72]), TODAY).label).toBe('RISING');
  });

  it('calls a steady slide FALLING', () => {
    expect(analyseTrend(points([72, 68, 65, 61, 57, 54, 50]), TODAY).label).toBe('FALLING');
  });

  it('does not call a series flat because its ends match while the middle spikes', () => {
    const t = analyseTrend(points([60, 62, 85, 61, 60]), TODAY);
    expect(t.label).toBe('VOLATILE');
  });

  it('reserves FLAT for genuinely tight series', () => {
    expect(analyseTrend(points([60, 62, 61, 63, 62]), TODAY).label).toBe('FLAT');
  });

  it('refuses to call a trend from two mocks', () => {
    const t = analyseTrend(points([50, 70]), TODAY);
    expect(t.label).toBe('INSUFFICIENT');
    expect(t.summary).toMatch(/not enough/);
  });

  it('leads with block averages when they rise but the regression cannot confirm it', () => {
    const t = analyseTrend(points([50, 75, 52, 77, 55, 79]), TODAY);
    expect(t.blocksRising).toBe(true);
    if (t.label === 'FLAT' || t.label === 'VOLATILE') {
      expect(t.leadWithBlocks).toBe(true);
      expect(t.summary.startsWith('Block averages')).toBe(true);
    }
  });

  it('states the sample size and flags small samples as directional', () => {
    const t = analyseTrend(points([50, 54, 57, 61]), TODAY);
    expect(t.summary).toContain('4 full mocks');
    expect(t.directionalOnly).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe('step 5: the "blame QA" bug', () => {
  it('does not name the section that merely scored lowest in the latest mock', () => {
    // QA is steady and low; DILR swings wildly and has shown far more.
    const rows = [
      row(70, 30, 25, 15),
      row(50, 30, 5, 15),
      row(72, 30, 27, 15),
      row(48, 30, 3, 15),
      row(71, 30, 26, 15),
      row(60, 30, 18, 12), // QA lowest in the latest mock
    ];
    const f = forecastOf(series(rows));
    expect(f.constraint.established).toBe(true);
    expect(f.constraint.top[0].section).toBe('DILR');
    expect(f.constraint.top[0].kind).toBe('CONSISTENCY');
  });

  it('never names a constraint from fewer than three mocks', () => {
    const f = forecastOf(series([row(60, 25, 15, 20), row(64, 26, 16, 22)]));
    expect(f.constraint.established).toBe(false);
    expect(f.constraint.top).toHaveLength(0);
  });

  it('does not mistake a steady climb for a consistency problem', () => {
    // Every best is in the latest paper and the early papers sit low, so the
    // clean-paper rate is low - because of improvement, not inconsistency.
    const climb = [55, 62, 70, 80, 88, 95, 103].map((m) => row(m, Math.round(m * 0.4), Math.round(m * 0.25), m - Math.round(m * 0.4) - Math.round(m * 0.25)));
    const f = forecastOf(series(climb));
    expect(f.trend.label).toBe('RISING');
    expect(f.cleanPaper?.rate).toBeLessThan(0.5);
    expect(f.cleanPaper?.consistencyHeadline).toBe(false);
  });

  it('does call it consistency when strong papers and weak papers alternate', () => {
    // Section bests total 113 marks (about 97 percentile): the target is inside
    // the demonstrated range, but no single paper delivered it cleanly.
    const swings = [row(112, 45, 30, 37), row(60, 20, 15, 25), row(110, 44, 31, 35), row(58, 22, 12, 24), row(111, 43, 29, 37), row(61, 21, 14, 26)];
    const f = forecastOf(series(swings));
    expect(f.trend.label).not.toBe('RISING');
    expect(f.cleanPaper?.consistencyHeadline).toBe(true);
    expect(f.recommendedAction).toMatch(/consistency/);
  });

  it('reports the clean-paper rate and combined bests', () => {
    const rows = [row(70, 32, 18, 20), row(65, 25, 20, 20), row(68, 26, 16, 26), row(66, 27, 17, 22)];
    const f = forecastOf(series(rows));
    expect(f.cleanPaper?.n).toBe(4);
    expect(f.cleanPaper?.combinedBestMarks).toBe(32 + 20 + 26);
  });
});

/* ------------------------------------------------------------------ */

describe('step 6: the "projected = current" bug', () => {
  const steady = [row(60, 25, 15, 20), row(62, 26, 16, 20), row(61, 25, 16, 20), row(63, 26, 16, 21), row(62, 26, 15, 21), row(61, 25, 16, 20)];

  it('produces a distribution, never a single point', () => {
    const f = forecastOf(series(steady));
    expect(f.forecast?.percentile).toBeDefined();
    expect(f.forecast!.percentile!.p90).toBeGreaterThan(f.forecast!.percentile!.p10);
  });

  it('is deterministic for the same evidence', () => {
    const a = forecastOf(series(steady));
    const b = forecastOf(series(steady));
    expect(a.forecast).toEqual(b.forecast);
  });

  it('applies no drift when the trend is not significant', () => {
    const f = forecastOf(series(steady));
    expect(f.forecast?.drift).toBe(0);
    expect(f.forecast?.notes.join(' ')).toMatch(/No drift applied/);
  });

  it('keeps the likely value at or below the demonstrated best unless the trend is rising', () => {
    const volatile = [row(40, 15, 10, 15), row(90, 35, 25, 30), row(45, 18, 12, 15), row(88, 34, 24, 30), row(42, 16, 11, 15)];
    const f = forecastOf(series(volatile));
    expect(f.trend.label).not.toBe('RISING');
    expect(f.forecast!.marks.p50).toBeLessThanOrEqual(90 + 1e-9);
  });

  it('widens the band and labels it indicative below five mocks', () => {
    const few = forecastOf(series(steady.slice(0, 4)));
    expect(few.forecast?.indicative).toBe(true);
    expect(few.confidence).toBe('low');
  });

  it('keeps the probability consistent with the band it reports', () => {
    const f = forecastOf(series(steady));
    const p = f.forecast!.percentile!;
    if (f.target > p.p90) expect(f.forecast!.probability!).toBeLessThan(0.1 + 1e-9);
    if (f.target < p.p10) expect(f.forecast!.probability!).toBeGreaterThan(0.9 - 1e-9);
  });

  it('caps drift for a rising trend at 1.5 marks a week', () => {
    const climbing = [40, 45, 50, 55, 60, 65, 70, 75].map((m) => row(m, m * 0.4, m * 0.25, m * 0.35));
    const f = forecastOf(series(climbing));
    expect(f.trend.label).toBe('RISING');
    const weeks = f.weeksRemaining;
    const taper = weeks > 6 ? 0.7 : 1;
    expect(f.forecast!.drift).toBeLessThanOrEqual(1.5 * weeks * taper + 1e-9);
  });

  it('says it is weakened when more than a third of recent mocks are unanalysed', () => {
    const rows = steady.map((r, i) => ({ ...r, analysed: i < 2 }));
    const f = forecastOf(series(rows));
    expect(f.forecast?.notes.join(' ')).toMatch(/Forecast weakened/);
  });
});

/* ------------------------------------------------------------------ */

describe('step 7: rule-based status', () => {
  it('applies the gap thresholds exactly', () => {
    expect(statusFromGap(96, 95.5, 5).status).toBe('ON_TRACK');
    expect(statusFromGap(96, 95, 5).status).toBe('ON_TRACK');
    expect(statusFromGap(96, 94, 5).status).toBe('STRETCH');
    expect(statusFromGap(96, 92, 5).status).toBe('STRETCH');
    expect(statusFromGap(96, 90, 5).status).toBe('AT_RISK');
    expect(statusFromGap(96, 88, 5).status).toBe('AT_RISK');
    expect(statusFromGap(96, 87, 5).status).toBe('OFF_TRACK');
  });

  it('adds HIGH VARIANCE above a ten-point spread', () => {
    expect(statusFromGap(96, 90, 10).highVariance).toBe(false);
    expect(statusFromGap(96, 90, 10.5).highVariance).toBe(true);
  });

  it('prints the rule that produced the label', () => {
    expect(statusFromGap(96, 90, 12).rule).toMatch(/Gap = 96 - 90 = 6 points/);
  });

  it('stays unconfirmed, and says what to log, when marks cannot be converted', () => {
    const rows = [row(60, 25, 15, 20), row(64, 26, 16, 22)].map((r) => ({ ...r, pct: undefined }));
    const f = forecastOf(series(rows));
    expect(f.status).toBe('UNCONFIRMED');
    expect(f.recommendedAction).toMatch(/percentile/);
  });

  it('judges each section on its own numbers', () => {
    // VARC is comfortably above a 96th-percentile section score; DILR is far below.
    const rows = [row(90, 58, 12, 20), row(92, 59, 13, 20), row(91, 58, 12, 21), row(93, 60, 13, 20), row(92, 59, 12, 21)];
    const f = forecastOf(series(rows));
    const varc = f.sections.find((s) => s.section === 'VARC')!;
    const dilr = f.sections.find((s) => s.section === 'DILR')!;
    expect(varc.status).toBe('ON_TRACK');
    expect(dilr.status).toBe('OFF_TRACK');
  });

  it('can legitimately give every section the same label when the data says so', () => {
    const rows = [row(70, 34, 12, 24), row(72, 35, 13, 24), row(71, 34, 12, 25), row(73, 35, 13, 25), row(72, 35, 12, 25)];
    const f = forecastOf(series(rows));
    // All three are far below a 96th-percentile section score here.
    expect(f.sections.every((s) => s.status === 'OFF_TRACK')).toBe(true);
    // ...but each still gets its own rule, built from its own numbers.
    expect(new Set(f.sections.map((s) => s.statusRule)).size).toBe(3);
  });
});

/* ------------------------------------------------------------------ */

describe('step 8: error patterns', () => {
  it('tags notes into behaviour categories', () => {
    expect(tagText('Got stuck on a set and spent too long')).toContain('SUNK_COST');
    expect(tagText('Silly calculation mistake under panic')).toContain('PANIC_OR_CARELESS');
    expect(tagText("Didn't know the formula for this")).toContain('CONCEPT_GAP');
    expect(tagText('Ran out of time in QA')).toContain('PACE');
  });

  it('labels a pattern absent from the last three mocks as improving', () => {
    const mocks = series([
      row(60, 25, 15, 20, { notes: 'got stuck on a set' }),
      row(61, 25, 15, 21, { notes: 'stuck again' }),
      row(62, 26, 15, 21, { notes: 'fine' }),
      row(63, 26, 16, 21, { notes: 'fine' }),
      row(63, 26, 16, 21, { notes: 'fine' }),
    ]).map(cleanMock);
    const sunk = minePatterns(mocks).patterns.find((p) => p.tag === 'SUNK_COST');
    expect(sunk?.trend).toBe('IMPROVING');
  });

  it('labels a pattern that only just appeared as new', () => {
    const mocks = series([
      row(60, 25, 15, 20, { notes: 'fine' }),
      row(61, 25, 15, 21, { notes: 'fine' }),
      row(62, 26, 15, 21, { notes: 'fine' }),
      row(63, 26, 16, 21, { notes: 'ran out of time' }),
    ]).map(cleanMock);
    expect(minePatterns(mocks).patterns.find((p) => p.tag === 'PACE')?.trend).toBe('NEW');
  });

  it('flags self-rules that contradict each other across dates', () => {
    const mocks = series([
      row(60, 25, 15, 20, { notes: 'Skip TITA questions in QA completely.' }),
      row(61, 25, 15, 21, { notes: 'Always attempt every TITA question in QA.' }),
    ]).map(cleanMock);
    expect(findContradictions(mocks)).toHaveLength(1);
  });

  it('only recommends topic work when a concept gap is a top-two pattern', () => {
    const mocks = series([
      row(60, 25, 15, 20, { notes: 'stuck on a set, too much time on it' }),
      row(61, 25, 15, 21, { notes: 'stuck again on DILR' }),
      row(62, 26, 15, 21, { notes: 'stuck, panic at the end' }),
      row(63, 26, 16, 21, { notes: 'panic and silly errors' }),
    ]);
    const f = forecastOf(mocks);
    expect(f.patterns.conceptGapInTopTwo).toBe(false);
    for (const s of f.sections) expect(s.action.toLowerCase()).not.toMatch(/topic|coverage|syllabus/);
  });
});

/* ------------------------------------------------------------------ */

describe('hard rules on the output', () => {
  const rows = [row(55, 22, 13, 20), row(60, 24, 16, 20), row(58, 23, 14, 21), row(64, 26, 17, 21), row(62, 25, 16, 21), row(66, 27, 18, 21)];
  const f = forecastOf(series(rows));
  const text = [
    ...f.headline,
    ...f.whatChanged,
    ...f.dataQuality,
    f.recommendedAction,
    f.statusRule,
    ...f.sections.flatMap((s) => [s.action, s.statusRule, s.sectional.verdict, s.trend.summary]),
    ...f.scenarios.flatMap((s) => s.conditions),
  ].join('\n');

  it('uses no em dashes', () => {
    expect(text).not.toContain('—');
  });

  it('never prints 0 for a missing percentile', () => {
    expect(text).not.toMatch(/\b0 percentile\b/);
  });

  it('never gives two sections the same advice', () => {
    const actions = f.sections.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('states the sample size next to the trend', () => {
    expect(f.trend.summary).toMatch(/6 full mocks/);
  });

  it('explains what changed since the previous mock', () => {
    expect(f.whatChanged[0]).toMatch(/^Since Mock 6/);
  });

  it('gives a recommendation even with no data, and says what to log', () => {
    const empty = forecastOf([]);
    expect(empty.status).toBe('UNCONFIRMED');
    expect(empty.recommendedAction).toMatch(/full-length mock/);
    expect(empty.dataQuality.length).toBeGreaterThan(0);
  });
});
