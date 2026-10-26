/**
 * Anki's default scheduler (SM-2, as implemented in Anki's v3 scheduler).
 *
 * This follows Anki's own source rather than the textbook SM-2, because the
 * two differ in ways an Anki user would notice: learning steps measured in
 * minutes, four buttons rather than six grades, ease that only moves on review
 * cards, a bonus for reviewing late, separate minimums that keep Hard, Good
 * and Easy from collapsing onto the same interval, and "fuzz" that spreads
 * cards out so a batch added together does not stay together forever.
 *
 * Pure: a card and a moment in, a card and a review record out. Fuzz is
 * seeded from the card's id and its review count, so the interval shown on a
 * button is exactly the interval you get when you press it - as in Anki.
 */
import type { CardState, DeckOptions, Flashcard, Rating } from '../domain/types';

export const DEFAULT_DECK_OPTIONS: DeckOptions = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learnSteps: [1, 10],
  relearnSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardInterval: 1.2,
  intervalModifier: 1,
  newInterval: 0,
  minimumInterval: 1,
  maximumInterval: 36500,
  leechThreshold: 8,
};

export const AGAIN: Rating = 1;
export const HARD: Rating = 2;
export const GOOD: Rating = 3;
export const EASY: Rating = 4;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MIN_EASE = 1.3;

/** Anki's "next day starts at": reviews done before 4am count towards the previous day. */
export const DAY_START_HOUR = 4;

/* ------------------------------------------------------------------ */
/* Study days                                                          */
/* ------------------------------------------------------------------ */

