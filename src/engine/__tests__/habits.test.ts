import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { nowISO, uid } from '../../domain/ids';
import type { AppState, HabitDay } from '../../domain/types';
import { calculateHabitStats, scoreDay, studyLogRows, studyMinutesTotal, studyTotals } from '../habits';
import { makeState, TODAY } from './fixtures';

/** Marks the first `done` habits of `state` on `date`. */
function marked(state: AppState, date: string, done: number): HabitDay {
  const marks: Record<string, boolean> = {};
  state.habits.forEach((h, i) => {
    marks[h.id] = i < done;
  });
  return { id: uid('hd'), createdAt: nowISO(), updatedAt: nowISO(), date, marks };
}

describe('scoreDay', () => {
  it('scores a day as the share of habits ticked', () => {
    const state = makeState();
    state.habitDays = [marked(state, TODAY, 3)];
    const score = scoreDay(state, TODAY, 0.6);

    expect(score.total).toBe(6);
    expect(score.done).toBe(3);
    expect(score.score).toBeCloseTo(0.5, 5);
    expect(score.hit).toBe(false);
  });

  it('counts a day once the threshold is reached', () => {
    const state = makeState();
    state.habitDays = [marked(state, TODAY, 4)];
    expect(scoreDay(state, TODAY, 0.6).hit).toBe(true);
  });

  it('marks a day with no entries as untouched rather than failed', () => {
    const score = scoreDay(makeState(), TODAY, 0.6);
    expect(score.untouched).toBe(true);
    expect(score.done).toBe(0);
  });

  it('ignores paused habits', () => {
    const state = makeState();
    state.habits = state.habits.map((h, i) => (i < 3 ? { ...h, active: false } : h));
    state.habitDays = [marked(state, TODAY, 6)];
    const score = scoreDay(state, TODAY, 0.6);
    expect(score.total).toBe(3);
  });
});

describe('streaks', () => {
  it('counts consecutive days that met the threshold', () => {
    const state = makeState();
    state.habitDays = [0, 1, 2, 3].map((i) => marked(state, addDays(TODAY, -i), 5));

    const stats = calculateHabitStats(state, TODAY);
    expect(stats.currentStreak).toBe(4);
    expect(stats.bestStreak).toBe(4);
  });

  it('does not break the streak just because today is not filled in yet', () => {
    const state = makeState();
    // Yesterday and the day before were hits; today has nothing recorded.
    state.habitDays = [1, 2, 3].map((i) => marked(state, addDays(TODAY, -i), 6));

    const stats = calculateHabitStats(state, TODAY);
    expect(stats.today.untouched).toBe(true);
    expect(stats.currentStreak).toBe(3);
  });

  it('breaks the streak when today was recorded but missed the threshold', () => {
    const state = makeState();
    state.habitDays = [
      marked(state, TODAY, 1),
      ...[1, 2, 3].map((i) => marked(state, addDays(TODAY, -i), 6)),
    ];

    expect(calculateHabitStats(state, TODAY).currentStreak).toBe(0);
  });

  it('remembers the best streak after the current one breaks', () => {
    const state = makeState();
    state.habitDays = [
      // A five-day run a while back...
      ...[10, 11, 12, 13, 14].map((i) => marked(state, addDays(TODAY, -i), 6)),
      // ...a miss...
      marked(state, addDays(TODAY, -9), 1),
      // ...then a shorter current run.
      ...[0, 1].map((i) => marked(state, addDays(TODAY, -i), 6)),
    ];

    const stats = calculateHabitStats(state, TODAY);
    expect(stats.bestStreak).toBe(5);
    expect(stats.currentStreak).toBe(2);
  });

  it('reports consistency over logged days only', () => {
    const state = makeState();
    state.habitDays = [
      marked(state, TODAY, 6),
      marked(state, addDays(TODAY, -1), 6),
      marked(state, addDays(TODAY, -2), 1),
      marked(state, addDays(TODAY, -3), 6),
    ];

    const stats = calculateHabitStats(state, TODAY);
    // 3 hits out of 4 recorded days; the other 56 untouched days do not count.
    expect(stats.consistency).toBeCloseTo(0.75, 5);
  });

  it('respects a configured threshold', () => {
    const state = makeState();
    state.settings.planning = { ...state.settings.planning, habitStreakThreshold: 1 };
    state.habitDays = [marked(state, TODAY, 5)];

    expect(calculateHabitStats(state, TODAY).currentStreak).toBe(0);

    state.settings.planning = { ...state.settings.planning, habitStreakThreshold: 0.8 };
    expect(calculateHabitStats(state, TODAY).currentStreak).toBe(1);
  });

  it('starts at zero with no history at all', () => {
    const stats = calculateHabitStats(makeState(), TODAY);
    expect(stats.currentStreak).toBe(0);
    expect(stats.bestStreak).toBe(0);
    expect(stats.activeHabits).toHaveLength(6);
  });
});

describe('study log', () => {
  function withStudy(): AppState {
    const state = makeState();
    state.dayLogs = [
      {
        id: uid('log'),
        createdAt: nowISO(),
        updatedAt: nowISO(),
        date: TODAY,
        energy: 4,
        estimatedAvailableMin: 240,
        focusedMin: 165,
        unexpectedCommitments: '',
        note: 'Good session',
        study: {
          QA: { minutes: 90, topics: 'Ratios, averages' },
          DILR: { minutes: 45, topics: '2 arrangement sets' },
          VARC: { minutes: 30, topics: '2 RC passages' },
        },
      },
    ];
    return state;
  }

  it('totals the sections for a day', () => {
    const rows = studyLogRows(withStudy(), TODAY, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalMin).toBe(165);
    expect(rows[0].sections.QA.topics).toBe('Ratios, averages');
  });

  it('falls back to overall focused time when nothing was split out', () => {
    const state = makeState();
    state.dayLogs = [
      {
        id: uid('log'),
        createdAt: nowISO(),
        updatedAt: nowISO(),
        date: TODAY,
        energy: 3,
        estimatedAvailableMin: 180,
        focusedMin: 120,
        unexpectedCommitments: '',
      },
    ];
    expect(studyLogRows(state, TODAY, TODAY)[0].totalMin).toBe(120);
  });

  it('returns the most recent day first', () => {
    const rows = studyLogRows(withStudy(), addDays(TODAY, -6), TODAY);
    expect(rows).toHaveLength(7);
    expect(rows[0].date).toBe(TODAY);
  });

  it('aggregates totals by section across a range', () => {
    const totals = studyTotals(studyLogRows(withStudy(), addDays(TODAY, -6), TODAY));
    expect(totals.totalMin).toBe(165);
    expect(totals.bySection.QA).toBe(90);
    expect(totals.daysLogged).toBe(1);
    expect(totals.averageMinPerLoggedDay).toBe(165);
  });

  it('sums section minutes for the focused-time figure', () => {
    expect(studyMinutesTotal({ QA: { minutes: 60 }, VARC: { minutes: 30 } })).toBe(90);
    expect(studyMinutesTotal(undefined)).toBe(0);
  });
});
