/**
 * Image sync tests, with GitHub and IndexedDB replaced by in-memory fakes.
 *
 * What matters: only images the cards use move, each moves once, a device
 * fetches only what it is missing, and bytes that do not match the name they
 * were fetched under never reach the screen.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaRecord } from '../../db';

const store = new Map<string, MediaRecord>();
vi.mock('../../db', () => ({
  mediaDb: {
    get: async (id: string) => store.get(id),
    put: async (r: MediaRecord) => void store.set(r.id, r),
    keys: async () => [...store.keys()],
    delete: async (id: string) => void store.delete(id),
  },
}));

const { pullMedia, pushMedia, referencedMedia } = await import('../mediaSync');
const { createInitialState } = await import('../../defaultState');
const { flashcardReducer } = await import('../../../flashcards/reducer');

/** A content-addressed id, exactly as the app makes them. */
const idFor = (bytes: Uint8Array, ext = 'png') => `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`;

function image(seed: number) {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2]);
  const id = idFor(bytes);
  return { bytes, id };
}

function remember(img: { bytes: Uint8Array; id: string }) {
  store.set(img.id, { id: img.id, blob: new Blob([img.bytes as BlobPart], { type: 'image/png' }), type: 'image/png', size: img.bytes.length, name: img.id, createdAt: '' });
}

function stateWith(...ids: string[]) {
  let s = flashcardReducer(createInitialState(), { type: 'fc/deck/add', id: 'd', name: 'Deck' });
  ids.forEach((id, i) => {
    s = flashcardReducer(s, { type: 'fc/card/add', id: `c${i}`, deckId: 'd', front: `Q <img src="media:${id}">`, back: 'A', tags: [] });
  });
  return s;
}

interface Call {
  method: string;
  url: string;
  body?: { files?: Record<string, { content: string }> };
}

let calls: Call[];
let rawFiles: Map<string, string>;
let nextGist: number;

beforeEach(() => {
  store.clear();
  calls = [];
  rawFiles = new Map();
  nextGist = 1;
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.startsWith('https://gist.githubusercontent.com/')) {
      const name = decodeURIComponent(url.split('/').pop() ?? '');
      const content = rawFiles.get(name);
      return new Response(content ?? 'not found', { status: content ? 200 : 404 });
    }
    if (url.endsWith('/gists') && method === 'POST') {
      const id = `${String(nextGist++).padStart(20, 'a')}`;
      for (const [name, f] of Object.entries(body.files)) rawFiles.set(name, (f as { content: string }).content);
      return new Response(JSON.stringify({ id, owner: { login: 'aviral' }, files: {} }), { status: 201 });
    }
    if (method === 'PATCH') {
      for (const [name, f] of Object.entries(body.files)) rawFiles.set(name, (f as { content: string }).content);
      return new Response(JSON.stringify({ id: url.split('/').pop(), files: {} }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('referencedMedia', () => {
  it('finds the images cards use', () => {
    const a = image(1);
    expect([...referencedMedia(stateWith(a.id))]).toEqual([a.id]);
  });
});

describe('pushMedia', () => {
  it('uploads used images into a new private gist and indexes them', async () => {
    const a = image(1);
    const b = image(2);
    remember(a);
    remember(b);
    const { meta, uploaded } = await pushMedia('t', stateWith(a.id, b.id), undefined);
    expect(uploaded).toBe(2);
    expect(meta.gists).toHaveLength(1);
    expect(meta.owner).toBe('aviral');
    expect(meta.index[a.id]).toBe(meta.gists[0]);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(JSON.stringify(post.body)).public).toBe(false);
  });

  it('does not upload an image twice', async () => {
    const a = image(1);
    remember(a);
    const first = await pushMedia('t', stateWith(a.id), undefined);
    calls = [];
    const second = await pushMedia('t', stateWith(a.id), first.meta);
    expect(second.uploaded).toBe(0);
    expect(calls).toHaveLength(0);
    expect(second.meta).toBe(first.meta);
  });

  it('adds new images to the existing gist rather than making another', async () => {
    const a = image(1);
    const b = image(2);
    remember(a);
    remember(b);
    const first = await pushMedia('t', stateWith(a.id), undefined);
    const second = await pushMedia('t', stateWith(a.id, b.id), first.meta);
    expect(second.meta.gists).toEqual(first.meta.gists);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('ignores images no card uses', async () => {
    const used = image(1);
    const orphan = image(9);
    remember(used);
    remember(orphan);
    const { meta } = await pushMedia('t', stateWith(used.id), undefined);
    expect(Object.keys(meta.index)).toEqual([used.id]);
  });
});

describe('pullMedia', () => {
  it('downloads images this device is missing, and only those', async () => {
    const a = image(1);
    const b = image(2);
    remember(a);
    remember(b);
    const { meta } = await pushMedia('t', stateWith(a.id, b.id), undefined);
    store.delete(b.id); // a second device that has a but not b
    calls = [];
    const fetched = await pullMedia(stateWith(a.id, b.id), meta);
    expect(fetched).toBe(1);
    expect(calls).toHaveLength(1);
    expect(new Uint8Array(await store.get(b.id)!.blob.arrayBuffer())).toEqual(b.bytes);
  });

  it('throws away bytes that do not match the id they were fetched as', async () => {
    const a = image(1);
    remember(a);
    const { meta } = await pushMedia('t', stateWith(a.id), undefined);
    store.delete(a.id);
    rawFiles.set(`${a.id}.b64`, Buffer.from([1, 2, 3]).toString('base64'));
    expect(await pullMedia(stateWith(a.id), meta)).toBe(0);
    expect(store.has(a.id)).toBe(false);
  });

  it('never builds a URL from a malformed index entry', async () => {
    const a = image(1);
    const meta = { owner: 'aviral', gists: ['../../evil'], index: { [a.id]: '../../evil' } };
    expect(await pullMedia(stateWith(a.id), meta)).toBe(0);
    expect(calls).toHaveLength(0);
    expect(await pullMedia(stateWith(a.id), { ...meta, owner: 'x/../y', index: { [a.id]: 'a'.repeat(20) } })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('keeps going when one image cannot be fetched', async () => {
    const a = image(1);
    const b = image(2);
    remember(a);
    remember(b);
    const { meta } = await pushMedia('t', stateWith(a.id, b.id), undefined);
    store.clear();
    rawFiles.delete(`${a.id}.b64`);
    expect(await pullMedia(stateWith(a.id, b.id), meta)).toBe(1);
    expect(store.has(b.id)).toBe(true);
  });
});
