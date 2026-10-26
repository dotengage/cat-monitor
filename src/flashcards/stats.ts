/**
 * Flashcard statistics, rebuilt from the review history each time.
 *
 * Mirrors what Anki's statistics screen reports, with one emphasis of our
 * own: retention is shown as Anki calls it, "true retention" - the share of
 * review answers that were not Again - split by young and mature cards,
 * because that is the number spaced repetition is actually trying to hold
 * steady. Card counts and streaks are context for it.
 */
import type { CardReview, Flashcard } from '../domain/types';
import { dayStart, studyDay } from './scheduler';

/** Anki's line between a young and a mature card. */
export const MATURE_DAYS = 21;

export interface Rate {
  passed: number;
  total: number;
  /** Null when there is nothing to divide. */
  rate: number | null;
}

export interface DayActivity {
  day: number;
  date: Date;
  count: number;
  timeMs: number;
  learn: number;
  review: number;
  again: number;
}

export interface FlashcardStats {
  today: { studied: number; timeMs: number; again: number; learn: number; review: number; relearn: number; correct: Rate };
  counts: { new: number; learning: number; young: number; mature: number; suspended: number; total: number };
  retention: { young: Rate; mature: Rate; total: Rate; windowDays: number };
  activity: DayActivity[];
  forecast: { offset: number; count: number }[];
  streak: { current: number; best: number; daysStudied: number };
  intervals: { label: string; count: number }[];
  averageEase: number | null;
  averageIntervalDays: number | null;
  buttons: Record<'learning' | 'young' | 'mature', [number, number, number, number]>;
  heatmap: Map<number, number>;
  averageSecondsPerCard: number | null;
  totalReviews: number;
}

const rate = (passed: number, total: number): Rate => ({ passed, total, rate: total > 0 ? passed / total : null });

const INTERVAL_BUCKETS: [string, number, number][] = [
  ['1 day', 1, 1],
  ['2-3 days', 2, 3],
  ['4-7 days', 4, 7],
  ['1-2 weeks', 8, 14],
  ['2-4 weeks', 15, 30],
  ['1-3 months', 31, 91],
  ['3-6 months', 92, 182],
  ['6 months+', 183, Infinity],
];

