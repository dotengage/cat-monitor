/**
 * Attempted, correct and incorrect are one fact told three ways: attempted is
 * correct plus incorrect. Given any two, the third is arithmetic, and making
 * someone type it is making them do the computer's job - and giving them a
 * chance to get it wrong.
 */
export type Count = 'attempts' | 'correct' | 'incorrect';

export interface Counts {
  attempts: number;
  correct: number;
  incorrect: number;
}

/**
 * Fills whichever of the three was not entered, from the two that were.
 *
 * Works from what was *entered*, not from which values are non-zero: zero
 * correct is a real result, and treating it as blank would overwrite it.
 * Returns the completed counts and the field it worked out, if any.
 */
export function completeCounts(values: Counts, entered: ReadonlySet<string>): { values: Counts; derived: Count | null } {
  const has = (k: Count) => entered.has(k);
  if (has('attempts') && has('correct') && !has('incorrect')) {
    return { values: { ...values, incorrect: Math.max(0, values.attempts - values.correct) }, derived: 'incorrect' };
  }
  if (has('correct') && has('incorrect') && !has('attempts')) {
    return { values: { ...values, attempts: values.correct + values.incorrect }, derived: 'attempts' };
  }
  if (has('attempts') && has('incorrect') && !has('correct')) {
    return { values: { ...values, correct: Math.max(0, values.attempts - values.incorrect) }, derived: 'correct' };
  }
  return { values, derived: null };
}
