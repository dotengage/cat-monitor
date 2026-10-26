/**
 * The marks-to-percentile curve (forecast guide, step 2).
 *
 * Percentile is a compressed, nonlinear scale: near the top, each extra
 * percentile point costs more marks than the last. Averaging percentiles, or
 * fitting a straight line through them, therefore distorts both the level and
 * the trend. All the arithmetic is done in marks, and this curve - fitted to
 * your own (marks, percentile) pairs - converts back only at the end.
 *
 * With five or more pairs it is a logistic, fitted by least squares on the
 * logit. With fewer, it falls back to interpolation and says so. The fallback
 * interpolates in logit space rather than percentile space, which keeps it
 * monotonic and bounded between 0 and 100 even when it has to extrapolate past
 * the observed range - a straight line in percentile space would happily
 * predict 104.
 */

export interface Curve {
  method: 'logistic' | 'interpolated';
  /** True when fewer than five pairs stand behind it. */
  provisional: boolean;
  pairs: number;
  toPercentile(marks: number): number;
  toMarks(percentile: number): number;
  /** Marks needed for one more percentile point, at a given percentile. */
  marksPerPoint(percentile: number): number;
}

export interface Pair {
  marks: number;
  percentile: number;
}

const P_FLOOR = 0.5;
const P_CEILING = 99.95;
export const MIN_LOGISTIC_PAIRS = 5;

const clampP = (p: number) => Math.min(P_CEILING, Math.max(P_FLOOR, p));
export const logit = (p: number): number => {
  const q = clampP(p) / 100;
  return Math.log(q / (1 - q));
};
export const fromLogit = (z: number): number => clampP(100 / (1 + Math.exp(-z)));

/** dP/dz of the logistic, used to turn a slope in logit space into one in points. */
const pointsPerLogit = (p: number) => {
  const q = clampP(p) / 100;
  return 100 * q * (1 - q);
};

function logistic(a: number, b: number, pairs: number): Curve {
  return {
    method: 'logistic',
    provisional: false,
    pairs,
    toPercentile: (marks) => fromLogit(a + b * marks),
    toMarks: (percentile) => (logit(percentile) - a) / b,
    marksPerPoint: (percentile) => 1 / (b * pointsPerLogit(percentile)),
  };
}

/**
 * Pool-adjacent-violators: the closest non-decreasing sequence to the data.
 *
 * Two mocks from different providers can easily put a higher score at a lower
 * percentile. Interpolating straight through that would make the curve run
 * backwards - more marks, less percentile - so violating neighbours are pooled
 * into their weighted mean first.
 */
function isotonic(points: { x: number; y: number; w: number }[]): { x: number; y: number; w: number }[] {
  const blocks = points.map((p) => ({ ...p }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].y > blocks[i + 1].y) {
      const a = blocks[i];
      const b = blocks[i + 1];
      const w = a.w + b.w;
      blocks.splice(i, 2, { x: (a.x * a.w + b.x * b.w) / w, y: (a.y * a.w + b.y * b.w) / w, w });
      if (i > 0) i -= 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}

function interpolated(pairs: Pair[]): Curve | null {
  const sorted = [...pairs].sort((a, b) => a.marks - b.marks);

  // Identical marks are one observation of the curve, not several.
  const grouped: { x: number; y: number; w: number }[] = [];
  for (const p of sorted) {
    const last = grouped[grouped.length - 1];
    const z = logit(p.percentile);
    if (last && last.x === p.marks) {
      last.y = (last.y * last.w + z) / (last.w + 1);
      last.w += 1;
    } else {
      grouped.push({ x: p.marks, y: z, w: 1 });
    }
  }

  const knots = isotonic(grouped);
  // Pooling can leave equal neighbours; merge them so the curve is strictly
  // increasing and therefore invertible.
  const strict: { x: number; y: number }[] = [];
  for (const k of knots) {
    const last = strict[strict.length - 1];
    if (last && Math.abs(last.y - k.y) < 1e-9) last.x = (last.x + k.x) / 2;
    else strict.push({ x: k.x, y: k.y });
  }
  if (strict.length < 2) return null;

  const first = strict[0];
  const last = strict[strict.length - 1];
  const edgeSlope = (last.y - first.y) / (last.x - first.x);
  if (!(edgeSlope > 0)) return null;

  const zAt = (marks: number): number => {
    if (marks <= first.x) return first.y + (marks - first.x) * edgeSlope;
    if (marks >= last.x) return last.y + (marks - last.x) * edgeSlope;
    for (let i = 1; i < strict.length; i += 1) {
      if (marks <= strict[i].x) {
        const a = strict[i - 1];
        const b = strict[i];
        return a.y + ((marks - a.x) / (b.x - a.x)) * (b.y - a.y);
      }
    }
    return last.y;
  };

  const slopeAt = (marks: number): number => {
    if (marks <= first.x || marks >= last.x) return edgeSlope;
    for (let i = 1; i < strict.length; i += 1) {
      if (marks <= strict[i].x) return (strict[i].y - strict[i - 1].y) / (strict[i].x - strict[i - 1].x);
    }
    return edgeSlope;
  };

  const marksAt = (z: number): number => {
    if (z <= first.y) return first.x + (z - first.y) / edgeSlope;
    if (z >= last.y) return last.x + (z - last.y) / edgeSlope;
    for (let i = 1; i < strict.length; i += 1) {
      if (z <= strict[i].y) {
        const a = strict[i - 1];
        const b = strict[i];
        return a.x + ((z - a.y) / (b.y - a.y)) * (b.x - a.x);
      }
    }
    return last.x;
  };

  return {
    method: 'interpolated',
    provisional: true,
    pairs: pairs.length,
    toPercentile: (marks) => fromLogit(zAt(marks)),
    toMarks: (percentile) => marksAt(logit(percentile)),
    marksPerPoint: (percentile) => 1 / (slopeAt(marksAt(logit(percentile))) * pointsPerLogit(percentile)),
  };
}

/**
 * Fits the curve, or returns null when the pairs cannot support one.
 *
 * Null is a real answer: with one pair, or with pairs that all disagree about
 * direction, there is no honest way to say how many percentile points a mark
 * is worth, and the forecast reports in marks and says what to log instead.
 */
export function fitCurve(raw: Pair[]): Curve | null {
  const pairs = raw.filter(
    (p) => Number.isFinite(p.marks) && Number.isFinite(p.percentile) && p.percentile > 0 && p.percentile < 100,
  );

  if (pairs.length >= MIN_LOGISTIC_PAIRS) {
    const xs = pairs.map((p) => p.marks);
    const zs = pairs.map((p) => logit(p.percentile));
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
    const mz = zs.reduce((a, v) => a + v, 0) / zs.length;
    let sxx = 0;
    let sxz = 0;
    for (let i = 0; i < xs.length; i += 1) {
      sxx += (xs[i] - mx) ** 2;
      sxz += (xs[i] - mx) * (zs[i] - mz);
    }
    const b = sxx === 0 ? 0 : sxz / sxx;
    // A non-increasing fit means the pairs are too noisy to trust a curve
    // through all of them at once; interpolation can still pool them sensibly.
    if (b > 0) return logistic(mz - b * mx, b, pairs.length);
  }

  if (pairs.length >= 2) return interpolated(pairs);
  return null;
}
