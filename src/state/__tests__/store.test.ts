/**
 * Reducer integration tests.
 *
 * These walk the same path the UI does - onboarding, completing and missing
 * work, recording and analysing a mock, logging errors, running the weekly
 * review - and assert on the state that comes out the other side.
 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../data/defaultState';
import { migrate } from '../../data/migrate';
import { addDays, startOfWeek } from '../../domain/date';
import type { AppState, ReviewAnswers } from '../../domain/types';
import { handleMissedTask } from '../../engine/missedTask';
import { reducer, type Action } from '../store';

const TODAY = '2026-09-03';
const WEEK_START = startOfWeek(TODAY, 1);

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

function onboarded(): AppState {
  return run(createInitialState(TODAY), {
    type: 'onboarding/complete',
    today: TODAY,
    profile: {
      targetPercentile: 96,
      examDate: '2026-11-29',
      weekdayHours: { min: 1, normal: 3, max: 5 },
      weekendHours: { min: 2, normal: 5, max: 8 },
    },
    commitments: [
      {
        title: 'College lectures',
        type: 'college',
        startDate: TODAY,
        endDate: '2026-11-29',
        recurrence: 'weekly',
        daysOfWeek: [1, 2, 3, 4, 5],
        hoursPerDay: 5,
        reducesCapacity: false,
        flexible: false,
      },
    ],
  });
}

describe('onboarding', () => {
  const state = onboarded();

  it('marks the profile onboarded and keeps the stated target', () => {
    expect(state.profile.onboarded).toBe(true);
    expect(state.profile.targetPercentile).toBe(96);
  });

  it('generates exactly one week with 3-5 outcomes and real tasks', () => {
    expect(state.weeks).toHaveLength(1);
    expect(state.weeks[0].startDate).toBe(WEEK_START);
    expect(state.weeks[0].outcomes.length).toBeGreaterThanOrEqual(3);
    expect(state.weeks[0].outcomes.length).toBeLessThanOrEqual(5);
    expect(state.tasks.length).toBeGreaterThan(3);
  });

  it('renames the primary goal to the chosen target', () => {
    const primary = state.goals.find((g) => g.isPrimary);
    expect(primary?.title).toContain('96');
    expect(primary?.deadline).toBe('2026-11-29');
  });

  it('does not let routine college hours zero out capacity', () => {
    expect(state.weeks[0].capacityMin).toBeGreaterThan(0);
    expect(state.weeks[0].plannedMin).toBeGreaterThan(0);
  });
});

describe('task lifecycle', () => {
  it('records actual duration on completion', () => {
    const state = onboarded();
    const task = state.tasks.find((t) => t.status === 'planned')!;
    const next = run(state, { type: 'task/complete', id: task.id, actualMin: 75 });
    const updated = next.tasks.find((t) => t.id === task.id)!;

    expect(updated.status).toBe('done');
    expect(updated.actualMin).toBe(75);
    expect(updated.completedAt).toBeTruthy();
  });

  it('flags a missed task for a decision instead of moving it', () => {
    const state = onboarded();
    const task = state.tasks.find((t) => t.status === 'planned')!;
    const next = run(state, { type: 'task/miss', id: task.id });
    const updated = next.tasks.find((t) => t.id === task.id)!;

    expect(updated.status).toBe('missed');
    expect(updated.needsDecision).toBe(true);
    expect(updated.date).toBe(task.date); // not silently rolled forward
  });

  it('applies a missed-task decision and logs the reasoning', () => {
    let state = onboarded();
    const task = state.tasks.find((t) => t.status === 'planned')!;
    state = run(state, { type: 'task/miss', id: task.id });

    const missed = state.tasks.find((t) => t.id === task.id)!;
    const decision = handleMissedTask(missed, state, TODAY);
    state = run(state, { type: 'task/decision', id: task.id, decision, today: TODAY });

    const updated = state.tasks.find((t) => t.id === task.id)!;
    expect(updated.needsDecision).toBe(false);
    expect(state.decisions[0].subjectId).toBe(task.id);
    expect(state.decisions[0].reason.length).toBeGreaterThan(20);
    expect(state.decisions[0].auto).toBe(false);
  });

  it('sends postponed work to the backlog, not to tomorrow', () => {
    const state = onboarded();
    const task = state.tasks.find((t) => t.status === 'planned')!;
    const next = run(state, { type: 'task/postpone', id: task.id });
    const updated = next.tasks.find((t) => t.id === task.id)!;

    expect(updated.date).toBeNull();
    expect(updated.status).toBe('postponed');
    expect(updated.postponeCount).toBe(1);
  });

  it('records a reason whenever the user removes a task', () => {
    const state = onboarded();
    const task = state.tasks[0];
    const next = run(state, { type: 'task/remove', id: task.id, reason: 'No longer relevant.' });

    expect(next.tasks.find((t) => t.id === task.id)?.status).toBe('removed');
    expect(next.decisions[0].kind).toBe('REMOVE');
  });
});

describe('day rollover', () => {
  it('marks yesterday\'s unfinished work as missed without rescheduling it', () => {
    let state = onboarded();
    const task = state.tasks.find((t) => t.status === 'planned')!;
    state = { ...state, tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, date: '2026-09-01' } : t)) };

    const next = run(state, { type: 'rollover', today: TODAY });
    const updated = next.tasks.find((t) => t.id === task.id)!;

    expect(updated.status).toBe('missed');
    expect(updated.needsDecision).toBe(true);
    expect(updated.date).toBe('2026-09-01');
  });

  it('leaves future work untouched', () => {
    const state = onboarded();
    const before = state.tasks.filter((t) => t.date && t.date > TODAY).length;
    const next = run(state, { type: 'rollover', today: TODAY });
    expect(next.tasks.filter((t) => t.date && t.date > TODAY && t.status === 'planned').length).toBe(before);
  });
});

describe('mock centre', () => {
  it('keeps a mock incomplete until it is analysed, then updates the primary goal', () => {
    let state = onboarded();
    state = run(state, {
      type: 'mock/add',
      mock: {
        kind: 'full',
        date: '2026-09-02',
        provider: 'IMS',
        name: 'SimCAT 1',
        overallScore: 78,
        overallPercentile: 82,
        sections: {
          VARC: { score: 34, percentile: 88, attempts: 20, correct: 14, incorrect: 6 },
          DILR: { score: 10, percentile: 55, attempts: 10, correct: 4, incorrect: 6 },
          QA: { score: 22, percentile: 68, attempts: 18, correct: 9, incorrect: 9 },
        },
        lessons: [],
        analysed: false,
        weakTopicIds: [],
      },
    });

    expect(state.mocks).toHaveLength(1);
    expect(state.mocks[0].analysed).toBe(false);

    const id = state.mocks[0].id;
    state = run(state, {
      type: 'mock/update',
      id,
      patch: { analysed: true, lessons: ['Do not start with DILR'], weakTopicIds: [state.topics[0].id] },
    });

    expect(state.mocks[0].analysed).toBe(true);
    expect(state.goals.find((g) => g.isPrimary)?.currentValue).toBe(82);
    expect(state.goals.find((g) => g.metric === 'mocks analysed')?.currentValue).toBe(1);
  });
});

describe('error log', () => {
  it('tracks resolution against the error-reduction goal', () => {
    let state = onboarded();
    state = run(state, {
      type: 'error/add',
      entry: {
        date: TODAY,
        section: 'QA',
        question: 'Ratio Q12',
        errorType: 'calculation',
        explanation: 'Dropped a factor of 2',
        correctedApproach: 'Write the ratio before substituting',
        resolved: false,
      },
    });
    const id = state.errors[0].id;
    state = run(state, { type: 'error/update', id, patch: { resolved: true } });

    expect(state.errors[0].resolved).toBe(true);
    expect(state.goals.find((g) => g.metric === 'errors resolved')?.currentValue).toBe(1);
  });
});

describe('weekly review', () => {
  const answers: ReviewAnswers = {
    completedNote: 'Got through the arithmetic block.',
    missedNote: 'Skipped two RC sessions.',
    realityNote: 'Two unexpected meetings.',
    energy: 3,
    actualFocusedHours: 11,
    friction: 'QA took longer than estimated.',
    wins: 'Started logging errors.',
  };

  function weekWithHistory(): AppState {
    let state = onboarded();
    // Pretend the current week was planned at 18h and only 11h happened.
    const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      ...state.tasks[0],
      id: `hist-${i}`,
      title: `History session ${i}`,
      estimateMin: 90,
      date: days[i % 7],
      weekStart: WEEK_START,
      status: i < 7 ? ('done' as const) : ('missed' as const),
      actualMin: i < 7 ? 94 : undefined,
    }));
    state = { ...state, tasks };
    return state;
  }

  it('stores the review, records the week and rebuilds the next week from reality', () => {
    const state = weekWithHistory();
    const next = run(state, { type: 'review/save', weekStart: WEEK_START, today: TODAY, answers });

    expect(next.reviews).toHaveLength(1);
    expect(next.capacityRecords).toHaveLength(1);
    expect(next.capacityRecords[0].plannedMin).toBe(12 * 90);
    expect(next.capacityRecords[0].actualMin).toBe(11 * 60);

    const nextWeekStart = addDays(WEEK_START, 7);
    const generated = next.weeks.find((w) => w.startDate === nextWeekStart);
    expect(generated).toBeDefined();
    expect(generated?.generatedFrom).toBe('review');
    expect(generated?.reviewId).toBe(next.reviews[0].id);
  });

  it('does not demand the missed hours back', () => {
    const state = weekWithHistory();
    const next = run(state, { type: 'review/save', weekStart: WEEK_START, today: TODAY, answers });
    const nextWeekStart = addDays(WEEK_START, 7);
    const generated = next.weeks.find((w) => w.startDate === nextWeekStart)!;

    expect(generated.plannedMin).toBeLessThan(12 * 90);
    expect(generated.bufferMin).toBeGreaterThan(0);
  });

  it('logs why the capacity target changed', () => {
    const state = weekWithHistory();
    const next = run(state, { type: 'review/save', weekStart: WEEK_START, today: TODAY, answers });
    const capacityDecision = next.decisions.find((d) => d.kind === 'CAPACITY');
    expect(capacityDecision).toBeDefined();
    expect(capacityDecision?.reason.length).toBeGreaterThan(20);
  });
});

describe('rebalancing', () => {
  it('brings an overloaded day back within capacity and logs every change', () => {
    let state = onboarded();
    const heavy = Array.from({ length: 4 }, (_, i) => ({
      ...state.tasks[0],
      id: `heavy-${i}`,
      title: `Heavy ${i}`,
      estimateMin: 150,
      date: TODAY,
      status: 'planned' as const,
      locked: false,
    }));
    state = { ...state, tasks: heavy };

    const next = run(state, { type: 'week/rebalance', weekStart: WEEK_START, today: TODAY });
    const stillToday = next.tasks
      .filter((t) => t.date === TODAY && t.status === 'planned')
      .reduce((a, t) => a + t.estimateMin, 0);

    expect(stillToday).toBeLessThan(4 * 150);
    expect(next.decisions.length).toBeGreaterThan(0);
    expect(next.decisions.every((d) => d.reason.length > 10)).toBe(true);
  });
});

describe('persistence shape', () => {
  it('survives an export/import round trip', () => {
    const state = onboarded();
    const roundTripped = migrate(JSON.parse(JSON.stringify(state)));

    expect(roundTripped.tasks).toHaveLength(state.tasks.length);
    expect(roundTripped.weeks).toHaveLength(state.weeks.length);
    expect(roundTripped.profile.targetPercentile).toBe(96);
    expect(roundTripped.commitments[0].reducesCapacity).toBe(false);
  });

  it('fills in fields added after the data was written', () => {
    const legacy = JSON.parse(JSON.stringify(onboarded())) as AppState;
    // Simulate an older payload that predates several fields.
    legacy.commitments = legacy.commitments.map(
      (c) => ({ ...c, reducesCapacity: undefined }) as unknown as (typeof legacy.commitments)[number],
    );
    legacy.tasks = legacy.tasks.map((t) => ({ ...t, impact: undefined }) as unknown as (typeof legacy.tasks)[number]);

    const migrated = migrate(legacy);
    expect(migrated.tasks.every((t) => typeof t.impact === 'number')).toBe(true);
    // Routine weekly college hours default to "already counted".
    expect(migrated.commitments[0].reducesCapacity).toBe(false);
  });

  it('keeps a chosen theme and rejects one it does not recognise', () => {
    const themed = JSON.parse(JSON.stringify(onboarded())) as AppState;
    themed.settings = { ...themed.settings, theme: 'mint' };
    expect(migrate(themed).settings.theme).toBe('mint');

    const bogus = JSON.parse(JSON.stringify(onboarded())) as AppState;
    bogus.settings = { ...bogus.settings, theme: 'neon-disco' as unknown as AppState['settings']['theme'] };
    // An unknown palette has no stylesheet behind it, so it must not survive.
    expect(migrate(bogus).settings.theme).toBe('light');
  });

  it('gives data written before the brand existed a default name and glyph', () => {
    const legacy = JSON.parse(JSON.stringify(onboarded())) as AppState;
    delete (legacy.settings as Partial<AppState['settings']>).brand;

    const migrated = migrate(legacy);
    expect(migrated.settings.brand.name).toBe('CAT Monitor');
    expect(migrated.settings.brand.glyph).toBe('C');
    expect(migrated.settings.brand.image).toBeUndefined();
  });

  it('keeps a brand the user has customised', () => {
    const branded = JSON.parse(JSON.stringify(onboarded())) as AppState;
    branded.settings = { ...branded.settings, brand: { name: 'My Plan', glyph: '🎯' } };

    const migrated = migrate(branded);
    expect(migrated.settings.brand.name).toBe('My Plan');
    expect(migrated.settings.brand.glyph).toBe('🎯');
  });

  it('resets cleanly', () => {
    const next = run(onboarded(), { type: 'reset' });
    expect(next.profile.onboarded).toBe(false);
    expect(next.tasks).toHaveLength(0);
    expect(next.mocks).toHaveLength(0);
  });
});
