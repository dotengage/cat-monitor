import { describe, expect, it } from 'vitest';
import { fitCurve, logit } from '../curve';

/** Pairs lying exactly on percentile = 100 / (1 + exp(-(a + b * marks))). */
function onLogistic(a: number, b: number, marks: number[]) {
  return marks.map((m) => ({ marks: m, percentile: 100 / (1 + Math.exp(-(a + b * m))) }));
}

describe('fitCurve', () => {
  it('fits a logistic with five or more pairs and recovers it', () => {
    const curve = fitCurve(onLogistic(-3, 0.06, [40, 55, 70, 85, 100]))!;
    expect(curve.method).toBe('logistic');
    expect(curve.provisional).toBe(false);
    expect(curve.toPercentile(70)).toBeCloseTo(100 / (1 + Math.exp(-(-3 + 0.06 * 70))), 3);
  });

  it('inverts cleanly', () => {
    const curve = fitCurve(onLogistic(-3, 0.06, [40, 55, 70, 85, 100]))!;
    expect(curve.toMarks(curve.toPercentile(77))).toBeCloseTo(77, 6);
  });

  it('charges more marks per point near the top than in the middle', () => {
    const curve = fitCurve(onLogistic(-3, 0.06, [40, 55, 70, 85, 100]))!;
    expect(curve.marksPerPoint(98)).toBeGreaterThan(curve.marksPerPoint(60));
  });

  it('falls back to a provisional interpolation below five pairs', () => {
    const curve = fitCurve([
      { marks: 60, percentile: 80 },
      { marks: 80, percentile: 92 },
    ])!;
    expect(curve.method).toBe('interpolated');
    expect(curve.provisional).toBe(true);
    expect(curve.toPercentile(60)).toBeCloseTo(80, 6);
    expect(curve.toPercentile(80)).toBeCloseTo(92, 6);
  });

  it('never extrapolates past 100 or below 0', () => {
    const curve = fitCurve([
      { marks: 60, percentile: 80 },
      { marks: 80, percentile: 95 },
    ])!;
    expect(curve.toPercentile(400)).toBeLessThan(100);
    expect(curve.toPercentile(-200)).toBeGreaterThan(0);
  });

  it('stays monotonic when two providers disagree', () => {
    // A higher score at a lower percentile: pooled, not followed backwards.
    const curve = fitCurve([
      { marks: 60, percentile: 85 },
      { marks: 70, percentile: 80 },
      { marks: 90, percentile: 95 },
    ])!;
    let previous = -Infinity;
    for (let m = 40; m <= 110; m += 5) {
      const p = curve.toPercentile(m);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });

  it('returns nothing for a single pair', () => {
    expect(fitCurve([{ marks: 60, percentile: 80 }])).toBeNull();
  });

  it('ignores percentiles that are blank fields', () => {
    expect(
      fitCurve([
        { marks: 60, percentile: 0 },
        { marks: 70, percentile: 0 },
      ]),
    ).toBeNull();
  });
});

describe('logit', () => {
  it('is finite at the extremes', () => {
    expect(Number.isFinite(logit(0))).toBe(true);
    expect(Number.isFinite(logit(100))).toBe(true);
  });
});
