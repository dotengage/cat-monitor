/**
 * The browser's search, a small subset of Anki's syntax.
 *
 * Plain words must all appear in the card's text. `deck:name`, `tag:name`
 * and `is:new|learn|review|due|suspended|leech` narrow further, and a leading
 * `-` negates any term. Matching is case-insensitive.
 */
import type { Deck, Flashcard } from '../domain/types';
import { toPlainText } from './html';

interface Term {
  negate: boolean;
  kind: 'text' | 'deck' | 'tag' | 'is';
  value: string;
}

export function parseSearch(query: string): Term[] {
  const tokens = query.match(/-?(?:[a-z]+:)?(?:"[^"]*"|\S+)/gi) ?? [];
  return tokens.map((raw) => {
    const negate = raw.startsWith('-') && raw.length > 1;
    const body = negate ? raw.slice(1) : raw;
    const m = /^(deck|tag|is):(.*)$/i.exec(body);
    const value = (m ? m[2] : body).replace(/^"|"$/g, '').toLowerCase();
    return { negate, kind: (m ? m[1].toLowerCase() : 'text') as Term['kind'], value };
  });
}

function matches(term: Term, card: Flashcard, text: string, deckName: string, now: number): boolean {
  switch (term.kind) {
    case 'text':
      return text.includes(term.value);
    case 'deck':
      return deckName.toLowerCase().includes(term.value);
    case 'tag':
      return card.tags.some((t) => t.toLowerCase() === term.value || t.toLowerCase().startsWith(`${term.value}::`));
    case 'is':
      if (term.value === 'new') return card.state === 'new';
      if (term.value === 'learn') return card.state === 'learning' || card.state === 'relearning';
      if (term.value === 'review') return card.state === 'review';
      if (term.value === 'due') return !card.suspended && card.state !== 'new' && card.due <= now;
      if (term.value === 'suspended') return card.suspended;
      if (term.value === 'leech') return card.leech;
      return false;
  }
}

export function searchCards(cards: Flashcard[], decks: Deck[], query: string, now: number): Flashcard[] {
  const terms = parseSearch(query.trim());
  if (terms.length === 0) return cards;
  const deckNames = new Map(decks.map((d) => [d.id, d.name]));
  return cards.filter((card) => {
    const text = `${toPlainText(card.front)} ${toPlainText(card.back)}`.toLowerCase();
    const deckName = deckNames.get(card.deckId) ?? '';
    return terms.every((t) => matches(t, card, text, deckName, now) !== t.negate);
  });
}
