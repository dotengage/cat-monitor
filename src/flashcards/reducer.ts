/**
 * Flashcard state changes. Pure, like the main reducer it plugs into.
 *
 * Every deletion leaves a tombstone so sync does not bring the card back
 * from another device, and every answer is recorded as a review so the
 * statistics can be rebuilt from history rather than from counters.
 */
import { nowISO, uid } from '../domain/ids';
import type { AppState, CardReview, Deck, DeckOptions, Flashcard, ID, Rating } from '../domain/types';
import { sanitize } from './html';
import { answer, DEFAULT_DECK_OPTIONS } from './scheduler';

export type FlashcardAction =
  | { type: 'fc/deck/add'; id?: ID; name: string; description?: string; options?: Partial<DeckOptions> }
  | { type: 'fc/deck/update'; id: ID; name?: string; description?: string; options?: Partial<DeckOptions> }
  | { type: 'fc/deck/delete'; id: ID }
  | { type: 'fc/card/add'; id?: ID; deckId: ID; front: string; back: string; tags: string[] }
  | { type: 'fc/card/update'; id: ID; front?: string; back?: string; tags?: string[]; deckId?: ID }
  | { type: 'fc/cards/delete'; ids: ID[] }
  | { type: 'fc/cards/move'; ids: ID[]; deckId: ID }
  | { type: 'fc/cards/suspend'; ids: ID[]; suspended: boolean }
  | { type: 'fc/cards/forget'; ids: ID[] }
  | { type: 'fc/answer'; cardId: ID; rating: Rating; now: number; timeMs: number; reviewId: ID }
  | { type: 'fc/undo'; card: Flashcard; reviewId: ID }
  | { type: 'fc/import'; decks: Deck[]; cards: Flashcard[]; reviews: CardReview[] };

export function isFlashcardAction(action: { type: string }): action is FlashcardAction {
  return action.type.startsWith('fc/');
}

function tombstones(state: AppState, ids: ID[]): Record<string, string> {
  const at = nowISO();
  const next = { ...state.deletedIds };
  for (const id of ids) next[id] = at;
  return next;
}

function nextPosition(cards: Flashcard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.position), 0) + 1;
}

export function newCard(fields: { id?: ID; deckId: ID; front: string; back: string; tags: string[] }, position: number): Flashcard {
  const stamp = nowISO();
  return {
    id: fields.id ?? uid('card'),
    createdAt: stamp,
    updatedAt: stamp,
    deckId: fields.deckId,
    front: sanitize(fields.front),
    back: sanitize(fields.back),
    tags: normaliseTags(fields.tags),
    state: 'new',
    suspended: false,
    step: 0,
    interval: 0,
    ease: DEFAULT_DECK_OPTIONS.startingEase,
    due: 0,
    position,
    reps: 0,
    lapses: 0,
    leech: false,
  };
}

export function normaliseTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean))];
}

function patchCards(state: AppState, ids: ID[], patch: (card: Flashcard) => Flashcard): Flashcard[] {
  const set = new Set(ids);
  const stamp = nowISO();
  return state.flashcards.map((c) => (set.has(c.id) ? { ...patch(c), updatedAt: stamp } : c));
}

