/**
 * Readiness, through the forecast.
 *
 * The trajectory these tests used to cover averaged percentiles, named the
 * constraint from the weakest single reading and projected one number. All
 * three are what the forecasting guide rules out, so the replacement is
 * tested here at the level the rest of the app consumes it; the detailed
 * statistics are covered in `forecast/__tests__`.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { calculateForecast } from '../forecast';
import { recommendedMockCadence } from '../readiness';
import { makeMock, makeState, TODAY } from './fixtures';

/** Weekly full mocks whose marks and percentiles agree with each other. */
function marksSeries(marks: number[], startOffsetDays = -70) {
  return marks.map((m, i) =>
    makeMock({
      name: `Mock ${i + 1}`,
      date: addDays(TODAY, startOffsetDays + i * 7),
      overallScore: m,
      overallPercentile: Math.round((100 / (1 + Math.exp(-(-3.2 + 0.06 * m)))) * 10) / 10,
      sections: {
        VARC: { score: Math.round(m * 0.4), percentile: 0, attempts: 18, correct: 12, incorrect: 6 },
        DILR: { score: Math.round(m * 0.25), percentile: 0, attempts: 12, correct: 5, incorrect: 7 },
        QA: { score: m - Math.round(m * 0.4) - Math.round(m * 0.25), percentile: 0, attempts: 20, correct: 12, incorrect: 8 },
      },
    }),
  );
}

describe('readiness via the forecast', () => {
  it('reports UNCONFIRMED rather than guessing when no mock exists', () => {
    const f = calculateForecast(makeState(), TODAY);
    expect(f.status).toBe('UNCONFIRMED');
    expect(f.confidence).toBe('none');
    expect(f.recommendedAction).toMatch(/full-length mock/i);
  });

  it('treats a single mock as low confidence and calls no trend', () => {
    const f = calculateForecast(makeState({ mocks: marksSeries([70]) }), TODAY);
    expect(f.confidence).toBe('low');
    expect(f.trend.label).toBe('INSUFFICIENT');
  });

  it('cannot convert marks to percentile from one pair, and says what to log', () => {
    const f = calculateForecast(makeState({ mocks: marksSeries([70]) }), TODAY);
    expect(f.status).toBe('UNCONFIRMED');
    expect(f.recommendedAction).toMatch(/percentile/i);
  });

  it('calls a flat series well below target OFF TRACK', () => {
    const f = calculateForecast(makeState({ mocks: marksSeries([60, 61, 60, 61, 60, 61]) }), TODAY);
    expect(f.trend.label).toBe('FLAT');
    expect(f.status).toBe('OFF_TRACK');
    expect(f.forecast!.percentile!.p50).toBeLessThan(96);
  });

  it('recognises sustained improvement and does not send you back to fundamentals', () => {
    const f = calculateForecast(makeState({ mocks: marksSeries([55, 62, 70, 80, 88, 95, 103]) }), TODAY);
    expect(f.trend.label).toBe('RISING');
    expect(f.recommendedAction).not.toMatch(/beginner|start from scratch|topic|coverage/i);
  });

  it('does not name a constraint when no section stands out', () => {
    // The paper varies, but every section is exactly the same in every mock,
    // so no section has swing or unrealised upside to single it out by.
    const mocks = [60, 64, 62, 66, 65].map((m, i) =>
      makeMock({
        name: `Mock ${i + 1}`,
        date: addDays(TODAY, -28 + i * 7),
        overallScore: m,
        overallPercentile: 70 + (m - 60),
      }),
    );
    const f = calculateForecast(makeState({ mocks }), TODAY);
    expect(f.constraint.top).toHaveLength(0);
    expect(f.recommendedAction).toMatch(/No single section/);
  });

  it('shows the chance of the target as a share of simulated papers, with the band behind it', () => {
    const f = calculateForecast(makeState({ mocks: marksSeries([80, 84, 88, 86, 90]) }), TODAY);
    expect(f.forecast?.probability).toBeGreaterThanOrEqual(0);
    expect(f.forecast?.probability).toBeLessThanOrEqual(1);
    expect(f.forecast?.percentile?.p10).toBeLessThan(f.forecast!.percentile!.p90);
  });
});

describe('recommendedMockCadence', () => {
  it('prioritises a baseline when nothing has been recorded', () => {
    const cadence = recommendedMockCadence(makeState(), TODAY, 1200);
    expect(cadence.perWeek).toBeGreaterThanOrEqual(1);
    expect(cadence.reason).toMatch(/baseline/i);
  });

  it('throttles the cadence while mocks remain unanalysed', () => {
    const mocks = marksSeries([80, 84]).map((m) => ({ ...m, analysed: false }));
    const cadence = recommendedMockCadence(makeState({ mocks }), TODAY, 1200);
    expect(cadence.perWeek).toBeLessThanOrEqual(0.5);
    expect(cadence.reason).toMatch(/unanalysed/i);
  });

  it('does not recommend more mocks than the week can absorb', () => {
    const cadence = recommendedMockCadence(makeState({ mocks: marksSeries([80, 84, 88]) }), TODAY, 200);
    expect(cadence.perWeek).toBeLessThanOrEqual(1);
  });
});
