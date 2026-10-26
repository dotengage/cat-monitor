/**
 * Scheduler tests.
 *
 * The first block reproduces the buttons in a real Anki screenshot of a new
 * card - "<1m, <6m, <10m, 3d" - with default options, which pins the
 * learning-step and fuzz behaviour to Anki's rather than to a textbook SM-2.
 */
import { describe, expect, it } from 'vitest';
import type { Flashcard } from '../../domain/types';
import {
  AGAIN,
  answer,
  dayStart,
  DEFAULT_DECK_OPTIONS,
  EASY,
  formatDays,
  formatOutcome,
  fuzzBounds,
  GOOD,
  HARD,
  hardDelayMinutes,
  isLeechLapse,
  outcomes,
  passingIntervals,
  studyDay,
} from '../scheduler';

const NOW = new Date(2026, 9, 26, 15, 57).getTime();
const O = DEFAULT_DECK_OPTIONS;

function card(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-1',
    createdAt: '',
    updatedAt: '',
    deckId: 'deck',
    front: 'Q',
    back: 'A',
    tags: [],
    state: 'new',
    suspended: false,
    step: 0,
    interval: 0,
    ease: 2.5,
    due: 0,
    position: 1,
    reps: 0,
    lapses: 0,
    leech: false,
    ...over,
  };
}

const labels = (c: Flashcard, now = NOW) => {
  const o = outcomes(c, O, now);
  return [formatOutcome(o[1]), formatOutcome(o[2]), formatOutcome(o[3]), formatOutcome(o[4])];
};

describe('a new card, default options', () => {
  it('shows the same buttons as Anki: <1m, <6m, <10m, and a fuzzed 4 days', () => {
    const [again, hard, good, easy] = labels(card());
    expect(again).toBe('<1m');
    expect(hard).toBe('<6m'); // average of the 1m and 10m steps
    expect(good).toBe('<10m');
    expect(['3d', '4d', '5d']).toContain(easy);
  });

  it('moves to the second step on Good', () => {
    const next = answer(card(), GOOD, O, NOW).card;
    expect(next.state).toBe('learning');
    expect(next.step).toBe(1);
    expect(next.due).toBe(NOW + 10 * 60_000);
  });

  it('graduates to a one-day review from the last step', () => {
    const learning = card({ state: 'learning', step: 1, reps: 1 });
    const next = answer(learning, GOOD, O, NOW).card;
    expect(next.state).toBe('review');
    expect(next.interval).toBe(1);
    expect(next.ease).toBe(2.5);
  });

  it('repeats the current step on Hard after the first step', () => {
    expect(labels(card({ state: 'learning', step: 1, reps: 1 }))[1]).toBe('<10m');
  });

  it('sends the card back to the first step on Again', () => {
    const next = answer(card({ state: 'learning', step: 1, reps: 1 }), AGAIN, O, NOW).card;
    expect(next.step).toBe(0);
    expect(next.due).toBe(NOW + 60_000);
  });

  it('never changes ease while learning', () => {
    const next = answer(card({ state: 'learning', step: 1, ease: 2.5 }), AGAIN, O, NOW).card;
    expect(next.ease).toBe(2.5);
  });
});

describe('hardDelayMinutes', () => {
  it('handles a single learning step as one and a half times it', () => {
    expect(hardDelayMinutes([10], 0)).toBe(15);
  });

  it('never adds more than a day for a single long step', () => {
    expect(hardDelayMinutes([3 * 1440], 0)).toBe(4 * 1440);
  });
});

