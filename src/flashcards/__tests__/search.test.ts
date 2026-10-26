import { describe, expect, it } from 'vitest';
import type { Deck, Flashcard } from '../../domain/types';
import { DEFAULT_DECK_OPTIONS } from '../scheduler';
import { parseSearch, searchCards } from '../search';

const NOW = Date.UTC(2026, 9, 26, 12);
const decks: Deck[] = [
  { id: 'd1', createdAt: '', updatedAt: '', name: 'QA Hacks', description: '', options: DEFAULT_DECK_OPTIONS },
  { id: 'd2', createdAt: '', updatedAt: '', name: 'VARC words', description: '', options: DEFAULT_DECK_OPTIONS },
];

let n = 0;
const card = (over: Partial<Flashcard>): Flashcard => ({
  id: `c${(n += 1)}`,
  createdAt: '',
  updatedAt: '',
  deckId: 'd1',
  front: '',
  back: '',
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
});

const cards = [
  card({ front: 'Ages: <b>Dick</b> is thrice as old as Tom', tags: ['ages'] }),
  card({ front: 'Sum of a<sub>1</sub> to a<sub>50</sub>', state: 'review', due: NOW - 1000, tags: ['series'] }),
  card({ deckId: 'd2', front: 'Ephemeral', back: 'Short-lived', suspended: true }),
];

describe('searchCards', () => {
  it('matches plain words against front and back, ignoring markup', () => {
    expect(searchCards(cards, decks, 'dick tom', NOW)).toHaveLength(1);
    expect(searchCards(cards, decks, 'short-lived', NOW)).toHaveLength(1);
  });

  it('filters by deck, tag and state', () => {
    expect(searchCards(cards, decks, 'deck:varc', NOW)).toHaveLength(1);
    expect(searchCards(cards, decks, 'tag:series', NOW)).toHaveLength(1);
    expect(searchCards(cards, decks, 'is:due', NOW)).toHaveLength(1);
    expect(searchCards(cards, decks, 'is:suspended', NOW)).toHaveLength(1);
  });

  it('negates with a leading minus', () => {
    expect(searchCards(cards, decks, '-deck:varc', NOW)).toHaveLength(2);
  });

  it('returns everything for an empty search', () => {
    expect(searchCards(cards, decks, '  ', NOW)).toHaveLength(3);
  });

  it('keeps quoted phrases together', () => {
    expect(parseSearch('deck:"QA Hacks" ages')).toEqual([
      { negate: false, kind: 'deck', value: 'qa hacks' },
      { negate: false, kind: 'text', value: 'ages' },
    ]);
  });
});