export function computeStats(
  cards: Flashcard[],
  reviews: CardReview[],
  now: number,
  options: { deckIds?: Set<string>; windowDays?: number; forecastDays?: number; activityDays?: number } = {},
): FlashcardStats {
  const deckIds = options.deckIds;
  const windowDays = options.windowDays ?? 30;
  const forecastDays = options.forecastDays ?? 30;
  const activityDays = options.activityDays ?? 30;
  const ownCards = deckIds ? cards.filter((c) => deckIds.has(c.deckId)) : cards;
  const ownReviews = deckIds ? reviews.filter((r) => deckIds.has(r.deckId)) : reviews;
  const today = studyDay(now);

  /* ---- Today ---- */
  const todays = ownReviews.filter((r) => studyDay(r.at) === today);
  const todaysReviewAnswers = todays.filter((r) => r.stateBefore === 'review');
  const todayStats = {
    studied: todays.length,
    timeMs: todays.reduce((a, r) => a + r.timeMs, 0),
    again: todays.filter((r) => r.rating === 1).length,
    learn: todays.filter((r) => r.stateBefore === 'new' || r.stateBefore === 'learning').length,
    review: todaysReviewAnswers.length,
    relearn: todays.filter((r) => r.stateBefore === 'relearning').length,
    correct: rate(todaysReviewAnswers.filter((r) => r.rating > 1).length, todaysReviewAnswers.length),
  };

  /* ---- Card counts ---- */
  const active = ownCards.filter((c) => !c.suspended);
  const counts = {
    new: active.filter((c) => c.state === 'new').length,
    learning: active.filter((c) => c.state === 'learning' || c.state === 'relearning').length,
    young: active.filter((c) => c.state === 'review' && c.interval < MATURE_DAYS).length,
    mature: active.filter((c) => c.state === 'review' && c.interval >= MATURE_DAYS).length,
    suspended: ownCards.length - active.length,
    total: ownCards.length,
  };

  /* ---- True retention ---- */
  const windowStart = dayStart(today - windowDays + 1);
  const reviewAnswers = ownReviews.filter((r) => r.stateBefore === 'review' && r.at >= windowStart);
  const young = reviewAnswers.filter((r) => r.lastInterval < MATURE_DAYS);
  const mature = reviewAnswers.filter((r) => r.lastInterval >= MATURE_DAYS);
  const passed = (list: CardReview[]) => list.filter((r) => r.rating > 1).length;
  const retention = {
    young: rate(passed(young), young.length),
    mature: rate(passed(mature), mature.length),
    total: rate(passed(reviewAnswers), reviewAnswers.length),
    windowDays,
  };

  /* ---- Activity, heatmap and streak ---- */
  const byDay = new Map<number, CardReview[]>();
  for (const r of ownReviews) {
    const d = studyDay(r.at);
    const list = byDay.get(d);
    if (list) list.push(r);
    else byDay.set(d, [r]);
  }
  const activity: DayActivity[] = [];
  for (let d = today - activityDays + 1; d <= today; d += 1) {
    const list = byDay.get(d) ?? [];
    activity.push({
      day: d,
      date: new Date(dayStart(d)),
      count: list.length,
      timeMs: list.reduce((a, r) => a + r.timeMs, 0),
      learn: list.filter((r) => r.stateBefore !== 'review').length,
      review: list.filter((r) => r.stateBefore === 'review').length,
      again: list.filter((r) => r.rating === 1).length,
    });
  }
  const heatmap = new Map<number, number>();
  for (const [d, list] of byDay) heatmap.set(d, list.length);

  const studiedDays = [...byDay.keys()].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let previous = -Infinity;
  for (const d of studiedDays) {
    run = d === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = d;
  }
  // A streak survives until the end of today: not having studied yet today
  // does not break yesterday's run.
  let current = 0;
  for (let d = byDay.has(today) ? today : today - 1; byDay.has(d); d -= 1) current += 1;

  /* ---- Forecast ---- */
  const forecast = Array.from({ length: forecastDays }, (_, offset) => ({ offset, count: 0 }));
  for (const c of active) {
    if (c.state === 'new') continue;
    const offset = Math.max(0, studyDay(c.due) - today);
    if (offset < forecastDays) forecast[offset].count += 1;
  }

  /* ---- Intervals and ease ---- */
  const reviewCards = active.filter((c) => c.state === 'review');
  const intervals = INTERVAL_BUCKETS.map(([label, lo, hi]) => ({
    label,
    count: reviewCards.filter((c) => c.interval >= lo && c.interval <= hi).length,
  }));
  const averageEase = reviewCards.length > 0 ? reviewCards.reduce((a, c) => a + c.ease, 0) / reviewCards.length : null;
  const averageIntervalDays = reviewCards.length > 0 ? reviewCards.reduce((a, c) => a + c.interval, 0) / reviewCards.length : null;

  /* ---- Answer buttons ---- */
  const buttons: FlashcardStats['buttons'] = { learning: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] };
  for (const r of ownReviews.filter((x) => x.at >= windowStart)) {
    const kind = r.stateBefore !== 'review' ? 'learning' : r.lastInterval >= MATURE_DAYS ? 'mature' : 'young';
    buttons[kind][r.rating - 1] += 1;
  }

  const timed = ownReviews.filter((r) => r.timeMs > 0);
  return {
    today: todayStats,
    counts,
    retention,
    activity,
    forecast,
    streak: { current, best, daysStudied: studiedDays.length },
    intervals,
    averageEase,
    averageIntervalDays,
    buttons,
    heatmap,
    averageSecondsPerCard: timed.length > 0 ? timed.reduce((a, r) => a + r.timeMs, 0) / timed.length / 1000 : null,
    totalReviews: ownReviews.length,
  };
}
