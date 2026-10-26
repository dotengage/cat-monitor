/**
 * Package tests, against files made by Anki itself.
 *
 * The fixtures were produced by Anki's own library (26.09): a deck with
 * custom options, a nested deck, Basic, reversed and cloze notes, an image,
 * formatting, a suspended card and real review history - exported once in
 * the modern format (zstd, schema 18) and once in the legacy one (schema 11).
 * The exporter's output is in turn re-read here, and was also checked by
 * importing it into Anki's library outside these tests.
 */
import { readFileSync } from 'node:fs';
import { decompress } from 'fzstd';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createInitialState } from '../../../data/defaultState';
import type { AppState } from '../../../domain/types';
import { flashcardReducer } from '../../reducer';
import { buildPackage, parsePackage, type ParsedPackage } from '../anki';

const dir = `${__dirname}/fixtures`;
const summary = JSON.parse(readFileSync(`${dir}/summary.json`, 'utf8')) as { cards: number; revlog: number; suspended: number; media: string };
const NOW = Date.UTC(2026, 9, 26, 12);

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

function deps(state: AppState, stored: Map<string, Uint8Array>) {
  return {
    SQL,
    zstd: (d: Uint8Array) => decompress(d),
    storeMedia: async (data: Uint8Array, name: string) => {
      const id = `m-${stored.size}.${name.split('.').pop()}`;
      stored.set(id, data);
      return id;
    },
    existing: state,
    now: NOW,
  };
}

async function load(file: string, state = createInitialState()): Promise<{ parsed: ParsedPackage; media: Map<string, Uint8Array> }> {
  const media = new Map<string, Uint8Array>();
  const parsed = await parsePackage(new Uint8Array(readFileSync(`${dir}/${file}`)), deps(state, media));
  return { parsed, media };
}

const byFront = (p: ParsedPackage, text: string) => p.cards.find((c) => c.front.includes(text));

