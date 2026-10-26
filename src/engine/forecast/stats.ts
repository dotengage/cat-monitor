/**
 * Statistics primitives for the forecast.
 *
 * Small, dependency-free and individually tested. Nothing here knows about
 * mocks or CAT; it is weighted means, weighted regression, quantiles and a
 * seeded random source - the pieces the forecast is assembled from.
 */
import { daysBetween } from '../../domain/date';
import type { ISODate } from '../../domain/types';

export const sum = (values: number[]): number => values.reduce((a, v) => a + v, 0);

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

/** Population variance. A sample of one has no spread, not an undefined one. */
export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return mean(values.map((v) => (v - m) ** 2));
}

export function sd(values: number[]): number {
  return Math.sqrt(variance(values));
}

/** Linear-interpolated quantile of an already sorted array, q in [0, 1]. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function quantile(values: number[], q: number): number {
  return quantileSorted([...values].sort((a, b) => a - b), q);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/* ------------------------------------------------------------------ */
/* Recency weighting                                                   */
/* ------------------------------------------------------------------ */

export const HALF_LIFE_DAYS = 21;

/**
 * w = 0.5 ^ (age / 21), normalised to sum to 1.
 *
 * A mock three weeks old counts half as much as one taken today, and one six
 * weeks old a quarter. Old evidence fades rather than being cut off at some
 * arbitrary window, which is what makes "current level" mean current.
 */
export function recencyWeights(dates: ISODate[], today: ISODate, halfLife = HALF_LIFE_DAYS): number[] {
  if (dates.length === 0) return [];
  const raw = dates.map((d) => 0.5 ** (Math.max(0, daysBetween(d, today)) / halfLife));
  const total = sum(raw);
  return raw.map((w) => w / total);
}

export function weightedMean(values: number[], weights: number[]): number {
  const total = sum(weights);
  if (total === 0) return mean(values);
  return values.reduce((a, v, i) => a + v * weights[i], 0) / total;
}

export function weightedSd(values: number[], weights: number[]): number {
  if (values.length < 2) return 0;
  const total = sum(weights);
  if (total === 0) return sd(values);
  const m = weightedMean(values, weights);
  return Math.sqrt(values.reduce((a, v, i) => a + weights[i] * (v - m) ** 2, 0) / total);
}

/* ------------------------------------------------------------------ */
/* Regression                                                          */
/* ------------------------------------------------------------------ */

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Standard error of the slope; absent when there are too few points. */
  se?: number;
  df: number;
  n: number;
}

/**
 * Weighted least squares of y on x.
 *
 * Weights are rescaled to sum to n so they behave like counts, which keeps the
 * usual n - 2 degrees of freedom meaningful. With two points a line fits
 * exactly and there is nothing left over to estimate its uncertainty from, so
 * no standard error is reported rather than a misleading zero.
 */
export function weightedFit(xs: number[], ys: number[], ws?: number[]): LinearFit {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0, df: 0, n };
  if (n === 1) return { slope: 0, intercept: ys[0], df: 0, n };

  const raw = ws ?? xs.map(() => 1);
  const total = sum(raw) || n;
  const w = raw.map((v) => (v * n) / total);

  const xBar = xs.reduce((a, x, i) => a + w[i] * x, 0) / n;
  const yBar = ys.reduce((a, y, i) => a + w[i] * y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += w[i] * (xs[i] - xBar) ** 2;
    sxy += w[i] * (xs[i] - xBar) * (ys[i] - yBar);
  }
  if (sxx === 0) return { slope: 0, intercept: yBar, df: n - 2, n };

  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  if (n <= 2) return { slope, intercept, df: 0, n };

  let rss = 0;
  for (let i = 0; i < n; i += 1) rss += w[i] * (ys[i] - (intercept + slope * xs[i])) ** 2;
  const se = Math.sqrt(rss / (n - 2) / sxx);
  return { slope, intercept, se, df: n - 2, n };
}

/**
 * One-sided 95% points of Student's t, so slope +/- t * se is a two-sided 90%
 * interval. Tabulated rather than computed: the degrees of freedom here are
 * small whole numbers and a table is exact where an approximation is not.
 */
const T_95: Record<number, number> = {
  1: 6.314, 2: 2.92, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.86, 9: 1.833, 10: 1.812,
  11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753, 16: 1.746, 17: 1.74, 18: 1.734, 19: 1.729,
  20: 1.725, 21: 1.721, 22: 1.717, 23: 1.714, 24: 1.711, 25: 1.708, 26: 1.706, 27: 1.703, 28: 1.701,
  29: 1.699, 30: 1.697,
};

export function tCritical90(df: number): number {
  if (df <= 0) return Infinity;
  if (df <= 30) return T_95[Math.floor(df)];
  if (df <= 40) return 1.684;
  if (df <= 60) return 1.671;
  if (df <= 120) return 1.658;
  return 1.645;
}

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

/**
 * Mulberry32. The forecast is a simulation, but the same data must always
 * give the same answer - a number that changes every time the page is opened
 * is not a forecast anyone can act on. Seeding from the data itself means a
 * new mock changes the result and nothing else does.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, for turning the evidence into a seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Standard normal via Box-Muller. */
export function normal(random: () => number): number {
  let u = 0;
  while (u === 0) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Draws an index with probability proportional to its weight. */
export function weightedPicker(weights: number[], random: () => number): () => number {
  const cumulative: number[] = [];
  let running = 0;
  for (const w of weights) {
    running += w;
    cumulative.push(running);
  }
  return () => {
    const target = random() * running;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
