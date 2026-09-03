import { describe, expect, it } from 'vitest';
import { applyMissedDecision, handleMissedTask } from '../missedTask';
import { makeState, makeTask, TODAY, WEEK_START } from './fixtures';

const missed = (over = {}) => makeTask({ status: 'missed', needsDecision: true, ...over });

describe('handleMissedTask', () => {
  it('removes low-value optional work instead of carrying it forward', () => {
    const task = missed({ importance: 'optional', impact: 1, type: 'personal' });
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);

    expect(decision.kind).toBe('REMOVE');
    expect(decision.reason).toMatch(/task debt|low-impact|Carrying it forward/i);
  });

  it('reschedules work that genuinely blocks something downstream', () => {
    const blocker = missed({ title: 'Learn algebra basics', importance: 'important', estimateMin: 45 });
    const dependent = makeTask({ title: 'Algebra sectional', dependsOn: [blocker.id], date: '2026-09-05' });
    const decision = handleMissedTask(blocker, makeState({ tasks: [blocker, dependent] }), TODAY);

    expect(decision.kind).toBe('RESCHEDULE');
    expect(decision.reason).toMatch(/downstream/i);
    expect(decision.newDate).toBeTruthy();
  });

  it('reschedules deadline-critical work', () => {
    const task = missed({ deadline: '2026-09-04', importance: 'important' });
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);
    expect(decision.kind).toBe('RESCHEDULE');
  });

  it('shortens foundational work when the week is over capacity', () => {
    const task = missed({ title: '90-minute QA session', estimateMin: 90, importance: 'critical', section: 'QA' });
    // Fill the rest of the week well past capacity.
    const filler = Array.from({ length: 8 }, (_, i) =>
      makeTask({ title: `Filler ${i}`, estimateMin: 180, date: i % 2 === 0 ? '2026-09-04' : '2026-09-05', locked: true }),
    );
    const decision = handleMissedTask(task, makeState({ tasks: [task, ...filler] }), TODAY);

    expect(decision.kind).toBe('SHORTEN');
    expect(decision.newEstimateMin).toBeLessThan(90);
    expect(decision.verdict).toBe('over capacity');
    expect(decision.reason).toMatch(/Remaining workload after adjustment/);
  });

  it('replaces a task that has been postponed repeatedly rather than rescheduling it again', () => {
    const task = missed({ postponeCount: 3, importance: 'critical', type: 'study' });
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);

    expect(decision.kind).toBe('REPLACE');
    expect(decision.reason).toMatch(/too large or too vague/i);
    expect(decision.newEstimateMin).toBeLessThanOrEqual(30);
  });

  it('removes a repeatedly postponed optional task', () => {
    const task = missed({ postponeCount: 4, importance: 'optional', type: 'personal' });
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);
    expect(decision.kind).toBe('REMOVE');
  });

  it('combines with an equivalent session already scheduled', () => {
    const task = missed({ type: 'practice', section: 'QA', estimateMin: 60 });
    const twin = makeTask({ title: 'QA practice II', type: 'practice', section: 'QA', date: '2026-09-05', estimateMin: 60 });
    const filler = Array.from({ length: 5 }, (_, i) =>
      makeTask({ title: `Filler ${i}`, estimateMin: 120, date: '2026-09-04' }),
    );
    const decision = handleMissedTask(task, makeState({ tasks: [task, twin, ...filler] }), TODAY);

    expect(decision.kind).toBe('COMBINE');
    expect(decision.combineWithTaskId).toBe(twin.id);
  });

  it('always reports the workload and capacity it decided against', () => {
    const task = missed();
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);
    expect(decision.availableCapacityMin).toBeGreaterThan(0);
    expect(['manageable', 'tight', 'over capacity']).toContain(decision.verdict);
  });
});

describe('applyMissedDecision', () => {
  it('applies a shorten decision to the task list without touching anything else', () => {
    const task = makeTask({ estimateMin: 90, status: 'missed' });
    const other = makeTask({ title: 'Untouched' });
    const decision = { ...handleMissedTask(task, makeState({ tasks: [task, other] }), TODAY), kind: 'SHORTEN' as const, newEstimateMin: 45 };

    const next = applyMissedDecision([task, other], task.id, decision, TODAY);
    expect(next.find((t) => t.id === task.id)?.estimateMin).toBe(45);
    expect(next.find((t) => t.id === other.id)).toEqual(other);
  });

  it('sends postponed work to the backlog rather than to tomorrow', () => {
    const task = makeTask({ status: 'missed', date: '2026-09-02' });
    const decision = { ...handleMissedTask(task, makeState({ tasks: [task] }), TODAY), kind: 'POSTPONE' as const, newDate: null };
    const next = applyMissedDecision([task], task.id, decision, TODAY);

    const updated = next[0];
    expect(updated.status).toBe('postponed');
    expect(updated.date).toBeNull();
    expect(updated.weekStart).toBeNull();
    expect(updated.postponeCount).toBe(1);
  });

  it('clears the needs-decision flag once a decision is applied', () => {
    const task = makeTask({ status: 'missed', needsDecision: true });
    const decision = { ...handleMissedTask(task, makeState({ tasks: [task] }), TODAY), kind: 'REMOVE' as const };
    const next = applyMissedDecision([task], task.id, decision, TODAY);
    expect(next[0].needsDecision).toBe(false);
    expect(next[0].status).toBe('removed');
  });
});

describe('no automatic carry-forward', () => {
  it('never produces a decision that silently moves a task to the next day without reasoning', () => {
    const task = makeTask({ status: 'missed', date: '2026-09-02', weekStart: WEEK_START });
    const decision = handleMissedTask(task, makeState({ tasks: [task] }), TODAY);
    expect(decision.reason.length).toBeGreaterThan(30);
  });
});
