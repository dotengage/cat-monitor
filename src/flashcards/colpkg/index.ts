/**
 * Anki package import and export, wired to the browser.
 *
 * SQLite (compiled to WebAssembly) and the zstd decoder are loaded only when
 * a package is actually imported or exported, so they cost nothing on a
 * normal page load. The work itself lives in `anki.ts`, which takes these as
 * dependencies so it can be tested outside a browser.
 */
import type { SqlJsStatic } from 'sql.js';
import { mediaDb } from '../../data/db';
import type { AppState } from '../../domain/types';
import { storeMedia, typeFor } from '../media';
import { buildPackage, parsePackage, type ParsedPackage } from './anki';

export type { ImportSummary } from './anki';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]).then(([sqlModule, wasm]) =>
      sqlModule.default({ locateFile: () => wasm.default }),
    );
    sqlPromise.catch(() => {
      sqlPromise = null;
    });
  }
  return sqlPromise;
}

export async function importPackage(file: File, state: AppState): Promise<ParsedPackage> {
  if (file.size > 500 * 1024 * 1024) throw new Error('That package is over 500 MB, which is more than a browser can safely open.');
  const [SQL, { decompress }] = await Promise.all([loadSql(), import('fzstd')]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parsePackage(bytes, {
    SQL,
    zstd: (data) => decompress(data),
    storeMedia: (data, name) => storeMedia(new Blob([data as BlobPart], { type: typeFor(name) }), name),
    existing: state,
    now: Date.now(),
  });
}

export async function downloadCollection(state: AppState): Promise<void> {
  const SQL = await loadSql();
  const blob = await buildPackage(state, {
    SQL,
    now: Date.now(),
    getMedia: async (id) => {
      const record = await mediaDb.get(id);
      return record ? { data: new Uint8Array(await record.blob.arrayBuffer()), name: record.name } : null;
    },
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cat-monitor-flashcards-${new Date().toISOString().slice(0, 10)}.colpkg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
