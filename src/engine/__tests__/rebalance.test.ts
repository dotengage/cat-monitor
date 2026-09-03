import { describe, expect, it } from 'vitest';
import { calculateWeekCapacity } from '../capacity';
import { isOpen } from '../derive';
import { loadByDay, rebalanceWeek } from '../rebalance';
import { makeState, makeTask, TODAY, WEEK_START } from './fixtures';

describe('rebalanceWeek', () => {
  it('brings an overloaded day back inside capacity', () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ title: `Heavy ${i}`, estimateMin: 120, date: TODAY, importance: 'important', impact: 3 }),
    );
    const state = makeState({ tasks });
    const result = rebalanceWeek(state, WEEK_START, TODAY);

    const cap = calculateWeekCapacity(state, WEEK_START, TODAY).days.find((d) => d.date === TODAY)!;
    const loadAfter = result.tasks
      .filter((t) => t.date === TODAY && isOpen(t))
      .reduce((a, t) => a + t.estimateMin, 0);

    expect(result.before.overloadedDays).toContain(TODAY);
    expect(loadAfter).toBeLessThanOrEqual(cap.plannedMin);
    expect(result.moved + result.postponed + result.removed).toBeGreaterThan(0);
  });

  it('logs a reason for every change it makes', () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ title: `Heavy ${i}`, estimateMin: 150, date: TODAY }),
    );
    const result = rebalanceWeek(makeState({ tasks }), WEEK_START, TODAY);
    expect(result.decisions.length).toBeGreaterThan(0);
    for (const d of result.decisions) {
      expect(d.reason.length).toBeGreaterThan(20);
      expect(d.auto).toBe(true);
    }
  });

  it('cuts optional low-value work rather than stacking it on another day', () => {
    const optional = makeTask({ title: 'Optional reading', estimateMin: 200, importance: 'optional', impact: 1, date: TODAY });
    const critical = Array.from({ length: 6 }, (_, i) =>
      makeTask({ title: `Critical ${i}`, estimateMin: 120, importance: 'critical', impact: 5, locked: true, date: ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'][i % 4] }),
    );
    const result = rebalanceWeek(makeState({ tasks: [optional, ...critical] }), WEEK_START, TODAY);
    const after = result.tasks.find((t) => t.id === optional.id)!;
    expect(['removed', 'postponed']).toContain(after.status);
  });

  it('never touches protected tasks', () => {
    const locked = makeTask({ title: 'Protected mock', estimateMin: 300, locked: true, date: TODAY });
    const result = rebalanceWeek(makeState({ tasks: [locked] }), WEEK_START, TODAY);
    const after = result.tasks.find((t) => t.id === locked.id)!;
    expect(after.date).toBe(TODAY);
    expect(after.status).toBe('planned');
  });

  it('pulls high-value backlog work forward when real capacity appears', () => {
    const backlog = makeTask({
      title: 'Analyse mock',
      date: null,
      weekStart: null,
      status: 'postponed',
      type: 'analysis',
      importance: 'critical',
      impact: 5,
      estimateMin: 60,
      section: 'DILR',
    });
    const result = rebalanceWeek(makeState({ tasks: [backlog] }), WEEK_START, TODAY);
    const after = result.tasks.find((t) => t.id === backlog.id)!;

    expect(result.promoted).toBe(1);
    expect(after.date).not.toBeNull();
    expect(result.decisions.some((d) => d.kind === 'PROMOTE')).toBe(true);
  });

  it('does not fill spare capacity with low-value work', () => {
    const backlog = makeTask({
      title: 'Optional tidying',
      date: null,
      weekStart: null,
      status: 'postponed',
      importance: 'optional',
      impact: 1,
      type: 'personal',
      estimateMin: 30,
    });
    const result = rebalanceWeek(makeState({ tasks: [backlog] }), WEEK_START, TODAY);
    expect(result.promoted).toBe(0);
    expect(result.tasks.find((t) => t.id === backlog.id)?.date).toBeNull();
  });
});

describe('loadByDay', () => {
  it('reports free capacity per day', () => {
    const state = makeState({ tasks: [makeTask({ estimateMin: 60, date: TODAY })] });
    const rows = loadByDay(state, WEEK_START, TODAY);
    const todayRow = rows.find((r) => r.date === TODAY)!;
    expect(todayRow.loadMin).toBe(60);
    expect(todayRow.freeMin).toBe(todayRow.capacityMin - 60);
  });
});