describe.each(['modern.colpkg', 'legacy.colpkg'])('importing %s', (file) => {
  it('brings in every card and every review', async () => {
    const { parsed } = await load(file);
    expect(parsed.cards).toHaveLength(summary.cards);
    expect(parsed.reviews).toHaveLength(summary.revlog);
    expect(parsed.cards.filter((c) => c.suspended)).toHaveLength(summary.suspended);
  });

  it('keeps deck names, including nesting, and skips decks with no cards', async () => {
    const { parsed } = await load(file);
    expect(parsed.decks.map((d) => d.name).sort()).toEqual(['Parent::Child', 'QA Hacks']);
  });

  it("carries each deck's own options", async () => {
    const { parsed } = await load(file);
    const qa = parsed.decks.find((d) => d.name === 'QA Hacks')!;
    expect(qa.options.newPerDay).toBe(15);
    expect(qa.options.learnSteps).toEqual([2, 15]);
    expect(qa.options.reviewsPerDay).toBe(150);
    const child = parsed.decks.find((d) => d.name === 'Parent::Child')!;
    expect(child.options.newPerDay).toBe(20);
  });

  it('renders Basic, reversed and cloze cards', async () => {
    const { parsed } = await load(file);
    expect(byFront(parsed, 'Dick is thrice')!.back).toBe('Harry is 18');
    expect(parsed.cards.some((c) => c.front === 'Short-lived' && c.back === 'Ephemeral')).toBe(true);
    const clozes = parsed.cards.filter((c) => c.front.includes('capital of'));
    expect(clozes).toHaveLength(2);
    expect(clozes.map((c) => c.front).sort()).toEqual([
      'The capital of <b>[...]</b> is Paris',
      'The capital of France is <b>[...]</b>',
    ]);
  });

  it('keeps formatting and turns images into media references', async () => {
    const { parsed, media } = await load(file);
    expect(byFront(parsed, 'Find the sum')!.front).toMatch(/<img src="media:m-0\.png">/);
    expect(byFront(parsed, 'Find the sum')!.back).toBe('<b>217</b>');
    expect(media.size).toBe(1);
    // A real PNG, decompressed where the format compresses it.
    expect([...[...media.values()][0].slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(byFront(parsed, '<ul>')!.front).toBe('<ul><li>one</li><li>two</li></ul>a &lt; b');
  });

  it('maps scheduling into the right state, interval and date', async () => {
    const { parsed } = await load(file);
    const review = parsed.cards.find((c) => c.state === 'review')!;
    expect(review.interval).toBe(5);
    expect(review.ease).toBe(2.5);
    expect(new Date(review.due).getHours()).toBe(4);
    const learning = parsed.cards.find((c) => c.state === 'learning' && !c.suspended)!;
    expect(learning.step).toBe(1);
    expect(learning.due).toBeGreaterThan(Date.UTC(2026, 0, 1));
  });

  it('converts review history to this app’s units', async () => {
    const { parsed } = await load(file);
    // Anki logs a 15-minute step as -900 seconds.
    expect(parsed.reviews.some((r) => r.interval === -15)).toBe(true);
    expect(parsed.reviews.filter((r) => r.stateBefore === 'new')).toHaveLength(3);
  });

  it('does not duplicate anything when the same package is imported twice', async () => {
    const first = await load(file);
    let state = createInitialState();
    state = flashcardReducer(state, { type: 'fc/import', decks: first.parsed.decks, cards: first.parsed.cards, reviews: first.parsed.reviews });
    const second = await load(file, state);
    expect(second.parsed.cards).toHaveLength(0);
    expect(second.parsed.reviews).toHaveLength(0);
    expect(second.parsed.decks).toHaveLength(0);
    expect(second.parsed.summary.skipped).toBe(summary.cards);
  });
});

describe('exporting', () => {
  async function roundTrip() {
    const { parsed, media } = await load('modern.colpkg');
    let state = createInitialState();
    state = flashcardReducer(state, { type: 'fc/import', decks: parsed.decks, cards: parsed.cards, reviews: parsed.reviews });
    state = flashcardReducer(state, { type: 'fc/deck/add', id: 'own-deck', name: 'Made here' });
    state = flashcardReducer(state, { type: 'fc/card/add', id: 'own-card', deckId: 'own-deck', front: 'Mine <b>bold</b>', back: 'Answer', tags: ['x'] });

    const blob = await buildPackage(state, {
      SQL,
      now: NOW,
      getMedia: async (id) => (media.has(id) ? { data: media.get(id)!, name: 'paste-test-image.png' } : null),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const reread = await parsePackage(bytes, deps(createInitialState(), new Map()));
    return { state, bytes, reread };
  }

  it('produces a package this importer reads back completely', async () => {
    const { state, reread } = await roundTrip();
    expect(reread.cards).toHaveLength(state.flashcards.length);
    expect(reread.reviews).toHaveLength(state.cardReviews.length);
    expect(reread.decks.map((d) => d.name).sort()).toEqual(['Made here', 'Parent::Child', 'QA Hacks']);
  });

  it('keeps card ids, so exporting and importing again does not duplicate', async () => {
    const { state, reread } = await roundTrip();
    expect(reread.cards.map((c) => c.id).sort()).toEqual(state.flashcards.map((c) => c.id).sort());
  });

  it('keeps content, images and scheduling', async () => {
    const { state, reread } = await roundTrip();
    const mine = reread.cards.find((c) => c.id === 'own-card')!;
    expect(mine.front).toBe('Mine <b>bold</b>');
    expect(mine.tags).toEqual(['x']);
    expect(reread.cards.find((c) => c.front.includes('Find the sum'))!.front).toMatch(/media:/);
    const before = state.flashcards.find((c) => c.state === 'review')!;
    const after = reread.cards.find((c) => c.id === before.id)!;
    expect(after).toMatchObject({ state: 'review', interval: before.interval, ease: before.ease, due: before.due });
  });

  it('keeps deck options', async () => {
    const { reread } = await roundTrip();
    expect(reread.decks.find((d) => d.name === 'QA Hacks')!.options.learnSteps).toEqual([2, 15]);
  });
});
