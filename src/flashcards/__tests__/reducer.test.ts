import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../data/defaultState';
import { migrate } from '../../data/migrate';
import { mergeStates } from '../../data/sync/merge';
import type { AppState } from '../../domain/types';
import { reducer } from '../../state/store';
import { deckCounts } from '../queue';
import { flashcardReducer } from '../reducer';
import { GOOD, AGAIN } from '../scheduler';

const NOW = new Date(2026, 9, 26, 15, 0).getTime();

function withDeck(): AppState {
  return flashcardReducer(createInitialState(), { type: 'fc/deck/add', id: 'd1', name: 'QA Hacks' });
}

function withCard(): AppState {
  return flashcardReducer(withDeck(), { type: 'fc/card/add', id: 'c1', deckId: 'd1', front: 'Q', back: 'A', tags: ['qa'] });
}

describe('decks', () => {
  it('creates a deck with Anki default options', () => {
    const deck = withDeck().decks[0];
    expect(deck.name).toBe('QA Hacks');
    expect(deck.options.newPerDay).toBe(20);
    expect(deck.options.learnSteps).toEqual([1, 10]);
  });

  it('deletes a deck together with its cards, and tombstones both', () => {
    const next = flashcardReducer(withCard(), { type: 'fc/deck/delete', id: 'd1' });
    expect(next.decks).toHaveLength(0);
    expect(next.flashcards).toHaveLength(0);
    expect(next.deletedIds).toHaveProperty('d1');
    expect(next.deletedIds).toHaveProperty('c1');
  });

  it('merges option changes rather than replacing them', () => {
    const next = flashcardReducer(withDeck(), { type: 'fc/deck/update', id: 'd1', options: { newPerDay: 5 } });
    expect(next.decks[0].options.newPerDay).toBe(5);
    expect(next.decks[0].options.reviewsPerDay).toBe(200);
  });
});

describe('cards', () => {
  it('sanitises content on the way in', () => {
    const next = flashcardReducer(withDeck(), {
      type: 'fc/card/add',
      deckId: 'd1',
      front: '<b>Q</b><script>alert(1)</script>',
      back: '<img src=x onerror=alert(1)>A',
      tags: [],
    });
    expect(next.flashcards[0].front).toBe('<b>Q</b>');
    expect(next.flashcards[0].back).toBe('A');
  });

  it('appends new cards at the end of the new queue', () => {
    let s = withCard();
    s = flashcardReducer(s, { type: 'fc/card/add', id: 'c2', deckId: 'd1', front: 'Q2', back: 'A2', tags: [] });
    expect(s.flashcards.find((c) => c.id === 'c2')!.position).toBeGreaterThan(s.flashcards.find((c) => c.id === 'c1')!.position);
  });

  it('normalises tags', () => {
    const next = flashcardReducer(withDeck(), { type: 'fc/card/add', deckId: 'd1', front: 'Q', back: 'A', tags: [' qa ', 'qa', 'time and work', ''] });
    expect(next.flashcards[0].tags).toEqual(['qa', 'time_and_work']);
  });

  it('suspends, moves and forgets in bulk', () => {
    let s = flashcardReducer(withCard(), { type: 'fc/deck/add', id: 'd2', name: 'Other' });
    s = flashcardReducer(s, { type: 'fc/cards/suspend', ids: ['c1'], suspended: true });
    s = flashcardReducer(s, { type: 'fc/cards/move', ids: ['c1'], deckId: 'd2' });
    expect(s.flashcards[0].suspended).toBe(true);
    expect(s.flashcards[0].deckId).toBe('d2');
  });
});

