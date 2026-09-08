/**
 * Sync orchestration.
 *
 * Local-first throughout: IndexedDB stays the source of truth for the running
 * app, and sync is a background reconciliation. If GitHub is unreachable the
 * app keeps working exactly as before and retries later.
 */
import type { AppState } from '../../domain/types';
import { uid } from '../../domain/ids';
import {
  createDataGist,
  deleteDataGist,
  forgetDeviceInGist,
  describeSpaces,
  GistError,
  listDataGists,
  readDataGist,
  renameDataGist,
  verifyToken,
  writeDataGist,
  type SpaceSummary,
  type SyncDevice,
  type SyncEnvelope,
} from './gistClient';
import { describeMerge, fingerprint, mergeStates } from './merge';

const CONFIG_KEY = 'cat-monitor:sync';

export interface SyncConfig {
  /** GitHub personal access token with the `gist` scope. Device-local only. */
  token: string;
  gistId?: string;
  /** Which dataset this device belongs to. */
  spaceId?: string;
  spaceName?: string;
  deviceId: string;
  deviceName: string;
  lastSyncedAt?: string;
}

export type SyncPhase = 'disconnected' | 'idle' | 'syncing' | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** Whether a token is actually stored on this device. */
  connected: boolean;
  lastSyncedAt?: string;
  message?: string;
  error?: string;
  devices: { id: string; name: string; lastSeen: string; isThisDevice: boolean }[];
  gistId?: string;
  spaceName?: string;
}

/* ------------------------------------------------------------------ */
/* Device-local config                                                 */
/* ------------------------------------------------------------------ */

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncConfig;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Could not persist sync configuration', err);
  }
}

export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}

/** A readable name so the device list means something. */
export function detectDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const platform = /iPhone|iPod/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android phone'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows PC'
            : /Linux/.test(ua)
              ? 'Linux PC'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua) && !/Edg\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'browser';
  return `${platform} (${browser})`;
}

export function newDeviceId(): string {
  return uid('device');
}

/* ------------------------------------------------------------------ */
/* Connect                                                             */
/* ------------------------------------------------------------------ */

export interface ConnectResult {
  config: SyncConfig;
  /** True when an existing space was joined rather than created. */
  joined: boolean;
}

/**
 * Step one: prove the token works and show what is already in the account.
 *
 * Nothing is joined automatically. A GitHub account can hold more than one
 * dataset - two people, or one person with a separate practice copy - and
 * silently joining the first one found is exactly how two sets of data end up
 * merged into one.
 */
export async function discoverSpaces(token: string): Promise<SpaceSummary[]> {
  const trimmed = token.trim();
  if (!trimmed) throw new GistError('Paste a GitHub token to continue.');
  await verifyToken(trimmed);
  return describeSpaces(trimmed);
}

export type SpaceTarget =
  | { kind: 'join'; gistId: string; spaceName: string }
  | { kind: 'create'; spaceName: string };

/** Step two: join the chosen space, or create a brand-new, separate one. */
export async function connectToSpace(
  token: string,
  target: SpaceTarget,
  state: AppState,
): Promise<ConnectResult> {
  const trimmed = token.trim();
  const deviceId = newDeviceId();
  const deviceName = detectDeviceName();
  const now = new Date().toISOString();

  if (target.kind === 'join') {
    const config: SyncConfig = {
      token: trimmed,
      gistId: target.gistId,
      spaceName: target.spaceName,
      deviceId,
      deviceName,
    };
    saveSyncConfig(config);
    return { config, joined: true };
  }

  const spaceId = uid('space');
  const envelope: SyncEnvelope = {
    app: 'cat-monitor',
    envelopeVersion: 1,
    spaceId,
    spaceName: target.spaceName,
    updatedAt: now,
    devices: { [deviceId]: { name: deviceName, lastSeen: now } },
    state,
  };
  const gistId = await createDataGist(trimmed, envelope);
  const config: SyncConfig = {
    token: trimmed,
    gistId,
    spaceId,
    spaceName: target.spaceName,
    deviceId,
    deviceName,
    lastSyncedAt: now,
  };
  saveSyncConfig(config);
  return { config, joined: false };
}

/* ------------------------------------------------------------------ */
/* Managing spaces                                                     */
/* ------------------------------------------------------------------ */

/** Renames a space, and keeps this device's label in step if it is the one. */
export async function renameSpace(token: string, gistId: string, spaceName: string): Promise<SyncConfig | null> {
  const name = spaceName.trim();
  if (!name) throw new GistError('Give the space a name.');
  await renameDataGist(token, gistId, name);

  const config = loadSyncConfig();
  if (config && config.gistId === gistId) {
    const next = { ...config, spaceName: name };
    saveSyncConfig(next);
    return next;
  }
  return config;
}

