/**
 * Flashcard images.
 *
 * Every image is stored once, under a name derived from its contents, so the
 * same screenshot pasted onto three cards - or imported twice - takes the
 * space of one. Cards refer to images as `media:<id>`; this module turns
 * those references into something an <img> can show.
 */
import { mediaDb, type MediaRecord } from '../data/db';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

export function extensionFor(type: string, fallbackName = ''): string {
  return EXTENSIONS[type] ?? (fallbackName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Guesses a type from a filename, for imported media that arrives without one. */
export function typeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return Object.entries(EXTENSIONS).find(([, e]) => e === ext || (ext === 'jpeg' && e === 'jpg'))?.[0] ?? 'application/octet-stream';
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores an image and returns its id. Storing the same bytes again is a no-op
 * that returns the same id.
 */
export async function storeMedia(blob: Blob, name?: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const type = blob.type || typeFor(name ?? '');
  const id = `${(await sha256(buffer)).slice(0, 32)}.${extensionFor(type, name)}`;
  if (await mediaDb.get(id)) return id;
  const record: MediaRecord = {
    id,
    blob: new Blob([buffer], { type }),
    type,
    size: buffer.byteLength,
    name: name || `paste-${id}`,
    createdAt: new Date().toISOString(),
  };
  await mediaDb.put(record);
  return id;
}

/* ------------------------------------------------------------------ */
/* Showing images                                                      */
/* ------------------------------------------------------------------ */

/** Announced when a synced image arrives, so cards on screen can show it. */
export const MEDIA_EVENT = 'cat-monitor:media-arrived';

const urls = new Map<string, Promise<string | null>>();

/**
 * An object URL for a stored image, created once and reused for the session.
 * Null when the image is not on this device - for example a card synced from
 * another device whose images have not arrived yet.
 */
export function mediaUrl(id: string): Promise<string | null> {
  let pending = urls.get(id);
  if (!pending) {
    pending = mediaDb
      .get(id)
      .then((record) => (record ? URL.createObjectURL(record.blob) : null))
      .catch(() => null);
    urls.set(id, pending);
  }
  return pending;
}

/** Forget a cached miss, so an image that has since arrived is looked up again. */
export function refreshMedia(id: string): void {
  urls.delete(id);
}

/** Swaps every `media:<id>` in sanitised card HTML for a displayable URL. */
export async function resolveMedia(html: string): Promise<string> {
  const ids = [...html.matchAll(/src="media:([^"]+)"/g)].map((m) => m[1]);
  if (ids.length === 0) return html;
  const resolved = new Map<string, string | null>();
  await Promise.all(ids.map(async (id) => resolved.set(id, await mediaUrl(id))));
  return html.replace(/<img src="media:([^"]+)"([^>]*)>/g, (_, id: string, rest: string) => {
    const url = resolved.get(id);
    return url
      ? `<img src="${url}" data-media="${id}"${rest}>`
      : `<span class="missing-media" data-media="${id}">image not on this device yet</span>`;
  });
}
