import { DEFAULT_PLANNING, STATE_VERSION } from '../config/catConfig';
import type { AppState } from '../domain/types';
import { createInitialState } from './defaultState';

/**
 * Forward-only migration. Unknown/older payloads are merged onto a fresh
 * default state so a missing field can never crash the app, and user data is
 * never dropped silently.
 */
export function migrate(raw: Partial<AppState>): AppState {
  const base = createInitialState();
  const state: AppState = {
    ...base,
    ...raw,
    version: STATE_VERSION,
    profile: { ...base.profile, ...(raw.profile ?? {}) },
    settings: {
      ...base.settings,
      ...(raw.settings ?? {}),
      planning: { ...DEFAULT_PLANNING, ...(raw.settings?.planning ?? {}) },
      notifications: { ...base.settings.notifications, ...(raw.settings?.notifications ?? {}) },
    },
    goals: raw.goals ?? base.goals,
    topics: raw.topics && raw.topics.length > 0 ? raw.topics : base.topics,
    commitments: raw.commitments ?? [],
    weeks: raw.weeks ?? [],
    tasks: raw.tasks ?? [],
    mocks: raw.mocks ?? [],
    practice: raw.practice ?? [],
    errors: raw.errors ?? [],
    dayLogs: raw.dayLogs ?? [],
    reviews: raw.reviews ?? [],
    decisions: raw.decisions ?? [],
    capacityRecords: raw.capacityRecords ?? [],
    dismissedInsights: raw.dismissedInsights ?? [],
    deletedIds: raw.deletedIds ?? {},
  };

  // Defensive normalisation: fields added after a user's data was written.
  state.tasks = state.tasks.map((t) => ({
    ...t,
    dependsOn: t.dependsOn ?? [],
    postponeCount: t.postponeCount ?? 0,
    impact: t.impact ?? 3,
    energyRequired: t.energyRequired ?? 3,
    locked: t.locked ?? false,
    origin: t.origin ?? 'user',
  }));
  state.commitments = state.commitments.map((c) => ({
    ...c,
    reducesCapacity:
      c.reducesCapacity ?? !(c.recurrence === 'weekly' && (c.type === 'college' || c.type === 'work')),
  }));
  state.mocks = state.mocks.map((m) => ({
    ...m,
    lessons: m.lessons ?? [],
    weakTopicIds: m.weakTopicIds ?? [],
    sections: m.sections ?? {},
    kind: m.kind ?? 'full',
  }));

  return state;
}
