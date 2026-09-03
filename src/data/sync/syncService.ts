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
  findDataGist,
  GistError,
  readDataGist,
  verifyToken,
  writeDataGist,
  type SyncDevice,
  type SyncEnvelope,
} from './gistClient';
import { describeMerge, fingerprint, mergeStates } from './merge';

const CONFIG_KEY = 'cat-monitor:sync';

export interface SyncConfig {
  /** GitHub personal access token with the `gist` scope. Device-local only. */
  token: string;
  gistId?: string;
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
  /** True when an existing gist from another device was adopted. */
  adopted: boolean;
}

/**
 * Validates the token, then either adopts the gist another device already
 * created or creates a new one. Adoption is what makes the second device a
 * paste-the-token-and-done affair.
 */
export async function connect(token: string, state: AppState): Promise<ConnectResult> {
  const trimmed = token.trim();
  if (!trimmed) throw new GistError('Paste a GitHub token to connect.');

  await verifyToken(trimmed);

  const deviceId = newDeviceId();
  const deviceName = detectDeviceName();
  const existing = await findDataGist(trimmed);

  if (existing) {
    const config: SyncConfig = { token: trimmed, gistId: existing, deviceId, deviceName };
    saveSyncConfig(config);
    return { config, adopted: true };
  }

  const envelope: SyncEnvelope = {
    app: 'cat-monitor',
    envelopeVersion: 1,
    updatedAt: new Date().toISOString(),
    devices: { [deviceId]: { name: deviceName, lastSeen: new Date().toISOString() } },
    state,
  };
  const gistId = await createDataGist(trimmed, envelope);
  const config: SyncConfig = { token: trimmed, gistId, deviceId, deviceName, lastSyncedAt: envelope.updatedAt };
  saveSyncConfig(config);
  return { config, adopted: false };
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
  let gistId = config.gistId;
  if (!gistId) {
    gistId = await findDataGist(config.token);
  }

  const now = new Date().toISOString();
  const thisDevice: SyncDevice = { name: config.deviceName, lastSeen: now };

  // Nothing on GitHub yet: this device seeds it.
  if (!gistId) {
    const envelope: SyncEnvelope = {
      app: 'cat-monitor',
      envelopeVersion: 1,
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
      updatedAt: now,
      devices,
      state: merged,
    });
    pushed = true;
  }

  const nextConfig = { ...config, gistId, lastSyncedAt: now };
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