describe('a review card', () => {
  const due = dayStart(studyDay(NOW)); // due today, answered on time
  const review = card({ state: 'review', interval: 10, ease: 2.5, due, reps: 5 });

  it('keeps Hard, Good and Easy strictly apart', () => {
    const { hard, good, easy } = passingIntervals(review, O, NOW);
    expect(hard).toBeGreaterThan(10);
    expect(good).toBeGreaterThan(hard);
    expect(easy).toBeGreaterThan(good);
  });

  it('lands Good near interval x ease', () => {
    const { good } = passingIntervals(review, O, NOW);
    const [lo, hi] = fuzzBounds(25, 1, O.maximumInterval);
    expect(good).toBeGreaterThanOrEqual(lo);
    expect(good).toBeLessThanOrEqual(hi);
  });

  it('adjusts ease by -15 for Hard and +15 for Easy, and leaves it for Good', () => {
    expect(answer(review, HARD, O, NOW).card.ease).toBeCloseTo(2.35, 10);
    expect(answer(review, GOOD, O, NOW).card.ease).toBe(2.5);
    expect(answer(review, EASY, O, NOW).card.ease).toBeCloseTo(2.65, 10);
  });

  it('puts a lapse into relearning, drops ease by 20 and resets the interval', () => {
    const next = answer(review, AGAIN, O, NOW).card;
    expect(next.state).toBe('relearning');
    expect(next.lapses).toBe(1);
    expect(next.ease).toBeCloseTo(2.3, 10);
    expect(next.interval).toBe(1); // 10 x 0, floored at the 1-day minimum
    expect(next.due).toBe(NOW + 10 * 60_000);
  });

  it('never lets ease fall below 130%', () => {
    expect(answer(card({ state: 'review', interval: 10, ease: 1.35, due }), AGAIN, O, NOW).card.ease).toBe(1.3);
  });

  it('returns from relearning to the lapse interval', () => {
    const relearning = card({ state: 'relearning', step: 0, interval: 3, ease: 2.3, due: NOW, lapses: 1 });
    const next = answer(relearning, GOOD, O, NOW).card;
    expect(next.state).toBe('review');
    expect(next.interval).toBe(3);
  });

  it('credits half of a late review to Good and all of it to Easy', () => {
    const late = card({ state: 'review', interval: 10, ease: 2.5, due: dayStart(studyDay(NOW) - 4), reps: 5 });
    const onTime = passingIntervals(review, O, NOW);
    const delayed = passingIntervals(late, O, NOW);
    expect(delayed.good).toBeGreaterThan(onTime.good);
    expect(delayed.easy).toBeGreaterThan(onTime.easy);
  });

  it('never exceeds the maximum interval', () => {
    const huge = card({ state: 'review', interval: 30000, ease: 3, due, reps: 9 });
    expect(passingIntervals(huge, O, NOW).easy).toBeLessThanOrEqual(O.maximumInterval);
  });

  it('schedules review cards at the start of a study day', () => {
    const next = answer(review, GOOD, O, NOW).card;
    expect(new Date(next.due).getHours()).toBe(4);
  });
});

describe('fuzz', () => {
  it('does not fuzz intervals under 2.5 days', () => {
    expect(fuzzBounds(2, 1, 36500)).toEqual([2, 2]);
  });

  it("matches Anki's bands", () => {
    // delta = 1 + 0.15 x (4 - 2.5) = 1.225
    expect(fuzzBounds(4, 1, 36500)).toEqual([3, 5]);
    // delta = 1 + 0.15 x 4.5 + 0.10 x 13 + 0.05 x 80 = 6.975
    expect(fuzzBounds(100, 1, 36500)).toEqual([93, 107]);
  });

  it('is the same every time for the same card and history', () => {
    const c = card({ state: 'review', interval: 30, ease: 2.5, due: dayStart(studyDay(NOW)), reps: 7 });
    expect(passingIntervals(c, O, NOW)).toEqual(passingIntervals(c, O, NOW));
  });

  it('shows on the button exactly what the button does', () => {
    const c = card({ state: 'review', interval: 30, ease: 2.5, due: dayStart(studyDay(NOW)), reps: 7 });
    const shown = outcomes(c, O, NOW)[GOOD].interval;
    expect(answer(c, GOOD, O, NOW).card.interval).toBe(shown);
  });
});

describe('leeches', () => {
  it('flags at the threshold and every half-threshold after', () => {
    expect([7, 8, 9, 10, 11, 12].map((n) => isLeechLapse(n, 8))).toEqual([false, true, false, false, false, true]);
  });

  it('tags the card on the lapse that crosses the threshold', () => {
    const struggling = card({ state: 'review', interval: 5, ease: 1.3, due: NOW, lapses: 7 });
    const next = answer(struggling, AGAIN, O, NOW).card;
    expect(next.leech).toBe(true);
    expect(next.tags).toContain('leech');
  });
});

describe('labels', () => {
  it('formats days, months and years like Anki', () => {
    expect(formatDays(3)).toBe('3d');
    expect(formatDays(45)).toBe('1.5mo');
    expect(formatDays(730)).toBe('2y');
  });
});

describe('study days', () => {
  it('counts 2am as the previous day', () => {
    const lateNight = new Date(2026, 9, 27, 2, 0).getTime();
    const evening = new Date(2026, 9, 26, 22, 0).getTime();
    expect(studyDay(lateNight)).toBe(studyDay(evening));
  });

  it('round-trips through dayStart', () => {
    const d = studyDay(NOW);
    expect(studyDay(dayStart(d))).toBe(d);
  });
});
