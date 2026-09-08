import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSyncConfig,
  connectToSpace,
  deleteSpace,
  describeSyncError,
  discoverSpaces,
  forgetDevice,
  loadSyncConfig,
  renameSpace,
  syncOnce,
  type SpaceTarget,
  type SyncConfig,
  type SyncState,
} from '../data/sync/syncService';
import type { SpaceSummary } from '../data/sync/gistClient';
import { fingerprint } from '../data/sync/merge';
import type { AppState } from '../domain/types';

/** How long the app waits after your last edit before pushing. */
const PUSH_DEBOUNCE_MS = 6_000;
/** Periodic pull so a change made on the other device shows up on its own. */
const POLL_INTERVAL_MS = 5 * 60_000;

export interface SyncApi {
  sync: SyncState;
  /** Step one: validate the token and list the datasets already in the account. */
  discoverSpaces: (token: string) => Promise<SpaceSummary[]>;
  /** Step two: join a chosen dataset, or create a separate new one. */
  connectToSpace: (token: string, target: SpaceTarget) => Promise<void>;
  renameSpace: (gistId: string, name: string, token?: string) => Promise<void>;
  deleteSpace: (gistId: string, token?: string) => Promise<void>;
  forgetDevice: (deviceId: string) => Promise<void>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
}

/**
 * Background reconciliation loop.
 *
 * Deliberately conservative: it never blocks the UI, never discards local
 * state on failure, and only pushes when the fingerprint of the data actually
 * changed - so idling in the app does not burn GitHub API calls.
 */
export function useSync(
  state: AppState,
  loading: boolean,
  adopt: (next: AppState) => void,
): SyncApi {
  const [config, setConfig] = useState<SyncConfig | null>(() => loadSyncConfig());
  const [sync, setSync] = useState<SyncState>(() => {
    const existing = loadSyncConfig();
    return {
      phase: existing ? 'idle' : 'disconnected',
      connected: Boolean(existing),
      lastSyncedAt: existing?.lastSyncedAt,
      devices: [],
      spaceName: existing?.spaceName,
    };
  });

  const stateRef = useRef(state);
  const configRef = useRef(config);
  const runningRef = useRef(false);
  const syncedPrintRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  stateRef.current = state;
  configRef.current = config;

  const run = useCallback(
    async (reason: 'manual' | 'auto') => {
      const current = configRef.current;
      if (!current || runningRef.current) return;
      runningRef.current = true;
      setSync((s) => ({ ...s, phase: 'syncing', error: undefined }));

      try {
        const outcome = await syncOnce(current, stateRef.current);
        // Adopt the merged result only when it differs, so we do not churn state.
        if (outcome.changedLocally) adopt(outcome.state);
        syncedPrintRef.current = fingerprint(outcome.state);
        setConfig(outcome.config);
        setSync({
          phase: 'idle',
          connected: true,
          lastSyncedAt: outcome.config.lastSyncedAt,
          message: outcome.message,
          devices: Object.entries(outcome.devices ?? {})
            .map(([id, d]) => ({ id, name: d.name, lastSeen: d.lastSeen, isThisDevice: id === outcome.config.deviceId }))
            .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)),
          gistId: outcome.config.gistId,
          spaceName: outcome.config.spaceName,
        });
      } catch (err) {
        // A failed sync is never fatal: local data is untouched and we retry.
        setSync((s) => ({ ...s, phase: 'error', error: describeSyncError(err) }));
        if (reason === 'auto') console.warn('Background sync failed', err);
      } finally {
        runningRef.current = false;
      }
    },
    [adopt],
  );

  /* Pull once on start-up. */
  useEffect(() => {
    if (loading || !config) return;
    void run('auto');
    // Only on the transition into a loaded, connected state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, config?.token, config?.gistId]);

  /* Push shortly after edits settle. */
  useEffect(() => {
    if (loading || !config) return;
    const print = fingerprint(state);
    if (syncedPrintRef.current === null || print === syncedPrintRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run('auto'), PUSH_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state, loading, config, run]);

  /* Pull when the app comes back to the foreground, and on a slow timer. */
  useEffect(() => {
    if (!config) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run('auto');
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => void run('auto'), POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [config, run]);

  const discover = useCallback(async (token: string) => {
    setSync((s) => ({ ...s, error: undefined }));
    try {
      return await discoverSpaces(token);
    } catch (err) {
      setSync((s) => ({ ...s, phase: 'disconnected', connected: false, error: describeSyncError(err) }));
      throw err;
    }
  }, []);

  const joinSpace = useCallback(async (token: string, target: SpaceTarget) => {
    setSync((s) => ({ ...s, phase: 'syncing', error: undefined }));
    try {
      const { config: next, joined } = await connectToSpace(token, target, stateRef.current);
      setConfig(next);
      syncedPrintRef.current = null;
      setSync({
        phase: 'idle',
        connected: true,
        lastSyncedAt: next.lastSyncedAt,
        message: joined
          ? `Joined "${next.spaceName}". Pulling its data now.`
          : `Created "${next.spaceName}". This device is now its source.`,
        devices: [],
        gistId: next.gistId,
        spaceName: next.spaceName,
      });
    } catch (err) {
      // Nothing was stored, so the device is still disconnected - show the
      // error against the setup form rather than a phantom connection.
      setSync((s) => ({ ...s, phase: 'disconnected', connected: false, error: describeSyncError(err) }));
      throw err;
    }
  }, []);

  const rename = useCallback(async (gistId: string, name: string, token?: string) => {
    const auth = token ?? configRef.current?.token;
    if (!auth) throw new Error('No token available.');
    const next = await renameSpace(auth, gistId, name);
    if (next && next.gistId === configRef.current?.gistId) {
      setConfig(next);
      setSync((s) => ({ ...s, spaceName: next.spaceName, message: `Renamed to "${next.spaceName}".` }));
    }
  }, []);

  const removeSpace = useCallback(async (gistId: string, token?: string) => {
    const auth = token ?? configRef.current?.token;
    if (!auth) throw new Error('No token available.');
    const { disconnected } = await deleteSpace(auth, gistId);
    if (disconnected) {
      setConfig(null);
      syncedPrintRef.current = null;
      setSync({
        phase: 'disconnected',
        connected: false,
        devices: [],
        message: 'Space deleted. This device is no longer syncing, but its data is untouched.',
      });
    }
  }, []);

  const removeDevice = useCallback(async (deviceId: string) => {
    const current = configRef.current;
    if (!current?.gistId) throw new Error('Not connected to a space.');
    await forgetDevice(current.token, current.gistId, deviceId);
    setSync((s) => ({ ...s, devices: s.devices.filter((d) => d.id !== deviceId) }));
  }, []);

  const disconnect = useCallback(() => {
    clearSyncConfig();
    setConfig(null);
    syncedPrintRef.current = null;
    setSync({ phase: 'disconnected', connected: false, devices: [] });
  }, []);

  const syncNow = useCallback(async () => {
    await run('manual');
  }, [run]);

  return {
    sync,
    discoverSpaces: discover,
    connectToSpace: joinSpace,
    renameSpace: rename,
    deleteSpace: removeSpace,
    forgetDevice: removeDevice,
    disconnect,
    syncNow,
  };
}