/** Drops a device from the shared list. See the note on revocation. */
export async function forgetDevice(token: string, gistId: string, deviceId: string): Promise<void> {
  const config = loadSyncConfig();
  if (config && config.deviceId === deviceId) {
    throw new GistError('That is this device. Use "Disconnect this device" instead.');
  }
  await forgetDeviceInGist(token, gistId, deviceId);
}

/**
 * Deletes a space from GitHub for good.
 *
 * Local data is untouched: this removes the shared copy, not the copy on this
 * device. If it was the space this device syncs to, the device is disconnected
 * rather than left pointing at something that no longer exists.
 */
export async function deleteSpace(token: string, gistId: string): Promise<{ disconnected: boolean }> {
  await deleteDataGist(token, gistId);
  const config = loadSyncConfig();
  if (config && config.gistId === gistId) {
    clearSyncConfig();
    return { disconnected: true };
  }
  return { disconnected: false };
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

export interface SyncOutcome {
  state: AppState;
  changedLocally: boolean;
  pushed: boolean;
  message: string;
  config: SyncConfig;
  devices: SyncEnvelope['devices'];
}

/**
 * One reconciliation pass: pull, merge per record, push if anything differs.
 * Returns the merged state for the caller to adopt.
 */
export async function syncOnce(config: SyncConfig, local: AppState): Promise<SyncOutcome> {
  // Never guess which gist to use: a device stays in the space it joined.
  // Falling back to "whichever gist exists" is what merged two people's data.
  let gistId = config.gistId;
  if (!gistId) {
    const candidates = await listDataGists(config.token);
    if (candidates.length === 1) {
      gistId = candidates[0];
    } else if (candidates.length > 1) {
      throw new GistError(
        'This account holds several CAT Monitor datasets and this device is not attached to one. Disconnect and reconnect, then pick the right space.',
      );
    }
  }

  const now = new Date().toISOString();
  const thisDevice: SyncDevice = { name: config.deviceName, lastSeen: now };

  // Nothing on GitHub yet: this device seeds it.
  if (!gistId) {
    const envelope: SyncEnvelope = {
      app: 'cat-monitor',
      envelopeVersion: 1,
      spaceId: config.spaceId,
      spaceName: config.spaceName,
      updatedAt: now,
      devices: { [config.deviceId]: thisDevice },
      state: local,
    };
    const created = await createDataGist(config.token, envelope);
    const nextConfig = { ...config, gistId: created, lastSyncedAt: now };
    saveSyncConfig(nextConfig);
    return {
      state: local,
      changedLocally: false,
      pushed: true,
      message: 'Sync started. This device is now the source for your other devices.',
      config: nextConfig,
      devices: envelope.devices,
    };
  }

  const remote = await readDataGist(config.token, gistId);

  if (!remote) {
    const envelope: SyncEnvelope = {
      app: 'cat-monitor',
      envelopeVersion: 1,
      spaceId: config.spaceId,
      spaceName: config.spaceName,
      updatedAt: now,
      devices: { [config.deviceId]: thisDevice },
      state: local,
    };
    await writeDataGist(config.token, gistId, envelope);
    const nextConfig = { ...config, gistId, lastSyncedAt: now };
    saveSyncConfig(nextConfig);
    return {
      state: local,
      changedLocally: false,
      pushed: true,
      message: 'Uploaded this device\'s data.',
      config: nextConfig,
      devices: envelope.devices,
    };
  }

  const { state: merged, report } = mergeStates(local, remote.state);
  const devices: SyncEnvelope['devices'] = { ...remote.devices, [config.deviceId]: thisDevice };

  const remoteIsStale = fingerprint(merged) !== fingerprint(remote.state);
  const devicesChanged = JSON.stringify(remote.devices?.[config.deviceId]) !== JSON.stringify(thisDevice);

  let pushed = false;
  if (remoteIsStale || devicesChanged) {
    await writeDataGist(config.token, gistId, {
      app: 'cat-monitor',
      envelopeVersion: 1,
      spaceId: config.spaceId ?? remote.spaceId,
      spaceName: config.spaceName ?? remote.spaceName,
      updatedAt: now,
      devices,
      state: merged,
    });
    pushed = true;
  }

  const nextConfig = {
    ...config,
    gistId,
    spaceId: config.spaceId ?? remote.spaceId,
    spaceName: config.spaceName ?? remote.spaceName,
    lastSyncedAt: now,
  };
  saveSyncConfig(nextConfig);

  return {
    state: merged,
    changedLocally: fingerprint(merged) !== fingerprint(local),
    pushed,
    message: describeMerge(report),
    config: nextConfig,
    devices,
  };
}

export function describeSyncError(err: unknown): string {
  if (err instanceof GistError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Sync failed for an unknown reason.';
}
