/**
 * Syncing flashcard images.
 *
 * Images do not travel in the data file. That file is read on every sync,
 * and carrying a deck of screenshots in it would mean downloading all of them
 * every time. Instead they live in separate gists, one file per image named by
 * its content hash, and the data file carries only an index of which image is
 * in which gist. Each sync then uploads only images not yet indexed, and
 * downloads only images this device is missing - one at a time, straight from
 * the gist's raw URL rather than through the API.
 *
 * Images are content-addressed, so an image is never stored twice, and a
 * download is checked against its own name: bytes that do not hash to the id
 * they were fetched as are thrown away rather than shown.
 */
import type { AppState } from '../../domain/types';
import { MEDIA_EVENT } from '../../flashcards/media';
import { mediaDb } from '../db';
import { request, type GistPayload, type MediaSyncMeta } from './gistClient';

/** Well under GitHub's per-gist file listing limit of 300. */
const FILES_PER_GIST = 250;
/** Keeps each upload request comfortably small. */
const BATCH_BYTES = 3_000_000;
const MEDIA_DESCRIPTION = 'CAT Monitor — flashcard images (do not edit by hand)';


/** Images the current cards actually use. Orphans are neither uploaded nor fetched. */
export function referencedMedia(state: Pick<AppState, 'flashcards'>): Set<string> {
  const ids = new Set<string>();
  for (const card of state.flashcards) {
    for (const m of `${card.front}${card.back}`.matchAll(/src="media:([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

const fileName = (id: string) => `${id}.b64`;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function contentId(bytes: Uint8Array, ext: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 32)}.${ext}`;
}

/**
 * Uploads images used by cards that the index does not know about yet.
 * Returns the updated index, or the same object when there was nothing to do.
 */
export async function pushMedia(token: string, state: AppState, current: MediaSyncMeta | undefined): Promise<{ meta: MediaSyncMeta; uploaded: number }> {
  const meta: MediaSyncMeta = current
    ? { owner: current.owner, gists: [...current.gists], index: { ...current.index } }
    : { gists: [], index: {} };

  const pending: { id: string; content: string }[] = [];
  for (const id of referencedMedia(state)) {
    if (meta.index[id]) continue;
    const record = await mediaDb.get(id).catch(() => undefined);
    if (!record) continue;
    pending.push({ id, content: toBase64(new Uint8Array(await record.blob.arrayBuffer())) });
  }
  if (pending.length === 0) return { meta: current ?? meta, uploaded: 0 };

  const countIn = (gistId: string) => Object.values(meta.index).filter((g) => g === gistId).length;
  let uploaded = 0;

  while (pending.length > 0) {
    const last = meta.gists[meta.gists.length - 1];
    const room = last ? FILES_PER_GIST - countIn(last) : 0;
    const startNew = room <= 0;
    const limit = startNew ? FILES_PER_GIST : room;

    const batch: typeof pending = [];
    let bytes = 0;
    while (pending.length > 0 && batch.length < limit && (batch.length === 0 || bytes + pending[0].content.length <= BATCH_BYTES)) {
      const next = pending.shift()!;
      bytes += next.content.length;
      batch.push(next);
    }
    const files = Object.fromEntries(batch.map((b) => [fileName(b.id), { content: b.content }]));

    let target = last;
    if (startNew) {
      const created = await request<GistPayload>(token, '/gists', {
        method: 'POST',
        body: JSON.stringify({ description: MEDIA_DESCRIPTION, public: false, files }),
      });
      target = created.id;
      meta.gists.push(target);
      meta.owner = created.owner?.login ?? meta.owner;
    } else {
      await request<GistPayload>(token, `/gists/${target}`, { method: 'PATCH', body: JSON.stringify({ files }) });
    }
    for (const b of batch) meta.index[b.id] = target;
    uploaded += batch.length;
  }

  if (!meta.owner) {
    const me = await request<{ login: string }>(token, '/user');
    meta.owner = me.login;
  }
  return { meta, uploaded };
}

/**
 * Fetches images the cards use but this device does not have. Each arrival
 * is announced so cards already on screen can show it without a reload.
 */
export async function pullMedia(state: AppState, meta: MediaSyncMeta | undefined): Promise<number> {
  if (!meta?.owner) return 0;
  const missing: string[] = [];
  // The index arrives from the synced file, so only well-formed values are
  // ever put into a URL.
  if (!/^[A-Za-z0-9-]{1,39}$/.test(meta.owner)) return 0;
  for (const id of referencedMedia(state)) {
    const gist = meta.index[id];
    if (!gist || !/^[0-9a-f]{20,40}$/i.test(gist) || !/^[0-9a-f]{32}\.[a-z0-9]{2,5}$/.test(id)) continue;
    if (!(await mediaDb.get(id).catch(() => undefined))) missing.push(id);
  }

  let fetched = 0;
  const worker = async () => {
    while (missing.length > 0) {
      const id = missing.shift()!;
      try {
        const url = `https://gist.githubusercontent.com/${encodeURIComponent(meta.owner!)}/${meta.index[id]}/raw/${encodeURIComponent(fileName(id))}`;
        const response = await fetch(url);
        if (!response.ok) continue;
        const bytes = fromBase64(await response.text());
        const ext = id.split('.').pop() ?? 'bin';
        if ((await contentId(bytes, ext)) !== id) continue;
        const type = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
        await mediaDb.put({ id, blob: new Blob([bytes as BlobPart], { type }), type, size: bytes.length, name: id, createdAt: new Date().toISOString() });
        fetched += 1;
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MEDIA_EVENT, { detail: id }));
      } catch {
        // One unreachable image must not stop the rest; it is retried next sync.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return fetched;
}

/** Deleting a space deletes its images too. */
export async function deleteMediaGists(token: string, meta: MediaSyncMeta | undefined): Promise<void> {
  for (const gistId of meta?.gists ?? []) {
    await request(token, `/gists/${gistId}`, { method: 'DELETE' }).catch(() => undefined);
  }
}
