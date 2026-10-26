import { describe, expect, it } from 'vitest';
import type { CardReview, Flashcard } from '../../domain/types';
import { dayStart, studyDay } from '../scheduler';
import { computeStats } from '../stats';

const NOW = new Date(2026, 9, 26, 15, 0).getTime();
const TODAY = studyDay(NOW);
const at = (daysAgo: number, hour = 12) => dayStart(TODAY - daysAgo) + (hour - 4) * 3_600_000;

let n = 0;
const review = (over: Partial<CardReview>): CardReview => ({
  id: `r${(n += 1)}`,
  createdAt: '',
  updatedAt: '',
  cardId: 'c',
  deckId: 'd1',
  rating: 3,
  stateBefore: 'review',
  interval: 10,
  lastInterval: 5,
  ease: 2.5,
  timeMs: 6000,
  at: at(0),
  ...over,
});

const card = (over: Partial<Flashcard>): Flashcard => ({
  id: `c${(n += 1)}`,
  createdAt: '',
  updatedAt: '',
  deckId: 'd1',
  front: '',
  back: '',
  tags: [],
  state: 'review',
  suspended: false,
  step: 0,
  interval: 5,
  ease: 2.5,
  due: dayStart(TODAY + 3),
  position: n,
  reps: 3,
  lapses: 0,
  leech: false,
  ...over,
});

describe('computeStats', () => {
  it('measures true retention as review answers that were not Again, split by maturity', () => {
    const reviews = [
      review({ rating: 3, lastInterval: 5 }),
      review({ rating: 1, lastInterval: 5 }),
      review({ rating: 3, lastInterval: 40 }),
      review({ rating: 4, lastInterval: 40 }),
      review({ rating: 1, stateBefore: 'learning' }), // learning answers do not count
    ];
    const s = computeStats([], reviews, NOW);
    expect(s.retention.young).toMatchObject({ passed: 1, total: 2, rate: 0.5 });
    expect(s.retention.mature).toMatchObject({ passed: 2, total: 2, rate: 1 });
    expect(s.retention.total.total).toBe(4);
  });

  it('reports no rate, rather than 0%, when there is nothing to measure', () => {
    expect(computeStats([], [], NOW).retention.total.rate).toBeNull();
  });

  it('counts cards by state, with 21 days as the mature line', () => {
    const s = computeStats(
      [card({ state: 'new' }), card({ state: 'learning' }), card({ interval: 20 }), card({ interval: 21 }), card({ suspended: true })],
      [],
      NOW,
    );
    expect(s.counts).toMatchObject({ new: 1, learning: 1, young: 1, mature: 1, suspended: 1, total: 5 });
  });

  it("does not break the streak just because today's session has not happened yet", () => {
    const reviews = [review({ at: at(1) }), review({ at: at(2) }), review({ at: at(3) })];
    expect(computeStats([], reviews, NOW).streak.current).toBe(3);
  });

  it('breaks the streak on a missed day and keeps the best run', () => {
    const reviews = [review({ at: at(0) }), review({ at: at(2) }), review({ at: at(3) }), review({ at: at(4) })];
    const s = computeStats([], reviews, NOW);
    expect(s.streak.current).toBe(1);
    expect(s.streak.best).toBe(3);
  });

  it('counts reviews before 4am towards the previous study day', () => {
    const lateNight = dayStart(TODAY) - 60 * 60_000; // 3am today = yesterday's study day
    expect(computeStats([], [review({ at: lateNight })], NOW).today.studied).toBe(0);
  });

  it('forecasts due cards by day, with overdue cards counted today', () => {
    const s = computeStats([card({ due: dayStart(TODAY - 2) }), card({ due: dayStart(TODAY + 3) }), card({ state: 'new' })], [], NOW);
    expect(s.forecast[0].count).toBe(1);
    expect(s.forecast[3].count).toBe(1);
  });

  it('filters to the chosen decks', () => {
    const s = computeStats([card({ deckId: 'd1' }), card({ deckId: 'd2' })], [review({ deckId: 'd2' })], NOW, { deckIds: new Set(['d1']) });
    expect(s.counts.total).toBe(1);
    expect(s.totalReviews).toBe(0);
  });
});