export function flashcardReducer(state: AppState, action: FlashcardAction): AppState {
  switch (action.type) {
    case 'fc/deck/add': {
      const stamp = nowISO();
      const deck: Deck = {
        id: action.id ?? uid('deck'),
        createdAt: stamp,
        updatedAt: stamp,
        name: action.name.trim() || 'Untitled deck',
        description: action.description ?? '',
        options: { ...DEFAULT_DECK_OPTIONS, ...(action.options ?? {}) },
      };
      return { ...state, decks: [...state.decks, deck] };
    }

    case 'fc/deck/update':
      return {
        ...state,
        decks: state.decks.map((d) =>
          d.id === action.id
            ? {
                ...d,
                name: action.name !== undefined ? action.name.trim() || d.name : d.name,
                description: action.description ?? d.description,
                options: { ...d.options, ...(action.options ?? {}) },
                updatedAt: nowISO(),
              }
            : d,
        ),
      };

    case 'fc/deck/delete': {
      // As in Anki, deleting a deck deletes its cards. Their review history
      // stays, so statistics about the past remain true.
      const cardIds = state.flashcards.filter((c) => c.deckId === action.id).map((c) => c.id);
      return {
        ...state,
        decks: state.decks.filter((d) => d.id !== action.id),
        flashcards: state.flashcards.filter((c) => c.deckId !== action.id),
        deletedIds: tombstones(state, [action.id, ...cardIds]),
      };
    }

    case 'fc/card/add':
      return { ...state, flashcards: [...state.flashcards, newCard(action, nextPosition(state.flashcards))] };

    case 'fc/card/update':
      return {
        ...state,
        flashcards: patchCards(state, [action.id], (c) => ({
          ...c,
          front: action.front !== undefined ? sanitize(action.front) : c.front,
          back: action.back !== undefined ? sanitize(action.back) : c.back,
          tags: action.tags !== undefined ? normaliseTags(action.tags) : c.tags,
          deckId: action.deckId ?? c.deckId,
        })),
      };

    case 'fc/cards/delete': {
      const set = new Set(action.ids);
      return {
        ...state,
        flashcards: state.flashcards.filter((c) => !set.has(c.id)),
        deletedIds: tombstones(state, action.ids),
      };
    }

    case 'fc/cards/move':
      return { ...state, flashcards: patchCards(state, action.ids, (c) => ({ ...c, deckId: action.deckId })) };

    case 'fc/cards/suspend':
      return { ...state, flashcards: patchCards(state, action.ids, (c) => ({ ...c, suspended: action.suspended })) };

    case 'fc/cards/forget': {
      // Back to new, at the end of the new queue, with its history kept.
      let position = nextPosition(state.flashcards);
      return {
        ...state,
        flashcards: patchCards(state, action.ids, (c) => ({
          ...c,
          state: 'new',
          step: 0,
          interval: 0,
          ease: DEFAULT_DECK_OPTIONS.startingEase,
          due: 0,
          position: position++,
          lapses: 0,
          leech: false,
          tags: c.tags.filter((t) => t !== 'leech'),
        })),
      };
    }

    case 'fc/answer': {
      const card = state.flashcards.find((c) => c.id === action.cardId);
      if (!card) return state;
      const deck = state.decks.find((d) => d.id === card.deckId);
      const options = deck?.options ?? DEFAULT_DECK_OPTIONS;
      const result = answer(card, action.rating, options, action.now);
      const stamp = nowISO();
      const review: CardReview = {
        id: action.reviewId,
        createdAt: stamp,
        updatedAt: stamp,
        cardId: card.id,
        deckId: card.deckId,
        rating: action.rating,
        stateBefore: card.state,
        interval: result.interval,
        lastInterval: result.lastInterval,
        ease: result.card.ease,
        timeMs: Math.min(action.timeMs, 60_000),
        at: action.now,
      };
      return {
        ...state,
        flashcards: state.flashcards.map((c) => (c.id === card.id ? { ...result.card, updatedAt: stamp } : c)),
        cardReviews: [...state.cardReviews, review],
      };
    }

    case 'fc/undo':
      return {
        ...state,
        flashcards: state.flashcards.map((c) => (c.id === action.card.id ? { ...action.card, updatedAt: nowISO() } : c)),
        cardReviews: state.cardReviews.filter((r) => r.id !== action.reviewId),
        deletedIds: tombstones(state, [action.reviewId]),
      };

    case 'fc/import': {
      const deckIds = new Set(state.decks.map((d) => d.id));
      const cardIds = new Set(state.flashcards.map((c) => c.id));
      const reviewIds = new Set(state.cardReviews.map((r) => r.id));
      let position = nextPosition(state.flashcards);
      return {
        ...state,
        decks: [...state.decks, ...action.decks.filter((d) => !deckIds.has(d.id))],
        flashcards: [
          ...state.flashcards,
          ...action.cards
            .filter((c) => !cardIds.has(c.id))
            .map((c) => ({ ...c, front: sanitize(c.front), back: sanitize(c.back), position: c.state === 'new' ? position++ : c.position })),
        ],
        cardReviews: [...state.cardReviews, ...action.reviews.filter((r) => !reviewIds.has(r.id))],
      };
    }

    default:
      return state;
  }
}
