/**
 * Merge tests.
 *
 * The failure mode that matters here is silent data loss: an evening of work
 * on the phone disappearing because the laptop synced afterwards. Every test
 * below is a shape of that bug.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../defaultState';
import type { AppState, Task } from '../../../domain/types';
import { describeMerge, fingerprint, mergeStates } from '../merge';

const T0 = '2026-09-01T10:00:00.000Z';
const T1 = '2026-09-01T12:00:00.000Z';
const T2 = '2026-09-01T14:00:00.000Z';

function base(): AppState {
  return createInitialState('2026-09-03');
}

/**
 * Two devices that already share a synced seed - same topic and goal ids.
 * That is the only situation in which a per-record merge is meant to run.
 */
function pair(): [AppState, AppState] {
  const seed = createInitialState('2026-09-03');
  seed.profile = { ...seed.profile, onboarded: true };
  return [structuredClone(seed), structuredClone(seed)];
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: T0,
    updatedAt: T0,
    title: `Task ${id}`,
    date: '2026-09-03',
    weekStart: '2026-08-31',
    type: 'practice',
    estimateMin: 60,
    importance: 'important',
    energyRequired: 3,
    impact: 3,
    dependsOn: [],
    status: 'planned',
    locked: false,
    postponeCount: 0,
    origin: 'auto',
    ...over,
  };
}

