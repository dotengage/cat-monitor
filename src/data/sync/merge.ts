/**
 * Two-device merge.
 *
 * Sync is per-record, not per-document. If your phone and your laptop have
 * both been used since the last sync, "whichever synced last wins" would throw
 * away an evening of work. Instead every record carries `updatedAt`, so the
 * newer edit of each individual task, mock or error survives, and deletions
 * are remembered as tombstones so they are not resurrected by the other device.
 *
 * This is deliberately a pure function: it is the riskiest code in the app and
 * the easiest place to lose data, so it is directly testable.
 */
import type { AppState, Entity } from '../../domain/types';

/** Tombstones older than this are pruned; both devices will have converged. */
export const TOMBSTONE_TTL_DAYS = 90;

const COLLECTIONS = [
  'goals',
  'topics',
  'commitments',
  'weeks',
  'tasks',
  'mocks',
  'practice',
  'errors',
  'dayLogs',
  'reviews',
  'decisions',
  'capacityRecords',
] as const;

type CollectionKey = (typeof COLLECTIONS)[number];

export interface MergeReport {
  fromRemote: number;
  fromLocal: number;
  deleted: number;
  conflicts: number;
  changed: boolean;
}

function stamp(entity: Entity): number {
  const value = Date.parse(entity.updatedAt || entity.createdAt || '');
  return Number.isNaN(value) ? 0 : value;
}

/** Newest `updatedAt` wins, per record, with deletions taking precedence. */
function mergeCollection<T extends Entity>(
  local: T[],
  remote: T[],
  tombstones: Record<string, string>,
  report: MergeReport,
): T[] {
  const byId = new Map<string, T>();

  for (const item of local) byId.set(item.id, item);

  for (const item of remote) {
    const mine = byId.get(item.id);
    if (!mine) {
      byId.set(item.id, item);
      report.fromRemote += 1;
      continue;
    }
    if (stamp(item) > stamp(mine)) {
      byId.set(item.id, item);
      report.fromRemote += 1;
      // Both sides touched this record since the last sync.
      if (stamp(mine) > 0) report.conflicts += 1;
    } else if (stamp(mine) > stamp(item)) {
      report.fromLocal += 1;
      if (stamp(item) > 0) report.conflicts += 1;
    }
  }

  const survivors: T[] = [];
  for (const item of byId.values()) {
    const deletedAt = tombstones[item.id];
    // A delete only wins if it happened after the edit it is competing with.
    if (deletedAt && Date.parse(deletedAt) >= stamp(item)) {
      report.deleted += 1;
      continue;
    }
    survivors.push(item);
  }
  return survivors;
}

function mergeTombstones(
  local: Record<string, string>,
  remote: Record<string, string>,
  now: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  const cutoff = now - TOMBSTONE_TTL_DAYS * 86_400_000;
  for (const [id, at] of [...Object.entries(local), ...Object.entries(remote)]) {
    const ts = Date.parse(at);
    if (Number.isNaN(ts) || ts < cutoff) continue;
    const existing = out[id] ? Date.parse(out[id]) : -1;
    if (ts > existing) out[id] = at;
  }
  return out;
}

/** Later `updatedAt` wins for the single-object slices. */
function newerOf<T extends Entity>(local: T, remote: T | undefined): T {
  if (!remote) return local;
  return stamp(remote) > stamp(local) ? remote : local;
}

/**
 * A device that has never been used: freshly installed, onboarding not done,
 * nothing entered. Its seeded topics and goals carry different ids from the
 * other device's, so merging would produce two of everything. Such a device
 * adopts the remote wholesale instead.
 */
export function isPristine(state: AppState): boolean {
  return (
    !state.profile.onboarded &&
    state.tasks.length === 0 &&
    state.mocks.length === 0 &&
    state.practice.length === 0 &&
    state.errors.length === 0 &&
    state.dayLogs.length === 0 &&
    state.reviews.length === 0 &&
    state.weeks.length === 0
  );
}

export function mergeStates(
  local: AppState,
  remote: AppState,
  now: number = Date.now(),
): { state: AppState; report: MergeReport } {
  const report: MergeReport = { fromRemote: 0, fromLocal: 0, deleted: 0, conflicts: 0, changed: false };

  // A brand-new device takes the existing data as-is rather than merging its
  // own untouched seed data into it. This is symmetric: whichever side is the
  // empty one yields entirely, so a freshly connected device can neither
  // duplicate the seed topics nor overwrite real work with its blank slate.
  if (isPristine(local) && !isPristine(remote)) {
    return {
      state: remote,
      report: { fromRemote: 1, fromLocal: 0, deleted: 0, conflicts: 0, changed: true },
    };
  }
  if (isPristine(remote) && !isPristine(local)) {
    return {
      state: local,
      report: { fromRemote: 0, fromLocal: 1, deleted: 0, conflicts: 0, changed: false },
    };
  }

  const tombstones = mergeTombstones(local.deletedIds ?? {}, remote.deletedIds ?? {}, now);

  const merged: AppState = {
    ...local,
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    profile: newerOf(local.profile, remote.profile),
    settings: newerOf(local.settings, remote.settings),
    dismissedInsights: [...new Set([...(local.dismissedInsights ?? []), ...(remote.dismissedInsights ?? [])])],
    deletedIds: tombstones,
  };

  for (const key of COLLECTIONS) {
    const localItems = (local[key] ?? []) as unknown as Entity[];
    const remoteItems = (remote[key] ?? []) as unknown as Entity[];
    const result = mergeCollection(localItems, remoteItems, tombstones, report);
    // Newest first for the log-like collections, oldest first for the rest,
    // so the UI's existing ordering assumptions still hold.
    result.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    (merged as unknown as Record<CollectionKey, Entity[]>)[key] = result;
  }

  // The decision log is capped and read newest-first.
  merged.decisions = [...merged.decisions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 400);

  report.changed =
    report.fromRemote > 0 ||
    report.deleted > 0 ||
    JSON.stringify(stableShape(merged)) !== JSON.stringify(stableShape(local));

  return { state: merged, report };
}

/** Ignores key order so a reserialised object does not read as a change. */
function stableShape(state: AppState): unknown {
  return {
    profile: state.profile,
    settings: state.settings,
    counts: COLLECTIONS.map((k) => ((state[k] ?? []) as unknown[]).length),
    ids: COLLECTIONS.flatMap((k) => ((state[k] ?? []) as unknown as Entity[]).map((e) => `${e.id}@${e.updatedAt}`)).sort(),
    dismissed: [...(state.dismissedInsights ?? [])].sort(),
    deleted: Object.keys(state.deletedIds ?? {}).sort(),
  };
}

/** Stable fingerprint used to decide whether a push is needed at all. */
export function fingerprint(state: AppState): string {
  return JSON.stringify(stableShape(state));
}

export function describeMerge(report: MergeReport): string {
  if (!report.changed) return 'Already up to date.';
  const parts: string[] = [];
  if (report.fromRemote > 0) parts.push(`${report.fromRemote} update(s) pulled in`);
  if (report.fromLocal > 0) parts.push(`${report.fromLocal} local edit(s) kept`);
  if (report.deleted > 0) parts.push(`${report.deleted} deletion(s) applied`);
  if (report.conflicts > 0) parts.push(`${report.conflicts} record(s) edited on both devices - newest kept`);
  return parts.length > 0 ? parts.join(', ') + '.' : 'Synced.';
}
