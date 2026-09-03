import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { calculateCATReadiness, calculateTrajectory, recommendedMockCadence } from '../readiness';
import { makeMock, makeState, TODAY } from './fixtures';

function mockSeries(percentiles: number[], startOffsetDays = -70) {
  return percentiles.map((p, i) =>
    makeMock({
      name: `Mock ${i + 1}`,
      date: addDays(TODAY, startOffsetDays + i * 7),
      overallPercentile: p,
      sections: {
        VARC: { score: 30, percentile: p + 4, attempts: 18, correct: 12, incorrect: 6 },
        DILR: { score: 15, percentile: p - 12, attempts: 12, correct: 5, incorrect: 7 },
        QA: { score: 30, percentile: p + 1, attempts: 20, correct: 12, incorrect: 8 },
      },
    }),
  );
}

describe('calculateTrajectory', () => {
  it('reports UNCONFIRMED rather than guessing when no mock exists', () => {
    const t = calculateTrajectory(makeState(), TODAY);
    expect(t.status).toBe('UNCONFIRMED');
    expect(t.confidence).toBe('none');
    expect(t.reason).toMatch(/no basis|unconfirmed/i);
    expect(t.recommendedAction).toMatch(/full-length mock/i);
  });

  it('treats a single mock as low confidence', () => {
    const t = calculateTrajectory(makeState({ mocks: mockSeries([70]) }), TODAY);
    expect(t.confidence).toBe('low');
    expect(t.trend).toBe('UNKNOWN');
    expect(t.reason).toMatch(/one mock cannot establish a trend|single/i);
  });

  it('flags an improving but insufficient trend as AT RISK', () => {
    const t = calculateTrajectory(makeState({ mocks: mockSeries([78, 82, 86, ]) }), TODAY);
    expect(t.trend).toBe('IMPROVING');
    expect(t.status).toBe('AT_RISK');
    expect(t.reason).toMatch(/main constraint/i);
  });

  it('recognises a trend that has crossed the target as ON TRACK', () => {
    const t = calculateTrajectory(makeState({ mocks: mockSeries([90, 92, 95, 97]) }), TODAY);
    expect(t.status).toBe('ON_TRACK');
    expect(t.recommendedAction).toMatch(/consistency|analysis/i);
  });

  it('calls a flat trend well below target BEHIND', () => {
    const t = calculateTrajectory(makeState({ mocks: mockSeries([72, 73, 72, 73]) }), TODAY);
    expect(t.status).toBe('BEHIND');
    expect(t.projected).toBeLessThan(96);
  });

  it('shifts focus away from fundamentals once mocks improve rapidly', () => {
    const state = makeState({ mocks: mockSeries([72, 76, 81, 87, 91, 94, 97]) });
    const t = calculateTrajectory(state, TODAY);
    expect(t.status).toBe('ON_TRACK');
    expect(t.trend).toBe('IMPROVING');
    expect(t.recommendedAction).toMatch(/consistency, section balance and mock analysis/i);
  });

  it('never states a probability', () => {
    const t = calculateTrajectory(makeState({ mocks: mockSeries([80, 84, 88]) }), TODAY);
    expect(t.reason).not.toMatch(/%\s*chance|probability/i);
  });
});

describe('calculateCATReadiness', () => {
  it('identifies the weakest section as the constraint', () => {
    const readiness = calculateCATReadiness(makeState({ mocks: mockSeries([80, 84, 88]) }), TODAY);
    expect(readiness.constraint).toBe('DILR');
    expect(readiness.sections).toHaveLength(3);
    expect(readiness.mocksCompleted).toBe(3);
  });
});

describe('recommendedMockCadence', () => {
  it('prioritises a baseline when nothing has been recorded', () => {
    const cadence = recommendedMockCadence(makeState(), TODAY, 1200);
    expect(cadence.perWeek).toBeGreaterThanOrEqual(1);
    expect(cadence.reason).toMatch(/baseline/i);
  });

  it('throttles the cadence while mocks remain unanalysed', () => {
    const mocks = mockSeries([80, 84]).map((m) => ({ ...m, analysed: false }));
    const cadence = recommendedMockCadence(makeState({ mocks }), TODAY, 1200);
    expect(cadence.perWeek).toBeLessThanOrEqual(0.5);
    expect(cadence.reason).toMatch(/unanalysed/i);
  });

  it('does not recommend more mocks than the week can absorb', () => {
    const mocks = mockSeries([80, 84, 88]);
    const cadence = recommendedMockCadence(makeState({ mocks }), TODAY, 200);
    expect(cadence.perWeek).toBeLessThanOrEqual(1);
  });
});
