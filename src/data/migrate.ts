import { DEFAULT_PLANNING, STATE_VERSION } from '../config/catConfig';
import { isThemeName } from '../config/themes';
import { DEFAULT_DECK_OPTIONS } from '../flashcards/scheduler';
import type { AppState } from '../domain/types';
import { createInitialState } from './defaultState';

/** Weekly outcomes the planner made for the error log, which no longer exists. */
const RETIRED_OUTCOMES = new Set(['Establish error tracking', 'Reduce repeated errors']);

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
    // Added with flashcards; older data simply has none.
    decks: (raw.decks ?? []).map((d) => ({ ...d, options: { ...DEFAULT_DECK_OPTIONS, ...(d.options ?? {}) } })),
    flashcards: raw.flashcards ?? [],
    cardReviews: raw.cardReviews ?? [],
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

  // The error log was removed; its default goal goes with it. A tombstone,
  // rather than a silent filter, so a synced copy does not bring it back.
  const retired = state.goals.filter((g) => g.metric === 'errors resolved');
  if (retired.length > 0) {
    const at = new Date().toISOString();
    state.goals = state.goals.filter((g) => g.metric !== 'errors resolved');
    state.deletedIds = { ...state.deletedIds, ...Object.fromEntries(retired.map((g) => [g.id, at])) };
  }
  // Error-review work the planner scheduled and nobody has done yet goes too,
  // with the weekly outcomes it was there to serve. Done or hand-made tasks stay.
  const stale = state.tasks.filter((t) => t.type === 'error-review' && t.origin === 'auto' && t.status === 'planned');
  if (stale.length > 0) {
    const at = new Date().toISOString();
    const ids = new Set(stale.map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !ids.has(t.id));
    state.deletedIds = { ...state.deletedIds, ...Object.fromEntries(stale.map((t) => [t.id, at])) };
  }
  state.weeks = state.weeks.map((w) => {
    const outcomes = w.outcomes.filter((o) => !RETIRED_OUTCOMES.has(o.title));
    return outcomes.length === w.outcomes.length ? w : { ...w, outcomes, updatedAt: new Date().toISOString() };
  });

  return state;
}