describe('mergeStates', () => {
  it('keeps work created on either device', () => {
    const [l, r] = pair();
    const { state } = mergeStates({ ...l, tasks: [task('a')] }, { ...r, tasks: [task('b')] });
    expect(state.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the newer edit of a record touched on both devices', () => {
    const [l, r] = pair();
    const local = { ...l, tasks: [task('a', { updatedAt: T2, status: 'done' as const, actualMin: 55 })] };
    const remote = { ...r, tasks: [task('a', { updatedAt: T1, status: 'missed' as const })] };

    const { state, report } = mergeStates(local, remote);
    expect(state.tasks[0].status).toBe('done');
    expect(state.tasks[0].actualMin).toBe(55);
    expect(report.conflicts).toBe(1);
  });

  it('accepts the remote edit when it is the newer one', () => {
    const [l, r] = pair();
    const local = { ...l, tasks: [task('a', { updatedAt: T1, status: 'planned' as const })] };
    const remote = { ...r, tasks: [task('a', { updatedAt: T2, status: 'done' as const })] };

    const { state, report } = mergeStates(local, remote);
    expect(state.tasks[0].status).toBe('done');
    expect(report.fromRemote).toBe(1);
  });

  it('never drops a completed task just because the other device is behind', () => {
    const [l, r] = pair();
    const local = { ...l, tasks: [task('a', { updatedAt: T2, status: 'done' as const, actualMin: 90 })] };

    const { state } = mergeStates(local, r);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('done');
  });

  it('honours a deletion instead of resurrecting the record', () => {
    const [l, r] = pair();
    const local: AppState = { ...l, mocks: [], deletedIds: { m1: T2 } };
    const remote: AppState = {
      ...r,
      mocks: [
        {
          id: 'm1',
          createdAt: T0,
          updatedAt: T1,
          kind: 'full',
          date: '2026-09-01',
          provider: 'IMS',
          name: 'Mock 1',
          sections: {},
          lessons: [],
          analysed: false,
          weakTopicIds: [],
        },
      ],
    };

    const { state, report } = mergeStates(local, remote);
    expect(state.mocks).toHaveLength(0);
    expect(report.deleted).toBe(1);
  });

  it('lets an edit made after the deletion win, rather than losing new work', () => {
    const [l, r] = pair();
    const local: AppState = { ...l, tasks: [], deletedIds: { a: T1 } };
    const remote: AppState = { ...r, tasks: [task('a', { updatedAt: T2, status: 'done' as const })] };

    const { state } = mergeStates(local, remote);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('done');
  });

  it('takes the newer profile and settings wholesale', () => {
    const [local, remote] = pair();
    local.profile = { ...local.profile, updatedAt: T1, targetPercentile: 96 };
    remote.profile = { ...remote.profile, updatedAt: T2, targetPercentile: 98 };

    const { state } = mergeStates(local, remote);
    expect(state.profile.targetPercentile).toBe(98);
  });

  it('unions dismissed insights rather than losing one side', () => {
    const [l, r] = pair();
    const { state } = mergeStates(
      { ...l, dismissedInsights: ['a', 'b'] },
      { ...r, dismissedInsights: ['b', 'c'] },
    );
    expect([...state.dismissedInsights].sort()).toEqual(['a', 'b', 'c']);
  });

  it('prunes tombstones once both devices have certainly converged', () => {
    const [l, r] = pair();
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();

    const { state } = mergeStates({ ...l, deletedIds: { ancient: old, recent } }, r);
    expect(state.deletedIds.ancient).toBeUndefined();
    expect(state.deletedIds.recent).toBe(recent);
  });

  it('is idempotent: merging the same data twice changes nothing', () => {
    const [l, r] = pair();
    const local = { ...l, tasks: [task('a'), task('b', { updatedAt: T1 })] };
    const remote = { ...r, tasks: [task('a'), task('c', { updatedAt: T2 })] };

    const first = mergeStates(local, remote).state;
    const second = mergeStates(first, remote).state;
    expect(fingerprint(second)).toBe(fingerprint(first));
    expect(mergeStates(first, first).report.changed).toBe(false);
  });

  it('is symmetric: both devices converge on the same result', () => {
    const [l, r] = pair();
    const a = { ...l, tasks: [task('x', { updatedAt: T2, status: 'done' as const }), task('y')] };
    const b = { ...r, tasks: [task('x', { updatedAt: T1, status: 'missed' as const }), task('z')] };

    const fromA = mergeStates(a, b).state;
    const fromB = mergeStates(b, a).state;

    expect(fromA.tasks.map((t) => `${t.id}:${t.status}`).sort()).toEqual(
      fromB.tasks.map((t) => `${t.id}:${t.status}`).sort(),
    );
  });

  it('caps the decision log after merging two devices worth of history', () => {
    const [l, r] = pair();
    const many = (prefix: string) =>
      Array.from({ length: 300 }, (_, i) => ({
        id: `${prefix}-${i}`,
        createdAt: new Date(Date.parse(T0) + i * 1000).toISOString(),
        updatedAt: T0,
        date: '2026-09-01',
        subject: 'x',
        kind: 'REMOVE' as const,
        reason: 'r',
        auto: true,
      }));

    const { state } = mergeStates({ ...l, decisions: many('l') }, { ...r, decisions: many('r') });
    expect(state.decisions).toHaveLength(400);
  });

  it('reports no change when the two sides already agree', () => {
    const [l] = pair();
    const local = { ...l, tasks: [task('a')] };
    const { report } = mergeStates(local, local);
    expect(report.changed).toBe(false);
    expect(describeMerge(report)).toBe('Already up to date.');
  });

  it('summarises what it did in plain language', () => {
    const [l, r] = pair();
    const { report } = mergeStates(
      { ...l, tasks: [task('a', { updatedAt: T2 })] },
      { ...r, tasks: [task('a', { updatedAt: T1 }), task('b')] },
    );
    expect(describeMerge(report)).toMatch(/pulled in/);
  });
});

describe('a brand-new device', () => {
  it('adopts existing data wholesale instead of duplicating the seed topics', () => {
    const fresh = base(); // installed, never onboarded: its own 40 seeded topics
    const [, established] = pair();
    established.tasks = [task('a', { updatedAt: T2 })];

    const { state } = mergeStates(fresh, established);

    // Exactly one set of topics, not two.
    expect(state.topics).toHaveLength(established.topics.length);
    expect(state.topics.map((t) => t.id).sort()).toEqual(established.topics.map((t) => t.id).sort());
    expect(state.tasks).toHaveLength(1);
    expect(state.profile.onboarded).toBe(true);
  });

  it('does not wipe a device that has real work on it', () => {
    const [used, other] = pair();
    used.tasks = [task('mine', { updatedAt: T2 })];
    other.tasks = [task('theirs', { updatedAt: T2 })];

    const { state } = mergeStates(used, other);
    expect(state.tasks.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('keeps the used device intact when the other side is the empty one', () => {
    const [used] = pair();
    used.tasks = [task('a')];

    const { state } = mergeStates(used, base());
    expect(state.tasks).toHaveLength(1);
    expect(state.topics).toHaveLength(used.topics.length);
  });
});

describe('fingerprint', () => {
  it('ignores key ordering so a round trip through JSON is not a change', () => {
    const [l] = pair();
    const state = { ...l, tasks: [task('a')] };
    const roundTripped = JSON.parse(JSON.stringify(state)) as AppState;
    expect(fingerprint(roundTripped)).toBe(fingerprint(state));
  });

  it('changes when a record is edited', () => {
    const [l, r] = pair();
    const before = { ...l, tasks: [task('a')] };
    const after = { ...r, tasks: [task('a', { updatedAt: T2 })] };
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });
});
