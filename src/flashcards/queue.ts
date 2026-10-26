/**
 * What to study, in what order. Pure.
 *
 * Anki's rules, in short: learning cards that are due come first, because
 * their whole point is a short gap. Then the day's reviews and new cards,
 * mixed evenly rather than all of one then all of the other. New cards and
 * reviews are each capped per deck per day, and the caps count what has
 * already been studied today, so closing the app and reopening it does not
 * hand you another twenty new cards.
 */
import type { CardReview, Deck, Flashcard } from '../domain/types';
import { studyDay } from './scheduler';

/** Learning cards may be shown this early when nothing else is waiting. */
export const LEARN_AHEAD_MS = 20 * 60_000;

export interface DeckCounts {
  /** New cards still to introduce today. */
  newCount: number;
  /** Learning and relearning cards due now or within the learn-ahead window. */
  learning: number;
  /** Review cards due today, within today's limit. */
  review: number;
  /** Every card in the deck. */
  total: number;
  suspended: number;
}

/** How much of today's allowance each deck has already used. */
export function usedToday(reviews: CardReview[], now: number): Map<string, { introduced: number; reviewed: number }> {
  const today = studyDay(now);
  const out = new Map<string, { introduced: number; reviewed: number }>();
  for (const r of reviews) {
    if (studyDay(r.at) !== today) continue;
    const entry = out.get(r.deckId) ?? { introduced: 0, reviewed: 0 };
    if (r.stateBefore === 'new') entry.introduced += 1;
    else if (r.stateBefore === 'review') entry.reviewed += 1;
    out.set(r.deckId, entry);
  }
  return out;
}

interface Pools {
  learning: Flashcard[];
  reviews: Flashcard[];
  news: Flashcard[];
  total: number;
  suspended: number;
}

function pools(deck: Deck, cards: Flashcard[], used: { introduced: number; reviewed: number } | undefined, now: number): Pools {
  const own = cards.filter((c) => c.deckId === deck.id);
  const active = own.filter((c) => !c.suspended);
  const newAllowance = Math.max(0, deck.options.newPerDay - (used?.introduced ?? 0));
  const reviewAllowance = Math.max(0, deck.options.reviewsPerDay - (used?.reviewed ?? 0));

  return {
    learning: active
      .filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.due <= now + LEARN_AHEAD_MS)
      .sort((a, b) => a.due - b.due),
    reviews: active
      .filter((c) => c.state === 'review' && c.due <= now)
      .sort((a, b) => a.due - b.due || a.position - b.position)
      .slice(0, reviewAllowance),
    news: active
      .filter((c) => c.state === 'new')
      .sort((a, b) => a.position - b.position)
      .slice(0, newAllowance),
    total: own.length,
    suspended: own.length - active.length,
  };
}

export function deckCounts(deck: Deck, cards: Flashcard[], reviews: CardReview[], now: number): DeckCounts {
  const p = pools(deck, cards, usedToday(reviews, now).get(deck.id), now);
  return { newCount: p.news.length, learning: p.learning.length, review: p.reviews.length, total: p.total, suspended: p.suspended };
}

/**
 * Spreads new cards evenly through the reviews: with 30 reviews and 10 new
 * cards, roughly every fourth card is new.
 */
export function interleave<T>(reviews: T[], news: T[]): T[] {
  const total = reviews.length + news.length;
  const out: T[] = [];
  let r = 0;
  let n = 0;
  for (let k = 0; k < total; k += 1) {
    const dueForNew = news.length > 0 && ((n + 1) * total) / (news.length + 1) <= k + 1;
    if ((dueForNew && n < news.length) || r >= reviews.length) out.push(news[n++]);
    else out.push(reviews[r++]);
  }
  return out;
}

/** The day's reviews and new cards for a set of decks, in study order. */
export function buildQueue(decks: Deck[], cards: Flashcard[], reviews: CardReview[], now: number): string[] {
  const used = usedToday(reviews, now);
  const allReviews: Flashcard[] = [];
  const allNew: Flashcard[] = [];
  for (const deck of decks) {
    const p = pools(deck, cards, used.get(deck.id), now);
    allReviews.push(...p.reviews);
    allNew.push(...p.news);
  }
  allReviews.sort((a, b) => a.due - b.due);
  return interleave(allReviews, allNew).map((c) => c.id);
}

export interface Pick {
  /** The card to show now, if any. */
  cardId?: string;
  /** When nothing is due yet but a learning card will be, the moment it will be. */
  waitUntil?: number;
}

/**
 * The next card to show.
 *
 * A learning card that is due wins over everything; the queue comes next;
 * then a learning card that is due soon, shown a little early rather than
 * leaving you waiting. Queue entries that no longer apply - answered,
 * suspended, deleted - are skipped rather than trusted.
 */
export function pickNext(queue: string[], deckIds: Set<string>, cards: Flashcard[], now: number): Pick {
  const inSession = cards.filter((c) => deckIds.has(c.deckId) && !c.suspended);
  const learning = inSession
    .filter((c) => c.state === 'learning' || c.state === 'relearning')
    .sort((a, b) => a.due - b.due);

  const dueLearning = learning.find((c) => c.due <= now);
  if (dueLearning) return { cardId: dueLearning.id };

  const byId = new Map(inSession.map((c) => [c.id, c]));
  for (const id of queue) {
    const card = byId.get(id);
    if (!card) continue;
    if (card.state === 'new' || (card.state === 'review' && card.due <= now)) return { cardId: id };
  }

  const soon = learning.find((c) => c.due <= now + LEARN_AHEAD_MS);
  if (soon) return { cardId: soon.id };

  const today = studyDay(now);
  const later = learning.find((c) => studyDay(c.due) === today);
  return later ? { waitUntil: later.due } : {};
}

/** Counts shown above the card during a session: new, learning, review. */
export function sessionCounts(queue: string[], deckIds: Set<string>, cards: Flashcard[], now: number): { newCount: number; learning: number; review: number } {
  const byId = new Map(cards.map((c) => [c.id, c]));
  let newCount = 0;
  let review = 0;
  for (const id of queue) {
    const c = byId.get(id);
    if (!c || c.suspended) continue;
    if (c.state === 'new') newCount += 1;
    else if (c.state === 'review' && c.due <= now) review += 1;
  }
  const learning = cards.filter(
    (c) => deckIds.has(c.deckId) && !c.suspended && (c.state === 'learning' || c.state === 'relearning') && c.due <= now + LEARN_AHEAD_MS,
  ).length;
  return { newCount, learning, review };
}
