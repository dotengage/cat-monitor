import { describe, expect, it } from 'vitest';
import { buildPriorityContext, buildTodayPlan, calculateTaskPriority, rankTasks } from '../priority';
import { makePractice, makeState, makeTask, TODAY } from './fixtures';

describe('calculateTaskPriority', () => {
  it('lets a short high-value task outrank a long low-value one', () => {
    const short = makeTask({
      title: '20 minute error review',
      estimateMin: 20,
      impact: 5,
      importance: 'critical',
      type: 'error-review',
      section: 'DILR',
    });
    const long = makeTask({
      title: '2 hour optional reading',
      estimateMin: 120,
      impact: 2,
      importance: 'optional',
      type: 'personal',
    });
    const state = makeState({ tasks: [short, long] });
    const ctx = buildPriorityContext(state, TODAY);

    expect(calculateTaskPriority(short, ctx).score).toBeGreaterThan(calculateTaskPriority(long, ctx).score);
  });

  it('does not sort purely by due date', () => {
    const dueTomorrowLowValue = makeTask({
      title: 'Optional admin',
      deadline: '2026-09-04',
      importance: 'optional',
      impact: 1,
      type: 'admin',
      estimateMin: 90,
    });
    const noDeadlineHighValue = makeTask({
      title: 'Mock analysis',
      importance: 'critical',
      impact: 5,
      type: 'analysis',
      estimateMin: 60,
    });
    const state = makeState({ tasks: [dueTomorrowLowValue, noDeadlineHighValue] });
    const ranked = rankTasks(state.tasks, buildPriorityContext(state, TODAY));
    expect(ranked[0].task.title).toBe('Mock analysis');
  });

  it('penalises work that needs more energy than the day has', () => {
    const hard = makeTask({ energyRequired: 5 });
    const state = makeState({ tasks: [hard] });
    const lowEnergy = buildPriorityContext(state, TODAY, 1);
    const highEnergy = buildPriorityContext(state, TODAY, 5);

    expect(calculateTaskPriority(hard, lowEnergy).components.energyFit).toBe(0);
    expect(calculateTaskPriority(hard, highEnergy).components.energyFit).toBe(8);
  });

  it('weights the weakest section higher', () => {
    const state = makeState({
      practice: [
        makePractice({ section: 'QA', attempted: 60, correct: 55, timeMin: 60 }),
        makePractice({ section: 'QA', attempted: 60, correct: 54, timeMin: 60 }),
      ],
    });
    state.topics = state.topics.map((t) => (t.section === 'QA' ? { ...t, status: 'strong' as const } : t));

    const ctx = buildPriorityContext(state, TODAY);
    expect(ctx.weakness.DILR).toBeGreaterThan(ctx.weakness.QA);
  });
});

describe('buildTodayPlan', () => {
  it('keeps the day small: at most two must-do, two should-do and one optional', () => {
    const tasks = Array.from({ length: 9 }, (_, i) =>
      makeTask({ title: `Task ${i}`, estimateMin: 20, importance: i < 3 ? 'critical' : 'important' }),
    );
    const state = makeState({ tasks });
    const plan = buildTodayPlan(state, TODAY, 135);

    expect(plan.mustDo.length).toBeLessThanOrEqual(2);
    expect(plan.shouldDo.length).toBeLessThanOrEqual(2);
    expect(plan.optional.length).toBeLessThanOrEqual(1);
  });

  it('offers lower-friction alternatives on a low-energy day', () => {
    const heavy = makeTask({ title: 'Full mock', energyRequired: 5, date: TODAY });
    const light = makeTask({ title: 'Revise formulas', energyRequired: 1, date: null, status: 'postponed' });
    const state = makeState({ tasks: [heavy, light] });
    const plan = buildTodayPlan(state, TODAY, 135, 1);

    expect(plan.energyMode).toBe('VERY_LOW');
    expect(plan.alternatives.map((t) => t.title)).toContain('Revise formulas');
    expect(plan.note).toContain('Low-energy mode');
  });

  it('reports unallocated buffer rather than filling the day', () => {
    const state = makeState({ tasks: [makeTask({ estimateMin: 30 })] });
    const plan = buildTodayPlan(state, TODAY, 135);
    expect(plan.bufferMin).toBe(105);
  });
});
