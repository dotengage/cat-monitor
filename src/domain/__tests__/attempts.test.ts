import { describe, expect, it } from 'vitest';
import { completeCounts } from '../attempts';

const counts = (attempts: number, correct: number, incorrect: number) => ({ attempts, correct, incorrect });

describe('completeCounts', () => {
  it('works out incorrect from attempted and correct', () => {
    expect(completeCounts(counts(17, 7, 0), new Set(['attempts', 'correct']))).toEqual({ values: counts(17, 7, 10), derived: 'incorrect' });
  });

  it('works out attempted from correct and incorrect', () => {
    expect(completeCounts(counts(0, 9, 3), new Set(['correct', 'incorrect']))).toEqual({ values: counts(12, 9, 3), derived: 'attempts' });
  });

  it('works out correct from attempted and incorrect', () => {
    expect(completeCounts(counts(17, 0, 6), new Set(['attempts', 'incorrect']))).toEqual({ values: counts(17, 11, 6), derived: 'correct' });
  });

  it('treats an entered zero as a real value, not a blank', () => {
    // 8 attempted, 0 correct: all 8 were wrong.
    expect(completeCounts(counts(8, 0, 0), new Set(['attempts', 'correct'])).values.incorrect).toBe(8);
  });

  it('leaves everything alone with fewer than two counts, or all three', () => {
    expect(completeCounts(counts(17, 0, 0), new Set(['attempts'])).derived).toBeNull();
    expect(completeCounts(counts(17, 7, 9), new Set(['attempts', 'correct', 'incorrect'])).values).toEqual(counts(17, 7, 9));
  });

  it('never produces a negative count from inconsistent input', () => {
    expect(completeCounts(counts(5, 7, 0), new Set(['attempts', 'correct'])).values.incorrect).toBe(0);
  });
});
