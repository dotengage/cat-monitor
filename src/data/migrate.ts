import { DEFAULT_PLANNING, STATE_VERSION } from '../config/catConfig';
import { isThemeName } from '../config/themes';
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
      // Added after some users' data was written, and a bad value from an
      // older or hand-edited payload must not leave the app unthemed.
      theme: isThemeName(raw.settings?.theme) ? raw.settings.theme : base.settings.theme,
      brand: { ...base.settings.brand, ...(raw.settings?.brand ?? {}) },
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
    habits: raw.habits && raw.habits.length > 0 ? raw.habits : base.habits,
    habitDays: raw.habitDays ?? [],
    dismissedInsights: raw.dismissedInsights ?? [],
    deletedIds: raw.deletedIds ?? {},
  };

  // v2 made light the default theme. Only nudge users who never chose one.
  if ((raw.version ?? 1) < 2 && (raw.settings?.theme ?? 'system') === 'system') {
    state.settings = { ...state.settings, theme: 'light' };
  }

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
