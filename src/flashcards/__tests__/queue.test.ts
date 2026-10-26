import { describe, expect, it } from 'vitest';
import type { CardReview, Deck, Flashcard } from '../../domain/types';
import { buildQueue, deckCounts, interleave, pickNext, sessionCounts } from '../queue';
import { dayStart, DEFAULT_DECK_OPTIONS, studyDay } from '../scheduler';

const NOW = new Date(2026, 9, 26, 15, 0).getTime();
const TODAY_START = dayStart(studyDay(NOW));

const deck = (id = 'd1', over: Partial<Deck['options']> = {}): Deck => ({
  id,
  createdAt: '',
  updatedAt: '',
  name: id,
  description: '',
  options: { ...DEFAULT_DECK_OPTIONS, ...over },
});

let n = 0;
function card(over: Partial<Flashcard> = {}): Flashcard {
  n += 1;
  return {
    id: `c${n}`,
    createdAt: '',
    updatedAt: '',
    deckId: 'd1',
    front: 'Q',
    back: 'A',
    tags: [],
    state: 'new',
    suspended: false,
    step: 0,
    interval: 0,
    ease: 2.5,
    due: 0,
    position: n,
    reps: 0,
    lapses: 0,
    leech: false,
    ...over,
  };
}

const review = (deckId: string, stateBefore: CardReview['stateBefore'], at = NOW - 60_000): CardReview => ({
  id: `r${(n += 1)}`,
  createdAt: '',
  updatedAt: '',
  cardId: 'x',
  deckId,
  rating: 3,
  stateBefore,
  interval: 1,
  lastInterval: 0,
  ease: 2.5,
  timeMs: 4000,
  at,
});

describe('deckCounts', () => {
  it('caps new cards at the daily limit', () => {
    const cards = Array.from({ length: 30 }, () => card());
    expect(deckCounts(deck(), cards, [], NOW).newCount).toBe(20);
  });

  it('counts cards already introduced today against the limit', () => {
    const cards = Array.from({ length: 30 }, () => card());
    const done = Array.from({ length: 15 }, () => review('d1', 'new'));
    expect(deckCounts(deck(), cards, done, NOW).newCount).toBe(5);
  });

  it("ignores yesterday's work when counting today's allowance", () => {
    const cards = Array.from({ length: 30 }, () => card());
    const yesterday = Array.from({ length: 20 }, () => review('d1', 'new', TODAY_START - 3_600_000));
    expect(deckCounts(deck(), cards, yesterday, NOW).newCount).toBe(20);
  });

  it('counts due reviews but not future ones', () => {
    const cards = [card({ state: 'review', due: TODAY_START }), card({ state: 'review', due: TODAY_START + 86_400_000 })];
    expect(deckCounts(deck(), cards, [], NOW).review).toBe(1);
  });

  it('leaves suspended cards out of every queue', () => {
    const cards = [card({ suspended: true }), card({ state: 'review', due: TODAY_START, suspended: true })];
    const counts = deckCounts(deck(), cards, [], NOW);
    expect(counts.newCount + counts.review).toBe(0);
    expect(counts.suspended).toBe(2);
  });
});

describe('interleave', () => {
  it('spreads new cards evenly through reviews', () => {
    const out = interleave(['r', 'r', 'r', 'r', 'r', 'r'], ['N', 'N']);
    expect(out).toHaveLength(8);
    expect(out.indexOf('N')).toBeGreaterThan(0);
    expect(out.lastIndexOf('N')).toBeLessThan(7);
  });

  it('handles either list being empty', () => {
    expect(interleave([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(interleave(['a'], [])).toEqual(['a']);
  });
});

describe('pickNext', () => {
  it('shows a due learning card before anything else', () => {
    const learning = card({ state: 'learning', step: 1, due: NOW - 1000 });
    const fresh = card();
    const queue = buildQueue([deck()], [learning, fresh], [], NOW);
    expect(pickNext(queue, new Set(['d1']), [learning, fresh], NOW).cardId).toBe(learning.id);
  });

  it('shows a learning card early rather than leaving you waiting', () => {
    const soon = card({ state: 'learning', step: 1, due: NOW + 5 * 60_000 });
    expect(pickNext([], new Set(['d1']), [soon], NOW).cardId).toBe(soon.id);
  });

  it('says when to come back if the next learning card is later today', () => {
    const later = card({ state: 'learning', step: 1, due: NOW + 60 * 60_000 });
    const pick = pickNext([], new Set(['d1']), [later], NOW);
    expect(pick.cardId).toBeUndefined();
    expect(pick.waitUntil).toBe(later.due);
  });

  it('skips queue entries that were answered, suspended or deleted', () => {
    const answered = card({ state: 'review', due: NOW + 3 * 86_400_000 });
    const suspended = card({ suspended: true });
    const live = card();
    const pick = pickNext([answered.id, suspended.id, 'gone', live.id], new Set(['d1']), [answered, suspended, live], NOW);
    expect(pick.cardId).toBe(live.id);
  });

  it('only draws from the decks in the session', () => {
    const elsewhere = card({ deckId: 'd2' });
    expect(pickNext([elsewhere.id], new Set(['d1']), [elsewhere], NOW).cardId).toBeUndefined();
  });
});

describe('sessionCounts', () => {
  it('drops a card from the new count once it has been seen', () => {
    const a = card();
    const b = card();
    const queue = [a.id, b.id];
    const seen = { ...a, state: 'learning' as const, due: NOW + 60_000 };
    const counts = sessionCounts(queue, new Set(['d1']), [seen, b], NOW);
    expect(counts.newCount).toBe(1);
    expect(counts.learning).toBe(1);
  });
});
