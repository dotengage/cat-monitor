/**
 * Reading and writing Anki collections.
 *
 * Reading handles both database layouts Anki has used: schema 11, where note
 * types, decks and deck options live as JSON inside the `col` table, and
 * schema 18 (Anki 2.1.50+), where they have their own tables and protobuf
 * blobs. Writing produces schema 11 - the "support older Anki versions"
 * format - because every Anki release since 2.1 imports it, and producing
 * the newer zstd-compressed layout would need a zstd compressor for no gain.
 *
 * Both directions were checked against packages made and read by Anki's own
 * library, not just against this module's idea of the format.
 */
import type { Database, SqlJsStatic } from 'sql.js';
import type { AppState, CardReview, CardState, Deck, DeckOptions, Flashcard, Rating } from '../../domain/types';
import { escapeText, sanitize, toPlainText } from '../html';
import { dayStart, DEFAULT_DECK_OPTIONS, studyDay } from '../scheduler';
import { decode, floats, msg, num, repeated, str } from './protobuf';
import { answerOnly, clozeNumbers, cleanRendered, FRONT_SIDE_MARKER, renderTemplate } from './template';
import { listEntries, readEntry, writeZip, type ZipEntry } from './zip';

export interface ImportSummary {
  decks: number;
  cards: number;
  reviews: number;
  media: number;
  skipped: number;
  notes: string[];
}

export interface ParsedPackage {
  decks: Deck[];
  cards: Flashcard[];
  reviews: CardReview[];
  summary: ImportSummary;
}

export interface ImportDeps {
  SQL: SqlJsStatic;
  zstd: (data: Uint8Array) => Uint8Array;
  /** Stores an image and returns its media id. */
  storeMedia: (data: Uint8Array, name: string) => Promise<string>;
  existing: Pick<AppState, 'decks' | 'flashcards' | 'cardReviews'>;
  now: number;
}

interface Model {
  cloze: boolean;
  fields: string[];
  templates: { ord: number; qfmt: string; afmt: string }[];
}

interface DeckInfo {
  name: string;
  filtered: boolean;
  options: DeckOptions;
}

type Row = Record<string, unknown>;

function rows(db: Database, sql: string): Row[] {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) => Object.fromEntries(result.columns.map((c, i) => [c, values[i]])));
}

function hasTable(db: Database, name: string): boolean {
  return rows(db, `select name from sqlite_master where type = 'table' and name = '${name}'`).length > 0;
}

const n = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? fallback) || fallback);

/* ------------------------------------------------------------------ */
/* Locating the database inside the package                            */
/* ------------------------------------------------------------------ */

async function collectionBytes(buffer: Uint8Array, entries: Map<string, ZipEntry>, zstd: ImportDeps['zstd']): Promise<{ db: Uint8Array; modern: boolean }> {
  const meta = entries.get('meta');
  // meta: { version: 1 = collection.anki2, 2 = collection.anki21, 3 = collection.anki21b }
  const version = meta ? num(decode(await readEntry(buffer, meta)), 1) ?? 1 : 0;

  if (version >= 3 && entries.has('collection.anki21b')) {
    return { db: zstd(await readEntry(buffer, entries.get('collection.anki21b')!)), modern: true };
  }
  for (const name of version === 1 ? ['collection.anki2'] : ['collection.anki21', 'collection.anki2']) {
    const entry = entries.get(name);
    if (entry) return { db: await readEntry(buffer, entry), modern: false };
  }
  throw new Error('This file is not an Anki package: there is no collection inside it.');
}

