import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { calculateWeekCapacity } from '../capacity';
import { generateWeek } from '../generateWeek';
import { makeCommitment, makeError, makeMock, makeState, TODAY, WEEK_START } from './fixtures';

describe('generateWeek - first week without a baseline', () => {
  const state = makeState();
  const generated = generateWeek(state, WEEK_START, TODAY, { generatedFrom: 'onboarding' });

  it('produces between three and five weekly outcomes, not a task list of twenty-five', () => {
    expect(generated.week.outcomes.length).toBeGreaterThanOrEqual(3);
    expect(generated.week.outcomes.length).toBeLessThanOrEqual(5);
  });

  it('prioritises establishing a baseline', () => {
    const titles = generated.tasks.map((t) => t.title.toLowerCase());
    expect(titles.some((t) => t.includes('full-length mock'))).toBe(true);
    expect(generated.week.outcomes.map((o) => o.title)).toContain('Establish baseline performance');
  });

  it('includes capacity calibration and error tracking as first-week outcomes', () => {
    const outcomes = generated.week.outcomes.map((o) => o.title);
    expect(outcomes.some((o) => /capacity/i.test(o))).toBe(true);
    expect(outcomes.some((o) => /error/i.test(o))).toBe(true);
  });

  it('stays inside planned capacity and leaves buffer', () => {
    const capacity = calculateWeekCapacity(state, WEEK_START, TODAY);
    expect(generated.plannedMin).toBeLessThanOrEqual(capacity.plannedMin * 1.06);
    expect(generated.bufferMin).toBeGreaterThan(0);
  });

  it('never schedules work into days that have already passed', () => {
    for (const task of generated.tasks) {
      if (task.date) expect(task.date >= TODAY).toBe(true);
    }
  });

  it('writes specific, startable tasks rather than "Study QA"', () => {
    for (const task of generated.tasks) {
      expect(task.title.length).toBeGreaterThan(18);
      expect(task.title.toLowerCase()).not.toBe('study qa');
    }
  });

  it('orders dependent work after what it depends on', () => {
    const analysis = generated.tasks.find((t) => t.type === 'analysis' && t.dependsOn.length > 0);
    if (!analysis) return;
    const dep = generated.tasks.find((t) => t.id === analysis.dependsOn[0]);
    if (dep?.date && analysis.date) expect(analysis.date > dep.date).toBe(true);
  });

  it('caps the number of tasks placed on any single day', () => {
    const counts = new Map<string, number>();
    for (const t of generated.tasks) {
      if (!t.date) continue;
      counts.set(t.date, (counts.get(t.date) ?? 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBeLessThanOrEqual(state.settings.planning.maxTasksPerDay);
    }
  });
});

describe('generateWeek - with evidence', () => {
  it('front-loads mock analysis when a mock is unanalysed', () => {
    const state = makeState({ mocks: [makeMock({ analysed: false, name: 'IMS SimCAT 3' })] });
    const generated = generateWeek(state, WEEK_START, TODAY);
    expect(generated.tasks.some((t) => t.type === 'analysis' && /IMS SimCAT 3/.test(t.title))).toBe(true);
  });

  it('generates error-review work once enough errors are logged', () => {
    const errors = Array.from({ length: 8 }, (_, i) => makeError({ question: `Q${i}`, date: addDays(TODAY, -3) }));
    const state = makeState({ mocks: [makeMock()], errors });
    const generated = generateWeek(state, WEEK_START, TODAY);
    expect(generated.tasks.some((t) => t.type === 'error-review')).toBe(true);
  });

  it('reduces planned volume when travel eats the week', () => {
    const clear = generateWeek(makeState(), WEEK_START, TODAY);
    const travelling = generateWeek(
      makeState({
        commitments: [
          makeCommitment({ type: 'travel', title: 'Travel', startDate: TODAY, endDate: addDays(TODAY, 3), hoursPerDay: 3 }),
        ],
      }),
      WEEK_START,
      TODAY,
    );
    expect(travelling.plannedMin).toBeLessThan(clear.plannedMin);
  });

  it('honours an explicit capacity target from the weekly review', () => {
    const state = makeState({ mocks: [makeMock()] });
    const generated = generateWeek(state, WEEK_START, TODAY, { targetPlannedMin: 300 });
    expect(generated.plannedMin).toBeLessThanOrEqual(330);
    expect(generated.notes.join(' ')).toMatch(/scaled/i);
  });

  it('weights the plan towards the weakest section', () => {
    const state = makeState({
      mocks: [
        makeMock({
          sections: {
            VARC: { score: 40, percentile: 95, attempts: 20, correct: 16, incorrect: 4 },
            DILR: { score: 8, percentile: 40, attempts: 10, correct: 3, incorrect: 7 },
            QA: { score: 38, percentile: 92, attempts: 22, correct: 16, incorrect: 6 },
          },
        }),
      ],
    });
    const generated = generateWeek(state, WEEK_START, TODAY);
    const dilrMin = generated.tasks.filter((t) => t.section === 'DILR').reduce((a, t) => a + t.estimateMin, 0);
    const varcMin = generated.tasks.filter((t) => t.section === 'VARC').reduce((a, t) => a + t.estimateMin, 0);
    expect(dilrMin).toBeGreaterThanOrEqual(varcMin);
  });
});
