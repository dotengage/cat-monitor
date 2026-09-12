/**
 * GitHub Gist storage.
 *
 * The whole sync backend is one secret gist in the user's own GitHub account.
 * No server, no database, no third-party service beyond the one they already
 * use to host the app. The token needs only the `gist` scope and is stored on
 * the device, never inside the synced payload.
 */
import type { AppState } from '../../domain/types';
import { migrate } from '../migrate';

const API = 'https://api.github.com';
const DATA_FILENAME = 'cat-monitor-data.json';
const GIST_DESCRIPTION = 'CAT Monitor — synced data (do not edit by hand)';

export class GistError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GistError';
    this.status = status;
  }
}

export interface SyncDevice {
  name: string;
  lastSeen: string;
}

/** What actually gets written to the gist. */
export interface SyncEnvelope {
  app: 'cat-monitor';
  envelopeVersion: 1;
  /**
   * Identifies one independent dataset. A single GitHub account can hold
   * several - one per person, or one per purpose - and they never mix.
   */
  spaceId?: string;
  spaceName?: string;
  updatedAt: string;
  devices: Record<string, SyncDevice>;
  state: AppState;
}

/** Enough about a space to decide whether it is yours before joining it. */
export interface SpaceSummary {
  gistId: string;
  spaceName: string;
  updatedAt: string;
  deviceNames: string[];
  tasks: number;
  mocks: number;
  errors: number;
  targetPercentile?: number;
  examDate?: string;
  unreadable?: boolean;
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GistError('Could not reach GitHub. Check your internet connection.');
  }

  if (response.status === 401) {
    throw new GistError('GitHub rejected the token. It may have been revoked or mistyped.', 401);
  }
  if (response.status === 403) {
    throw new GistError('GitHub refused the request. The token probably lacks Gist permission.', 403);
  }
  if (response.status === 404) {
    throw new GistError('The sync gist could not be found. It may have been deleted on GitHub.', 404);
  }
  if (!response.ok) {
    throw new GistError(`GitHub returned an unexpected error (${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

interface GistFile {
  filename: string;
  truncated?: boolean;
  content?: string;
  raw_url?: string;
}

interface GistPayload {
  id: string;
  description: string;
  updated_at: string;
  files: Record<string, GistFile>;
}

/** Verifies the token by doing the least privileged thing that needs `gist`. */
export async function verifyToken(token: string): Promise<void> {
  await request<GistPayload[]>(token, '/gists?per_page=1');
}

/**
 * Every CAT Monitor dataset in this account.
 *
 * Deliberately returns all of them rather than the first match: one GitHub
 * account can legitimately hold more than one dataset, and silently joining
 * whichever happened to be created first is how two people's data ends up
 * merged together.
 */
export async function listDataGists(token: string): Promise<string[]> {
  const gists = await request<GistPayload[]>(token, '/gists?per_page=100');
  return gists.filter((g) => Object.keys(g.files ?? {}).includes(DATA_FILENAME)).map((g) => g.id);
}

/** Summarises each space so the user can tell their own data from someone else's. */
export async function describeSpaces(token: string, limit = 10): Promise<SpaceSummary[]> {
  const ids = (await listDataGists(token)).slice(0, limit);
  const out: SpaceSummary[] = [];
  for (const gistId of ids) {
    try {
      const envelope = await readDataGist(token, gistId);
      if (!envelope) continue;
      out.push({
        gistId,
        spaceName: envelope.spaceName ?? 'Unnamed space',
        updatedAt: envelope.updatedAt,
        deviceNames: Object.values(envelope.devices ?? {}).map((d) => d.name),
        tasks: envelope.state?.tasks?.length ?? 0,
        mocks: envelope.state?.mocks?.length ?? 0,
        errors: envelope.state?.errors?.length ?? 0,
        targetPercentile: envelope.state?.profile?.targetPercentile,
        examDate: envelope.state?.profile?.examDate,
      });
    } catch {
      out.push({
        gistId,
        spaceName: 'Unreadable space',
        updatedAt: '',
        deviceNames: [],
        tasks: 0,
        mocks: 0,
        errors: 0,
        unreadable: true,
      });
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function createDataGist(token: string, envelope: SyncEnvelope): Promise<string> {
  const created = await request<GistPayload>(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [DATA_FILENAME]: { content: serialise(envelope) } },
    }),
  });
  return created.id;
}

export async function readDataGist(token: string, gistId: string): Promise<SyncEnvelope | null> {
  const gist = await request<GistPayload>(token, `/gists/${gistId}`);
  const file = gist.files?.[DATA_FILENAME];
  if (!file) return null;

  let content = file.content ?? '';
  // GitHub inlines only the first megabyte; larger files must be fetched raw.
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url);
    if (!raw.ok) throw new GistError('Could not download the full sync file from GitHub.');
    content = await raw.text();
  }
  if (!content.trim()) return null;

  try {
    const parsed = JSON.parse(content) as SyncEnvelope;
    if (parsed?.app !== 'cat-monitor' || !parsed.state) {
      throw new GistError('The sync file does not look like CAT Monitor data.');
    }
    /*
     * Normalise before anything downstream touches it.
     *
     * The gist may have been written by an older build, or by a device that
     * has not updated yet, so it can be missing fields this version depends
     * on. Merging adopts whole records wherever the remote copy is newer, so
     * an un-normalised payload puts a half-shaped record straight into live
     * state. Loading and importing already migrate at their boundary; this is
     * the third way data enters the app and it needs the same treatment.
     */
    return { ...parsed, state: migrate(parsed.state) };
  } catch (err) {
    if (err instanceof GistError) throw err;
    throw new GistError('The sync file is corrupted and could not be read.');
  }
}

export async function writeDataGist(token: string, gistId: string, envelope: SyncEnvelope): Promise<void> {
  await request<GistPayload>(token, `/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      files: { [DATA_FILENAME]: { content: serialise(envelope) } },
    }),
  });
}

/**
 * Renames a space without touching its data.
 *
 * Read-then-write on purpose: the gist holds the whole dataset in one file, so
 * writing a name-only payload would erase everything in it.
 */
export async function renameDataGist(token: string, gistId: string, spaceName: string): Promise<void> {
  const envelope = await readDataGist(token, gistId);
  if (!envelope) {
    throw new GistError('That space could not be read, so it was not renamed. Nothing was changed.');
  }
  await writeDataGist(token, gistId, { ...envelope, spaceName, updatedAt: new Date().toISOString() });
}

/**
 * Removes a device from a space's device list.
 *
 * This is bookkeeping, not revocation: anything still holding the token can
 * re-add itself on its next sync. Cutting off access means revoking the token
 * on GitHub, which is surfaced alongside this in the UI.
 */
export async function forgetDeviceInGist(token: string, gistId: string, deviceId: string): Promise<void> {
  const envelope = await readDataGist(token, gistId);
  if (!envelope) throw new GistError('That space could not be read, so nothing was changed.');
  const devices = { ...(envelope.devices ?? {}) };
  delete devices[deviceId];
  await writeDataGist(token, gistId, { ...envelope, devices, updatedAt: new Date().toISOString() });
}

/** Permanently deletes a space from GitHub. There is no undo on GitHub's side. */
export async function deleteDataGist(token: string, gistId: string): Promise<void> {
  await request<void>(token, `/gists/${gistId}`, { method: 'DELETE' });
}

function serialise(envelope: SyncEnvelope): string {
  return JSON.stringify(envelope, null, 0);
}

export function gistUrl(gistId: string): string {
  return `https://gist.github.com/${gistId}`;
}