/** The study day a moment belongs to, as a whole-day number in local time. */
export function studyDay(ms: number): number {
  const d = new Date(ms - DAY_START_HOUR * HOUR);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Epoch ms at which a study day begins locally. */
export function dayStart(day: number): number {
  const d = new Date(day * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_START_HOUR).getTime();
}

/* ------------------------------------------------------------------ */
/* Fuzz                                                                */
/* ------------------------------------------------------------------ */

const FUZZ_RANGES: [number, number, number][] = [
  [2.5, 7, 0.15],
  [7, 20, 0.1],
  [20, Infinity, 0.05],
];

function fuzzDelta(interval: number): number {
  if (interval < 2.5) return 0;
  return FUZZ_RANGES.reduce((delta, [start, end, factor]) => delta + factor * Math.max(0, Math.min(interval, end) - start), 1);
}

/** The range an interval may land in. Anki: `constrained_fuzz_bounds`. */
export function fuzzBounds(interval: number, minimum: number, maximum: number): [number, number] {
  const min = Math.min(minimum, maximum);
  const ivl = Math.min(maximum, Math.max(min, interval));
  const delta = fuzzDelta(ivl);
  let lower = Math.max(1, Math.round(ivl - delta));
  let upper = Math.round(ivl + delta);
  lower = Math.min(maximum, Math.max(min, lower));
  upper = Math.min(maximum, Math.max(min, upper));
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return [lower, upper];
}

/** A stable fraction in [0, 1) for this card at this point in its history. */
export function fuzzFactor(card: Pick<Flashcard, 'id' | 'reps'>): number {
  let h = 0x811c9dc5;
  const key = `${card.id}:${card.reps}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // One round of mulberry32 to spread the hash evenly.
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fuzzed(interval: number, minimum: number, maximum: number, factor: number): number {
  const [lower, upper] = fuzzBounds(interval, minimum, maximum);
  return Math.floor(lower + factor * (1 + upper - lower));
}

/* ------------------------------------------------------------------ */
/* Learning steps                                                      */
/* ------------------------------------------------------------------ */

/**
 * Hard on a learning card. On the first step it averages the first two steps
 * (1m and 10m make 6m); with a single step it is one and a half times that
 * step, but never more than a day longer; on any later step it repeats it.
 */
export function hardDelayMinutes(steps: number[], step: number): number {
  if (steps.length === 0) return 0;
  const current = steps[Math.min(step, steps.length - 1)];
  if (step > 0) return current;
  if (steps.length > 1) return (steps[0] + steps[1]) / 2;
  return Math.min(current * 1.5, current + 24 * 60);
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

export interface Outcome {
  state: CardState;
  step: number;
  /** Days, for review outcomes. */
  interval: number;
  ease: number;
  due: number;
  lapses: number;
  leech: boolean;
  /** Minutes until due, for learning outcomes; undefined for review outcomes. */
  delayMinutes?: number;
}

function learningOutcome(card: Flashcard, state: 'learning' | 'relearning', step: number, minutes: number, now: number): Outcome {
  return {
    state,
    step,
    interval: card.interval,
    ease: card.ease,
    due: now + minutes * MINUTE,
    lapses: card.lapses,
    leech: card.leech,
    delayMinutes: minutes,
  };
}

function reviewOutcome(card: Flashcard, interval: number, ease: number, now: number, lapses = card.lapses, leech = card.leech): Outcome {
  return {
    state: 'review',
    step: 0,
    interval,
    ease,
    due: dayStart(studyDay(now) + interval),
    lapses,
    leech,
  };
}

/** Anki's leech rule: at the threshold, then every half-threshold after it. */
export function isLeechLapse(lapses: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

/** The three passing intervals for a review card, kept strictly apart as Anki does. */
export function passingIntervals(card: Flashcard, options: DeckOptions, now: number): { hard: number; good: number; easy: number } {
  const current = card.interval;
  const daysLate = Math.max(0, studyDay(now) - studyDay(card.due));
  const factor = fuzzFactor(card);
  const max = options.maximumInterval;
  const constrain = (value: number, minimum: number) =>
    fuzzed(value * options.intervalModifier, Math.max(1, Math.min(minimum, max)), max, factor);

  const hardMinimum = options.hardInterval <= 1 ? 0 : current + 1;
  const hard = constrain(current * options.hardInterval, hardMinimum);
  const goodMinimum = options.hardInterval <= 1 ? current + 1 : hard + 1;
  const good = constrain((current + daysLate / 2) * card.ease, goodMinimum);
  const easy = constrain((current + daysLate) * card.ease * options.easyBonus, good + 1);
  return { hard, good, easy };
}

/** What each button would do to this card, right now. */
export function outcomes(card: Flashcard, options: DeckOptions, now: number): Record<Rating, Outcome> {
  const factor = fuzzFactor(card);
  const max = options.maximumInterval;

  if (card.state === 'new' || card.state === 'learning') {
    const steps = options.learnSteps.length > 0 ? options.learnSteps : [1];
    const step = card.state === 'new' ? 0 : Math.min(card.step, steps.length - 1);
    const graduate = (days: number) => reviewOutcome(card, fuzzed(days, 1, max, factor), options.startingEase, now);
    return {
      1: learningOutcome(card, 'learning', 0, steps[0], now),
      2: learningOutcome(card, 'learning', step, hardDelayMinutes(steps, step), now),
      3: step + 1 < steps.length ? learningOutcome(card, 'learning', step + 1, steps[step + 1], now) : graduate(options.graduatingInterval),
      4: graduate(options.easyInterval),
    };
  }

  if (card.state === 'relearning') {
    const steps = options.relearnSteps.length > 0 ? options.relearnSteps : [10];
    const step = Math.min(card.step, steps.length - 1);
    return {
      1: learningOutcome(card, 'relearning', 0, steps[0], now),
      2: learningOutcome(card, 'relearning', step, hardDelayMinutes(steps, step), now),
      3: step + 1 < steps.length ? learningOutcome(card, 'relearning', step + 1, steps[step + 1], now) : reviewOutcome(card, card.interval, card.ease, now),
      4: reviewOutcome(card, card.interval + 1, card.ease, now),
    };
  }

  // Review.
  const { hard, good, easy } = passingIntervals(card, options, now);
  const lapses = card.lapses + 1;
  const lapseEase = Math.max(MIN_EASE, card.ease - 0.2);
  // Anki truncates rather than rounds here.
  const lapseInterval = Math.max(options.minimumInterval, 1, Math.floor(card.interval * options.newInterval));
  const leech = card.leech || isLeechLapse(lapses, options.leechThreshold);
  const again: Outcome =
    options.relearnSteps.length > 0
      ? {
          state: 'relearning',
          step: 0,
          interval: lapseInterval,
          ease: lapseEase,
          due: now + options.relearnSteps[0] * MINUTE,
          lapses,
          leech,
          delayMinutes: options.relearnSteps[0],
        }
      : reviewOutcome(card, lapseInterval, lapseEase, now, lapses, leech);

  return {
    1: again,
    2: reviewOutcome(card, hard, Math.max(MIN_EASE, card.ease - 0.15), now),
    3: reviewOutcome(card, good, card.ease, now),
    4: reviewOutcome(card, easy, card.ease + 0.15, now),
  };
}

/** Applies an answer. The card's history counter moves on, which reseeds its fuzz. */
export function answer(
  card: Flashcard,
  rating: Rating,
  options: DeckOptions,
  now: number,
): { card: Flashcard; interval: number; lastInterval: number } {
  const outcome = outcomes(card, options, now)[rating];
  const lastInterval = card.state === 'review' ? card.interval : -Math.round(lastDelay(card, options));
  const next: Flashcard = {
    ...card,
    state: outcome.state,
    step: outcome.step,
    interval: outcome.interval,
    ease: outcome.ease,
    due: outcome.due,
    lapses: outcome.lapses,
    leech: outcome.leech,
    reps: card.reps + 1,
    tags: outcome.leech && !card.tags.includes('leech') ? [...card.tags, 'leech'] : card.tags,
  };
  const interval = outcome.delayMinutes !== undefined ? -Math.round(outcome.delayMinutes) : outcome.interval;
  return { card: next, interval, lastInterval };
}

function lastDelay(card: Flashcard, options: DeckOptions): number {
  if (card.state === 'new') return 0;
  const steps = card.state === 'relearning' ? options.relearnSteps : options.learnSteps;
  return steps[Math.min(card.step, steps.length - 1)] ?? 0;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

const trim = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Anki's button labels: learning delays are prefixed with "<" (the card can
 * come back a little early when nothing else is due), reviews are in days,
 * months or years.
 */
export function formatOutcome(outcome: Outcome): string {
  if (outcome.delayMinutes !== undefined) {
    const m = outcome.delayMinutes;
    if (m < 60) return `<${Math.max(1, Math.round(m))}m`;
    if (m < 24 * 60) return `<${trim(m / 60)}h`;
    return `${trim(m / (24 * 60))}d`;
  }
  return formatDays(outcome.interval);
}

export function formatDays(days: number): string {
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / (365 / 12))}mo`;
  return `${trim(days / 365)}y`;
}

/** Whether a card is due at a given moment (new cards are introduced by the queue, not by date). */
export function isDue(card: Flashcard, now: number): boolean {
  return !card.suspended && card.state !== 'new' && card.due <= now;
}