/** Media list: zip entry name to original filename. */
async function mediaIndex(buffer: Uint8Array, entries: Map<string, ZipEntry>, modern: boolean, zstd: ImportDeps['zstd']): Promise<Map<string, string>> {
  const entry = entries.get('media');
  const out = new Map<string, string>();
  if (!entry) return out;
  const raw = await readEntry(buffer, entry);
  if (modern) {
    // MediaEntries { repeated MediaEntry entries = 1 }, MediaEntry { name = 1; size = 2; sha1 = 3; legacy_zip_filename = 255 }
    repeated(decode(zstd(raw)), 1).forEach((e, i) => {
      const name = str(e, 1);
      if (name) out.set(String(num(e, 255) ?? i), name);
    });
  } else {
    const json = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
    for (const [zipName, name] of Object.entries(json)) out.set(zipName, name);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Note types and decks                                                */
/* ------------------------------------------------------------------ */

function modelsSchema11(db: Database): Map<number, Model> {
  const json = JSON.parse(String(rows(db, 'select models from col')[0]?.models ?? '{}')) as Record<string, { type: number; flds: { name: string; ord: number }[]; tmpls: { ord: number; qfmt: string; afmt: string }[] }>;
  const out = new Map<number, Model>();
  for (const [id, m] of Object.entries(json)) {
    out.set(Number(id), {
      cloze: m.type === 1,
      fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: m.tmpls.map((t) => ({ ord: t.ord, qfmt: t.qfmt, afmt: t.afmt })),
    });
  }
  return out;
}

function modelsSchema18(db: Database): Map<number, Model> {
  const out = new Map<number, Model>();
  for (const nt of rows(db, 'select id, config from notetypes')) {
    const config = decode(nt.config as Uint8Array);
    out.set(n(nt.id), { cloze: num(config, 1) === 1, fields: [], templates: [] });
  }
  for (const f of rows(db, 'select ntid, ord, name from fields order by ntid, ord')) {
    out.get(n(f.ntid))?.fields.push(String(f.name));
  }
  for (const t of rows(db, 'select ntid, ord, config from templates order by ntid, ord')) {
    const config = decode(t.config as Uint8Array);
    out.get(n(t.ntid))?.templates.push({ ord: n(t.ord), qfmt: str(config, 1) ?? '', afmt: str(config, 2) ?? '' });
  }
  for (const m of out.values()) if (m.templates.some((t) => t.qfmt.includes('{{cloze:'))) m.cloze = true;
  return out;
}

function sane(value: number | undefined, fallback: number, min: number, max: number): number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function decksSchema11(db: Database): Map<number, DeckInfo> {
  const col = rows(db, 'select decks, dconf from col')[0] ?? {};
  const decks = JSON.parse(String(col.decks ?? '{}')) as Record<string, { name: string; dyn?: number; conf?: number }>;
  const dconf = JSON.parse(String(col.dconf ?? '{}')) as Record<string, { new?: { perDay?: number; delays?: number[]; ints?: number[]; initialFactor?: number }; rev?: { perDay?: number; ease4?: number; ivlFct?: number; maxIvl?: number; hardFactor?: number }; lapse?: { delays?: number[]; mult?: number; minInt?: number; leechFails?: number } }>;
  const out = new Map<number, DeckInfo>();
  for (const [id, d] of Object.entries(decks)) {
    const c = dconf[String(d.conf ?? 1)];
    const D = DEFAULT_DECK_OPTIONS;
    out.set(Number(id), {
      name: d.name,
      filtered: d.dyn === 1,
      options: c
        ? {
            newPerDay: sane(c.new?.perDay, D.newPerDay, 0, 9999),
            reviewsPerDay: sane(c.rev?.perDay, D.reviewsPerDay, 0, 99999),
            learnSteps: c.new?.delays?.length ? c.new.delays : D.learnSteps,
            relearnSteps: c.lapse?.delays ?? D.relearnSteps,
            graduatingInterval: sane(c.new?.ints?.[0], D.graduatingInterval, 1, 365),
            easyInterval: sane(c.new?.ints?.[1], D.easyInterval, 1, 3650),
            startingEase: sane((c.new?.initialFactor ?? 0) / 1000, D.startingEase, 1.3, 5),
            easyBonus: sane(c.rev?.ease4, D.easyBonus, 1, 5),
            hardInterval: sane(c.rev?.hardFactor, D.hardInterval, 0.5, 2),
            intervalModifier: sane(c.rev?.ivlFct, D.intervalModifier, 0.1, 5),
            newInterval: sane(c.lapse?.mult, D.newInterval, 0, 1),
            minimumInterval: sane(c.lapse?.minInt, D.minimumInterval, 1, 365),
            maximumInterval: sane(c.rev?.maxIvl, D.maximumInterval, 1, 36500),
            leechThreshold: sane(c.lapse?.leechFails, D.leechThreshold, 0, 99),
          }
        : { ...D },
    });
  }
  return out;
}

function decksSchema18(db: Database): Map<number, DeckInfo> {
  const configs = new Map<number, DeckOptions>();
  const D = DEFAULT_DECK_OPTIONS;
  for (const row of rows(db, 'select id, config from deck_config')) {
    // Field numbers confirmed against configs written by Anki itself.
    const c = decode(row.config as Uint8Array);
    const learn = floats(c, 1);
    configs.set(n(row.id), {
      learnSteps: learn.length ? learn : D.learnSteps,
      relearnSteps: floats(c, 2),
      newPerDay: sane(num(c, 9), 0, 0, 9999),
      reviewsPerDay: sane(num(c, 10), 0, 0, 99999),
      startingEase: sane(num(c, 11), D.startingEase, 1.3, 5),
      easyBonus: sane(num(c, 12), D.easyBonus, 1, 5),
      hardInterval: sane(num(c, 13), D.hardInterval, 0.5, 2),
      newInterval: sane(num(c, 14), 0, 0, 1),
      intervalModifier: sane(num(c, 15), D.intervalModifier, 0.1, 5),
      maximumInterval: sane(num(c, 16), D.maximumInterval, 1, 36500),
      minimumInterval: sane(num(c, 17), D.minimumInterval, 1, 365),
      graduatingInterval: sane(num(c, 18), D.graduatingInterval, 1, 365),
      easyInterval: sane(num(c, 19), D.easyInterval, 1, 3650),
      leechThreshold: sane(num(c, 22), D.leechThreshold, 0, 99),
    });
  }
  const out = new Map<number, DeckInfo>();
  for (const row of rows(db, 'select id, name, kind from decks')) {
    // kind: oneof { Normal normal = 1 { config_id = 1 }; Filtered filtered = 2 }
    const kind = decode(row.kind as Uint8Array);
    const normal = msg(kind, 1);
    out.set(n(row.id), {
      name: String(row.name).split('\u001f').join('::'),
      filtered: !normal,
      options: { ...(configs.get(normal ? num(normal, 1) ?? 1 : 1) ?? D) },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function decodeName(raw: string): string {
  const unescaped = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

function referencedMedia(html: string): string[] {
  return [...html.matchAll(/<img[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map((m) => decodeName(m[1] ?? m[2] ?? m[3] ?? ''));
}

function rewriteMedia(html: string, ids: Map<string, string>): string {
  return html.replace(/(<img[^>]*?\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (whole, lead: string, a?: string, b?: string, c?: string) => {
    const id = ids.get(decodeName(a ?? b ?? c ?? ''));
    return id ? `${lead}"media:${id}"` : whole;
  });
}

function stateOf(type: number): CardState {
  return type === 1 ? 'learning' : type === 2 ? 'review' : type === 3 ? 'relearning' : 'new';
}

export async function parsePackage(bytes: Uint8Array, deps: ImportDeps): Promise<ParsedPackage> {
  const entries = listEntries(bytes);
  const { db: dbBytes, modern } = await collectionBytes(bytes, entries, deps.zstd);
  const db = new deps.SQL.Database(dbBytes);
  const notes: string[] = [];

  try {
    const schema18 = hasTable(db, 'notetypes');
    const models = schema18 ? modelsSchema18(db) : modelsSchema11(db);
    const deckInfo = schema18 ? decksSchema18(db) : decksSchema11(db);
    const crtDay = studyDay(n(rows(db, 'select crt from col')[0]?.crt) * 1000);

    const noteRows = new Map<number, { mid: number; flds: string[]; tags: string[] }>();
    for (const r of rows(db, 'select id, mid, flds, tags from notes')) {
      noteRows.set(n(r.id), {
        mid: n(r.mid),
        flds: String(r.flds).split('\u001f'),
        tags: String(r.tags).split(/\s+/).filter(Boolean),
      });
    }

    const cardRows = rows(db, 'select id, nid, did, odid, ord, type, queue, due, odue, ivl, factor, reps, lapses, left from cards');
    if (cardRows.length === 1 && String(noteRows.values().next().value?.flds[0] ?? '').includes('Please update to the latest Anki version')) {
      throw new Error('This package only opens in a newer Anki. Export it again from Anki with "Support older Anki versions" ticked, or update the file.');
    }

    /* ---- Media actually used by the cards being imported ---- */
    const wanted = new Set<string>();
    for (const note of noteRows.values()) for (const f of note.flds) for (const name of referencedMedia(f)) wanted.add(name);
    const index = await mediaIndex(bytes, entries, modern, deps.zstd);
    const mediaIds = new Map<string, string>();
    let missingMedia = 0;
    for (const [zipName, name] of index) {
      if (!wanted.has(name)) continue;
      const entry = entries.get(zipName);
      if (!entry) {
        missingMedia += 1;
        continue;
      }
      const raw = await readEntry(bytes, entry);
      mediaIds.set(name, await deps.storeMedia(modern ? deps.zstd(raw) : raw, name));
    }
    missingMedia += [...wanted].filter((w) => !index.has(w) && ![...index.values()].includes(w)).length;
    if (missingMedia > 0) notes.push(`${missingMedia} image${missingMedia === 1 ? ' was' : 's were'} referenced by cards but missing from the package.`);

    /* ---- Decks: reuse one of the same name, so re-importing does not duplicate ---- */
    const existingByName = new Map(deps.existing.decks.map((d) => [d.name.toLowerCase(), d.id]));
    const usedDeckIds = new Set(cardRows.map((c) => (n(c.odid) ? n(c.odid) : n(c.did))));
    const deckIdMap = new Map<number, string>();
    const decks: Deck[] = [];
    const stamp = new Date(deps.now).toISOString();
    for (const id of usedDeckIds) {
      const info = deckInfo.get(id) ?? { name: `Imported deck ${id}`, filtered: false, options: { ...DEFAULT_DECK_OPTIONS } };
      const existing = existingByName.get(info.name.toLowerCase());
      if (existing) {
        deckIdMap.set(id, existing);
        continue;
      }
      const deckId = `anki-deck-${id}`;
      deckIdMap.set(id, deckId);
      decks.push({ id: deckId, createdAt: stamp, updatedAt: stamp, name: info.name, description: '', options: info.options });
      existingByName.set(info.name.toLowerCase(), deckId);
    }

    /* ---- Cards ---- */
    const existingCards = new Set(deps.existing.flashcards.map((c) => c.id));
    const cards: Flashcard[] = [];
    const cardIdMap = new Map<number, string>();
    let skipped = 0;
    let unrenderable = 0;
    let mathjax = 0;
    const noteGuids = new Map<number, string>(rows(db, 'select id, guid from notes').map((r) => [n(r.id), String(r.guid)]));

    for (const r of cardRows) {
      const ankiId = n(r.id);
      const note = noteRows.get(n(r.nid));
      const model = note ? models.get(note.mid) : undefined;
      if (!note || !model) {
        unrenderable += 1;
        continue;
      }
      // A card this app exported earlier keeps the id it had here.
      const guid = noteGuids.get(n(r.nid)) ?? '';
      const id = guid.startsWith('cm:') ? guid.slice(3) : `anki-${ankiId}`;
      cardIdMap.set(ankiId, id);
      if (existingCards.has(id)) {
        skipped += 1;
        continue;
      }

      const fields = Object.fromEntries(model.fields.map((name, i) => [name, note.flds[i] ?? '']));
      const ord = n(r.ord);
      const template = model.cloze ? model.templates[0] : model.templates.find((t) => t.ord === ord) ?? model.templates[0];
      if (!template) {
        unrenderable += 1;
        continue;
      }
      if (model.cloze && !clozeNumbers(note.flds.join(' ')).includes(ord + 1)) {
        unrenderable += 1;
        continue;
      }
      const question = cleanRendered(renderTemplate(template.qfmt, fields, ord, 'question'));
      const answer = cleanRendered(answerOnly(renderTemplate(template.afmt, fields, ord, 'answer', FRONT_SIDE_MARKER)));
      if (/\\\(|\\\[/.test(question + answer)) mathjax += 1;

      const fromFiltered = n(r.odid) !== 0;
      const did = fromFiltered ? n(r.odid) : n(r.did);
      const type = n(r.type);
      const queue = n(r.queue);
      const rawDue = fromFiltered && n(r.odue) ? n(r.odue) : n(r.due);
      const state = stateOf(type);
      const options = deckInfo.get(did)?.options ?? DEFAULT_DECK_OPTIONS;
      const steps = state === 'relearning' ? options.relearnSteps : options.learnSteps;

      let due = 0;
      if (state === 'review' || (queue === 3 && state !== 'new')) due = dayStart(crtDay + rawDue);
      else if (state === 'learning' || state === 'relearning') due = rawDue * 1000;

      cards.push({
        id,
        createdAt: new Date(Math.min(ankiId, deps.now)).toISOString(),
        updatedAt: stamp,
        deckId: deckIdMap.get(did) ?? decks[0]?.id ?? 'anki-deck-1',
        front: sanitize(rewriteMedia(question, mediaIds)),
        back: sanitize(rewriteMedia(answer, mediaIds)),
        tags: note.tags,
        state,
        suspended: queue === -1,
        step: state === 'learning' || state === 'relearning' ? Math.max(0, steps.length - (n(r.left) % 1000)) : 0,
        interval: Math.max(0, n(r.ivl)),
        ease: n(r.factor) > 0 ? n(r.factor) / 1000 : DEFAULT_DECK_OPTIONS.startingEase,
        due,
        position: state === 'new' ? rawDue : 0,
        reps: n(r.reps),
        lapses: n(r.lapses),
        leech: note.tags.some((t) => t.toLowerCase() === 'leech'),
      });
    }

    /* ---- Review history ---- */
    const knownReviews = new Set(deps.existing.cardReviews.map((x) => `${x.cardId}@${x.at}`));
    const reviews: CardReview[] = [];
    const firstSeen = new Set<number>();
    for (const r of rows(db, 'select id, cid, ease, ivl, lastIvl, factor, time, type from revlog order by id')) {
      const cid = n(r.cid);
      const cardId = cardIdMap.get(cid);
      const rating = n(r.ease);
      const kind = n(r.type);
      // Ease 0 rows are manual reschedules, not answers.
      if (!cardId || rating < 1 || rating > 4 || kind > 3) continue;
      const at = n(r.id);
      const stateBefore: CardState = kind === 1 || kind === 3 ? 'review' : kind === 2 ? 'relearning' : firstSeen.has(cid) ? 'learning' : 'new';
      firstSeen.add(cid);
      if (knownReviews.has(`${cardId}@${at}`)) continue;
      const ivl = n(r.ivl);
      const last = n(r.lastIvl);
      const card = cards.find((c) => c.id === cardId);
      reviews.push({
        id: `anki-rev-${at}-${cid}`,
        createdAt: new Date(at).toISOString(),
        updatedAt: stamp,
        cardId,
        deckId: card?.deckId ?? deps.existing.flashcards.find((c) => c.id === cardId)?.deckId ?? '',
        rating: rating as Rating,
        stateBefore,
        // Anki stores learning steps as negative seconds; this app as negative minutes.
        interval: ivl < 0 ? -Math.max(1, Math.round(-ivl / 60)) : ivl,
        lastInterval: last < 0 ? -Math.max(1, Math.round(-last / 60)) : last,
        ease: n(r.factor) > 0 ? n(r.factor) / 1000 : 0,
        timeMs: Math.min(60_000, n(r.time)),
        at,
      });
    }

    if (unrenderable > 0) notes.push(`${unrenderable} card${unrenderable === 1 ? '' : 's'} could not be rendered and were left out.`);
    if (mathjax > 0) notes.push(`${mathjax} card${mathjax === 1 ? ' uses' : 's use'} MathJax, which shows here as its source text.`);
    if (cards.some((c) => /image-occlusion/i.test(c.front))) notes.push('Image occlusion cards need Anki to draw their masks and will not display correctly.');

    return {
      decks,
      cards,
      reviews,
      summary: { decks: new Set(cards.map((c) => c.deckId)).size, cards: cards.length, reviews: reviews.length, media: mediaIds.size, skipped, notes },
    };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA_11 = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const MODEL_ID = 1700000000001;

/**
 * An Anki id for one of this app's records.
 *
 * Anki ids are creation times in milliseconds, and its database check treats
 * one in the future as damage. So an imported record keeps its original id,
 * and anything made here gets its own creation time - never later than now -
 * nudged forward only to stay unique. Identity across an export and a
 * re-import travels in the note GUID instead, so these need not be stable.
 */
function ankiId(id: string, createdAt: string, now: number, used: Set<number>): number {
  const imported = /^anki-(?:deck-)?(\d+)$/.exec(id);
  let value = imported ? Number(imported[1]) : Math.min(Date.parse(createdAt) || now, now - 1000);
  while (used.has(value)) value += 1;
  used.add(value);
  return value;
}

async function sha1Checksum(text: string): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  return ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
}

function ankiInterval(value: number): number {
  return value < 0 ? value * 60 : value;
}

export interface ExportDeps {
  SQL: SqlJsStatic;
  getMedia: (id: string) => Promise<{ data: Uint8Array; name: string } | null>;
  now: number;
}

export async function buildPackage(state: Pick<AppState, 'decks' | 'flashcards' | 'cardReviews'>, deps: ExportDeps): Promise<Blob> {
  const db = new deps.SQL.Database();
  try {
    db.exec(SCHEMA_11);
    const nowSec = Math.floor(deps.now / 1000);

    // Day 0 is far enough back that every review date is a positive day number.
    const earliest = Math.min(
      deps.now,
      ...state.flashcards.filter((c) => c.state === 'review').map((c) => c.due),
      ...state.cardReviews.map((r) => r.at),
    );
    const crtDay = studyDay(earliest) - 1;
    const crt = Math.floor(dayStart(crtDay) / 1000);

    /* ---- Decks and their options ---- */
    const usedIds = new Set<number>([1]);
    const deckNumbers = new Map<string, number>();
    const decksJson: Record<string, unknown> = {
      1: deckJson(1, 'Default', 1, nowSec),
    };
    const dconfJson: Record<string, unknown> = { 1: dconf(1, 'Default', DEFAULT_DECK_OPTIONS, nowSec) };
    for (const deck of state.decks) {
      const id = ankiId(deck.id, deck.createdAt, deps.now, usedIds);
      deckNumbers.set(deck.id, id);
      decksJson[id] = deckJson(id, deck.name, id, nowSec, deck.description);
      dconfJson[id] = dconf(id, `${deck.name} options`, deck.options, nowSec);
    }
    // Anki expects every level of a nested name to exist as a deck.
    const names = new Set(state.decks.map((d) => d.name));
    for (const deck of state.decks) {
      const parts = deck.name.split('::');
      for (let i = 1; i < parts.length; i += 1) {
        const parent = parts.slice(0, i).join('::');
        if (names.has(parent)) continue;
        names.add(parent);
        const id = ankiId(`parent:${parent}`, deck.createdAt, deps.now, usedIds);
        decksJson[id] = deckJson(id, parent, 1, nowSec);
      }
    }

    /* ---- Media ---- */
    const mediaFiles: { name: string; data: Uint8Array }[] = [];
    const mediaNames = new Map<string, string>();
    const takenNames = new Set<string>();
    const ids = new Set(state.flashcards.flatMap((c) => [...`${c.front}${c.back}`.matchAll(/src="media:([^"]+)"/g)].map((m) => m[1])));
    for (const id of ids) {
      const record = await deps.getMedia(id);
      if (!record) continue;
      let name = record.name.replace(/[\\/:*?"<>|]/g, '_') || id;
      if (takenNames.has(name)) name = id;
      takenNames.add(name);
      mediaNames.set(id, name);
      mediaFiles.push({ name, data: record.data });
    }
    const toAnkiHtml = (html: string) =>
      html.replace(/src="media:([^"]+)"/g, (whole, id: string) => (mediaNames.has(id) ? `src="${escapeText(mediaNames.get(id)!)}"` : whole));

    /* ---- Notes and cards, one note per card ---- */
    const cardNumbers = new Map<string, number>();
    const insertNote = db.prepare('insert into notes values (?,?,?,?,?,?,?,?,?,?,?)');
    const insertCard = db.prepare('insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    let nextPos = 1;
    const lastReview = new Map<string, number>();
    for (const r of state.cardReviews) lastReview.set(r.cardId, Math.max(lastReview.get(r.cardId) ?? 0, r.at));
    for (const card of state.flashcards) {
      const id = ankiId(card.id, card.createdAt, deps.now, usedIds);
      cardNumbers.set(card.id, id);
      const did = deckNumbers.get(card.deckId) ?? 1;
      const options = state.decks.find((d) => d.id === card.deckId)?.options ?? DEFAULT_DECK_OPTIONS;
      const front = toAnkiHtml(card.front);
      const sortField = toPlainText(card.front);
      insertNote.run([id, `cm:${card.id}`, MODEL_ID, nowSec, -1, card.tags.length ? ` ${card.tags.join(' ')} ` : '', `${front}\u001f${toAnkiHtml(card.back)}`, sortField, await sha1Checksum(sortField), 0, '']);

      let type = 0;
      let queue = 0;
      let due = card.position;
      let factor = 0;
      let left = 0;
      if (card.state === 'review') {
        type = 2;
        queue = 2;
        due = Math.max(0, studyDay(card.due) - crtDay);
        factor = Math.round(card.ease * 1000);
      } else if (card.state === 'learning' || card.state === 'relearning') {
        type = card.state === 'learning' ? 1 : 3;
        queue = 1;
        due = Math.floor(card.due / 1000);
        factor = card.state === 'relearning' ? Math.round(card.ease * 1000) : 0;
        const steps = card.state === 'learning' ? options.learnSteps : options.relearnSteps;
        left = Math.max(1, steps.length - card.step);
      }
      if (card.state === 'new') nextPos = Math.max(nextPos, card.position + 1);
      // Modern Anki keeps the last review time in the card's data.
      const lrt = lastReview.get(card.id);
      const data = lrt ? JSON.stringify({ lrt: Math.floor(lrt / 1000) }) : '';
      insertCard.run([id, id, did, 0, nowSec, -1, type, card.suspended ? -1 : queue, due, card.state === 'new' ? 0 : card.interval, factor, card.reps, card.lapses, left, 0, 0, 0, data]);
    }
    insertNote.free();
    insertCard.free();

    /* ---- Review history ---- */
    const insertReview = db.prepare('insert into revlog values (?,?,?,?,?,?,?,?,?)');
    const usedReviewIds = new Set<number>();
    for (const r of [...state.cardReviews].sort((a, b) => a.at - b.at)) {
      const cid = cardNumbers.get(r.cardId);
      if (!cid) continue;
      let id = Math.round(r.at);
      while (usedReviewIds.has(id)) id += 1;
      usedReviewIds.add(id);
      const learning = r.stateBefore === 'new' || r.stateBefore === 'learning';
      const kind = learning ? 0 : r.stateBefore === 'review' ? 1 : 2;
      insertReview.run([id, cid, -1, r.rating, ankiInterval(r.interval), ankiInterval(r.lastInterval), learning ? 0 : Math.round(r.ease * 1000), Math.round(r.timeMs), kind]);
    }
    insertReview.free();

    /* ---- Collection row ---- */
    const firstDeck = state.decks[0] ? deckNumbers.get(state.decks[0].id) ?? 1 : 1;
    const conf = {
      activeDecks: [firstDeck],
      curDeck: firstDeck,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      curModel: MODEL_ID,
      nextPos,
      sortType: 'noteFld',
      sortBackwards: false,
      addToCur: true,
      schedVer: 2,
      sched2021: true,
      rollover: 4,
    };
    db.run('insert into col values (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      1,
      crt,
      deps.now,
      deps.now,
      11,
      0,
      0,
      0,
      JSON.stringify(conf),
      JSON.stringify({ [MODEL_ID]: basicModel(firstDeck, nowSec) }),
      JSON.stringify(decksJson),
      JSON.stringify(dconfJson),
      '{}',
    ]);

    const files = [
      // meta { version: LEGACY_2 } - "collection.anki21, schema 11".
      { name: 'meta', data: new Uint8Array([8, 2]) },
      { name: 'collection.anki21', data: db.export() },
      { name: 'media', data: new TextEncoder().encode(JSON.stringify(Object.fromEntries(mediaFiles.map((m, i) => [String(i), m.name])))) },
      ...mediaFiles.map((m, i) => ({ name: String(i), data: m.data, store: true })),
    ];
    return writeZip(files);
  } finally {
    db.close();
  }
}

function deckJson(id: number, name: string, conf: number, mod: number, desc = '') {
  return {
    id,
    name,
    mod,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc,
    dyn: 0,
    conf,
    extendNew: 0,
    extendRev: 0,
  };
}

function dconf(id: number, name: string, o: DeckOptions, mod: number) {
  return {
    id,
    name,
    mod,
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: { delays: o.learnSteps, ints: [o.graduatingInterval, o.easyInterval, 0], initialFactor: Math.round(o.startingEase * 1000), order: 1, perDay: o.newPerDay, bury: false },
    rev: { perDay: o.reviewsPerDay, ease4: o.easyBonus, ivlFct: o.intervalModifier, maxIvl: o.maximumInterval, bury: false, hardFactor: o.hardInterval },
    lapse: { delays: o.relearnSteps, mult: o.newInterval, minInt: o.minimumInterval, leechFails: o.leechThreshold, leechAction: 1 },
  };
}

function basicModel(did: number, mod: number) {
  const field = (name: string, ord: number) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] });
  return {
    id: MODEL_ID,
    name: 'Basic (CAT Monitor)',
    type: 0,
    mod,
    usn: -1,
    sortf: 0,
    did,
    tmpls: [
      {
        name: 'Card 1',
        ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}',
        bqfmt: '',
        bafmt: '',
        did: null,
        bfont: '',
        bsize: 0,
      },
    ],
    flds: [field('Front', 0), field('Back', 1)],
    css: '.card {\n  font-family: arial;\n  font-size: 20px;\n  text-align: center;\n  color: black;\n  background-color: white;\n}\n',
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: [],
  };
}
