import { describe, expect, it } from 'vitest';
import {
  hashString,
  quantile,
  recencyWeights,
  seededRandom,
  tCritical90,
  weightedFit,
  weightedMean,
  weightedSd,
} from '../stats';

describe('recencyWeights', () => {
  it('halves the weight every 21 days', () => {
    const [old, fresh] = recencyWeights(['2026-08-13', '2026-09-03'], '2026-09-03');
    expect(old / fresh).toBeCloseTo(0.5, 6);
  });

  it('sums to one', () => {
    const w = recencyWeights(['2026-07-01', '2026-08-01', '2026-09-01'], '2026-09-03');
    expect(w.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 10);
  });

  it('never gives a future-dated mock more than full weight', () => {
    const [future, today] = recencyWeights(['2026-09-10', '2026-09-03'], '2026-09-03');
    expect(future).toBeCloseTo(today, 10);
  });
});

describe('weighted mean and spread', () => {
  it('equals the plain mean with equal weights', () => {
    expect(weightedMean([10, 20, 30], [1, 1, 1])).toBe(20);
  });

  it('leans towards heavier weights', () => {
    expect(weightedMean([10, 30], [1, 3])).toBe(25);
  });

  it('has no spread for one value', () => {
    expect(weightedSd([42], [1])).toBe(0);
  });
});

describe('weightedFit', () => {
  it('recovers an exact line', () => {
    const fit = weightedFit([0, 7, 14, 21], [60, 62, 64, 66]);
    expect(fit.slope).toBeCloseTo(2 / 7, 10);
    expect(fit.intercept).toBeCloseTo(60, 10);
    expect(fit.se).toBeCloseTo(0, 10);
  });

  it('reports no standard error for two points rather than a false zero', () => {
    expect(weightedFit([0, 7], [60, 70]).se).toBeUndefined();
  });

  it('gives a positive standard error for noisy data', () => {
    expect(weightedFit([0, 7, 14, 21], [60, 70, 58, 72]).se).toBeGreaterThan(0);
  });
});

describe('tCritical90', () => {
  it('matches the tabulated one-sided 95% points', () => {
    expect(tCritical90(1)).toBe(6.314);
    expect(tCritical90(5)).toBe(2.015);
    expect(tCritical90(1000)).toBe(1.645);
  });

  it('is infinite with no degrees of freedom', () => {
    expect(tCritical90(0)).toBe(Infinity);
  });
});

describe('quantile', () => {
  it('interpolates between neighbours', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10, 20, 30], 0)).toBe(10);
    expect(quantile([10, 20, 30], 1)).toBe(30);
  });
});

describe('seededRandom', () => {
  it('repeats exactly for the same seed', () => {
    const a = seededRandom(hashString('evidence'));
    const b = seededRandom(hashString('evidence'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('differs when the evidence differs', () => {
    expect(seededRandom(hashString('a'))()).not.toBe(seededRandom(hashString('b'))());
  });

  it('stays inside [0, 1)', () => {
    const r = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
