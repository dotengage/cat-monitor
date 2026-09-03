import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { detectBehaviourPatterns, preferredWindow } from '../patterns';
import { completedTasks, makeState, makeTask, TODAY } from './fixtures';

function dated(offset: number) {
  return addDays(TODAY, -offset);
}

describe('detectBehaviourPatterns', () => {
  it('detects repeated morning failures and moves deep work instead of moralising', () => {
    const morning = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeTask({ title: `Morning ${i}`, window: 'morning', status: 'missed', date: dated(i + 1) }),
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makeTask({ title: `Morning done ${i}`, window: 'morning', status: 'done', date: dated(i + 8) }),
      ),
    ];
    const evening = Array.from({ length: 6 }, (_, i) =>
      makeTask({ title: `Evening ${i}`, window: 'evening', status: i === 0 ? 'missed' : 'done', date: dated(i + 1) }),
    );

    const state = makeState({ tasks: [...morning, ...evening] });
    const patterns = detectBehaviourPatterns(state, TODAY);
    const morningPattern = patterns.find((p) => p.kind === 'morning-failure');

    expect(morningPattern).toBeDefined();
    expect(morningPattern?.recommendation).toMatch(/moved to your historically stronger study window/i);
    expect(morningPattern?.recommendation).not.toMatch(/wake up|discipline|try harder/i);
    expect(preferredWindow(state, TODAY)).toBe('evening');
  });

  it('investigates repeatedly postponed work instead of rescheduling it forever', () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({
        title: `Algebra practice ${i}`,
        section: 'QA',
        type: 'practice',
        status: 'postponed',
        postponeCount: 2,
        estimateMin: 90,
        date: dated(i + 2),
      }),
    );
    const patterns = detectBehaviourPatterns(makeState({ tasks }), TODAY);
    const postpone = patterns.find((p) => p.kind === 'repeated-postpone');

    expect(postpone).toBeDefined();
    expect(postpone?.detail).toMatch(/postponement/i);
    expect(postpone?.recommendation.length).toBeGreaterThan(20);
  });

  it('reports when sessions consistently run long and says what it changed', () => {
    const tasks = completedTasks(6, 60, 90, { type: 'practice', section: 'QA', window: 'evening' }).map((t) => ({
      ...t,
      date: dated(3),
    }));
    const patterns = detectBehaviourPatterns(makeState({ tasks }), TODAY);
    const drift = patterns.find((p) => p.kind === 'underestimation');

    expect(drift).toBeDefined();
    expect(drift?.title).toMatch(/longer than estimated/i);
    expect(drift?.recommendation).toMatch(/sized upward gradually/i);
  });

  it('recognises that capacity estimates were too high across weeks', () => {
    const state = makeState({
      capacityRecords: [
        { id: 'c1', createdAt: '', updatedAt: '', weekStart: '2026-08-10', plannedMin: 1080, capacityMin: 1100, actualMin: 600 },
        { id: 'c2', createdAt: '', updatedAt: '', weekStart: '2026-08-17', plannedMin: 1080, capacityMin: 1100, actualMin: 620 },
        { id: 'c3', createdAt: '', updatedAt: '', weekStart: '2026-08-24', plannedMin: 1080, capacityMin: 1100, actualMin: 660 },
      ],
    });
    const drift = detectBehaviourPatterns(state, TODAY).find((p) => p.id === 'capacity-drift-low');
    expect(drift).toBeDefined();
    expect(drift?.recommendation).toMatch(/demonstrated capacity/i);
  });

  it('recognises rising completion as conservative estimating', () => {
    const state = makeState({
      capacityRecords: [
        { id: 'c1', createdAt: '', updatedAt: '', weekStart: '2026-08-10', plannedMin: 1000, capacityMin: 1000, actualMin: 850 },
        { id: 'c2', createdAt: '', updatedAt: '', weekStart: '2026-08-17', plannedMin: 1000, capacityMin: 1000, actualMin: 1000 },
        { id: 'c3', createdAt: '', updatedAt: '', weekStart: '2026-08-24', plannedMin: 1000, capacityMin: 1000, actualMin: 1050 },
      ],
    });
    const drift = detectBehaviourPatterns(state, TODAY).find((p) => p.id === 'capacity-drift-high');
    expect(drift).toBeDefined();
    expect(drift?.recommendation).toMatch(/buffer preserved/i);
  });

  it('stays silent when there is not enough evidence', () => {
    const patterns = detectBehaviourPatterns(makeState({ tasks: [makeTask({ status: 'missed' })] }), TODAY);
    expect(patterns.filter((p) => p.kind === 'morning-failure')).toHaveLength(0);
  });
});
