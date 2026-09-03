import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSyncConfig,
  connect as connectSync,
  describeSyncError,
  loadSyncConfig,
  syncOnce,
  type SyncConfig,
  type SyncState,
} from '../data/sync/syncService';
import { fingerprint } from '../data/sync/merge';
import type { AppState } from '../domain/types';

/** How long the app waits after your last edit before pushing. */
const PUSH_DEBOUNCE_MS = 6_000;
/** Periodic pull so a change made on the other device shows up on its own. */
const POLL_INTERVAL_MS = 5 * 60_000;

export interface SyncApi {
  sync: SyncState;
  connect: (token: string) => Promise<void>;
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

  const connect = useCallback(
    async (token: string) => {
      setSync((s) => ({ ...s, phase: 'syncing', error: undefined }));
      try {
        const { config: next, adopted } = await connectSync(token, stateRef.current);
        setConfig(next);
        syncedPrintRef.current = null;
        setSync({
          phase: 'idle',
          connected: true,
          lastSyncedAt: next.lastSyncedAt,
          message: adopted
            ? 'Connected to the sync file your other device created. Pulling its data now.'
            : 'Sync set up. This device is now the source for your other devices.',
          devices: [],
          gistId: next.gistId,
        });
      } catch (err) {
        // Nothing was stored, so the device is still disconnected - show the
        // error against the setup form rather than a phantom connection.
        setSync((s) => ({ ...s, phase: 'disconnected', connected: false, error: describeSyncError(err) }));
        throw err;
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    clearSyncConfig();
    setConfig(null);
    syncedPrintRef.current = null;
    setSync({ phase: 'disconnected', connected: false, devices: [] });
  }, []);

  const syncNow = useCallback(async () => {
    await run('manual');
  }, [run]);

  return { sync, connect, disconnect, syncNow };
}