describe('resetting a deck', () => {
  it('sends every card back to new, in its original order, keeping the history', () => {
    let s = withCard();
    s = flashcardReducer(s, { type: 'fc/card/add', id: 'c2', deckId: 'd1', front: 'Q2', back: 'A2', tags: [] });
    s = flashcardReducer(s, { type: 'fc/card/add', id: 'c3', deckId: 'd1', front: 'Q3', back: 'A3', tags: [] });
    s = flashcardReducer(s, { type: 'fc/answer', cardId: 'c2', rating: GOOD, now: NOW, timeMs: 1000, reviewId: 'r1' });
    s = flashcardReducer(s, { type: 'fc/answer', cardId: 'c2', rating: GOOD, now: NOW, timeMs: 1000, reviewId: 'r2' });
    // Array order deliberately differs from study order.
    s = { ...s, flashcards: [...s.flashcards].reverse() };

    const reset = flashcardReducer(s, { type: 'fc/cards/forget', ids: ['c3', 'c2', 'c1'] });
    expect(reset.flashcards.every((c) => c.state === 'new' && c.reps === 0 && c.interval === 0 && c.lapses === 0)).toBe(true);
    expect([...reset.flashcards].sort((a, b) => a.position - b.position).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(reset.cardReviews).toHaveLength(2);
  });

  it('gives a reset card its place back in the new-card allowance for today', () => {
    let s = withCard();
    s = flashcardReducer(s, { type: 'fc/deck/update', id: 'd1', options: { newPerDay: 1 } });
    s = flashcardReducer(s, { type: 'fc/answer', cardId: 'c1', rating: GOOD, now: NOW, timeMs: 1000, reviewId: 'r1' });
    expect(deckCounts(s.decks[0], s.flashcards, s.cardReviews, NOW).newCount).toBe(0);

    const reset = flashcardReducer(s, { type: 'fc/cards/forget', ids: ['c1'] });
    expect(deckCounts(reset.decks[0], reset.flashcards, reset.cardReviews, NOW).newCount).toBe(1);
  });
});

describe('answering', () => {
  it('schedules the card and records a review', () => {
    const next = flashcardReducer(withCard(), { type: 'fc/answer', cardId: 'c1', rating: GOOD, now: NOW, timeMs: 5000, reviewId: 'r1' });
    expect(next.flashcards[0].state).toBe('learning');
    expect(next.cardReviews).toHaveLength(1);
    expect(next.cardReviews[0]).toMatchObject({ cardId: 'c1', deckId: 'd1', rating: GOOD, stateBefore: 'new', interval: -10 });
  });

  it('caps the recorded answer time, as Anki does, so a walk-away does not skew stats', () => {
    const next = flashcardReducer(withCard(), { type: 'fc/answer', cardId: 'c1', rating: GOOD, now: NOW, timeMs: 10 * 60_000, reviewId: 'r1' });
    expect(next.cardReviews[0].timeMs).toBe(60_000);
  });

  it('undoes an answer exactly', () => {
    const before = withCard();
    const card = before.flashcards[0];
    const answered = flashcardReducer(before, { type: 'fc/answer', cardId: 'c1', rating: AGAIN, now: NOW, timeMs: 1000, reviewId: 'r1' });
    const undone = flashcardReducer(answered, { type: 'fc/undo', card, reviewId: 'r1' });
    expect(undone.flashcards[0]).toMatchObject({ state: 'new', reps: 0 });
    expect(undone.cardReviews).toHaveLength(0);
    expect(undone.deletedIds).toHaveProperty('r1');
  });

  it('is reachable through the main store reducer', () => {
    const next = reducer(withCard(), { type: 'fc/answer', cardId: 'c1', rating: GOOD, now: NOW, timeMs: 1000, reviewId: 'r1' });
    expect(next.cardReviews).toHaveLength(1);
  });
});

describe('import', () => {
  it('does not duplicate records it already has', () => {
    const s = withCard();
    const again = flashcardReducer(s, { type: 'fc/import', decks: s.decks, cards: s.flashcards, reviews: [] });
    expect(again.decks).toHaveLength(1);
    expect(again.flashcards).toHaveLength(1);
  });
});

describe('persistence and sync', () => {
  it('gives data from before flashcards empty collections', () => {
    const legacy = createInitialState() as Partial<AppState>;
    delete legacy.decks;
    delete legacy.flashcards;
    delete legacy.cardReviews;
    const migrated = migrate(legacy);
    expect(migrated.decks).toEqual([]);
    expect(migrated.flashcards).toEqual([]);
    expect(migrated.cardReviews).toEqual([]);
  });

  it('fills in deck options added later', () => {
    const s = withDeck();
    const stripped = { ...s, decks: s.decks.map((d) => ({ ...d, options: { newPerDay: 7 } as unknown as typeof d.options })) };
    const migrated = migrate(stripped);
    expect(migrated.decks[0].options.newPerDay).toBe(7);
    expect(migrated.decks[0].options.learnSteps).toEqual([1, 10]);
  });

  it('merges cards and reviews from two devices', () => {
    const base = withCard();
    const phone = flashcardReducer(base, { type: 'fc/answer', cardId: 'c1', rating: GOOD, now: NOW, timeMs: 1000, reviewId: 'r-phone' });
    const desktop = flashcardReducer(base, { type: 'fc/card/add', id: 'c2', deckId: 'd1', front: 'Q2', back: 'A2', tags: [] });
    const { state } = mergeStates(desktop, phone);
    expect(state.flashcards.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(state.cardReviews.map((r) => r.id)).toEqual(['r-phone']);
  });
});
