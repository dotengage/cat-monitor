/**
 * End-to-end planning scenarios.
 *
 * These are the behavioural guarantees the product exists to make, expressed
 * as tests: a bad week must not destroy the next one, travel must not create a
 * backlog, and no amount of scheduling is allowed to pretend that more work
 * fits than there is time for.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import type { Task } from '../../domain/types';
import { calculateWeekCapacity, capacityBetween } from '../capacity';
import { generateWeek } from '../generateWeek';
import { handleMissedTask } from '../missedTask';
import { detectBehaviourPatterns } from '../patterns';
import { calculateTrajectory } from '../readiness';
import { rebalanceWeek } from '../rebalance';
import { assessCapacityReality } from '../weeklyReview';
import { calculateFeasibility, projectRemainingWorkload } from '../workload';
import { makeCommitment, makeMock, makeState, makeTask, TODAY, WEEK_START } from './fixtures';

const LAST_WEEK = '2026-08-24';
const LAST_WEEK_DAYS = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'];

function week(planned: number, completedRatio: number, over: Partial<Task> = {}): Task[] {
  const count = Math.round(planned / 90);
  const done = Math.round(count * completedRatio);
  return Array.from({ length: count }, (_, i) =>
    makeTask({
      title: `Session ${i}`,
      estimateMin: 90,
      date: LAST_WEEK_DAYS[i % 7],
      weekStart: LAST_WEEK,
      status: i < done ? 'done' : 'missed',
      actualMin: i < done ? 90 : undefined,
      ...over,
    }),
  );
}

describe('Scenario 1: everything completed', () => {
  it('lets the next week progress normally', () => {
    const state = makeState({ tasks: week(1080, 1) });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);
    expect(['improving', 'stable']).toContain(reality.kind);
    expect(reality.targetPlannedMin).toBeGreaterThanOrEqual(reality.modelledMin);
  });
});

describe('Scenario 2: only half the week completed', () => {
  it('rebalances rather than doubling next week', () => {
    const state = makeState({ tasks: week(1080, 0.5) });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);
    const generated = generateWeek(state, addDays(LAST_WEEK, 7), TODAY, { targetPlannedMin: reality.targetPlannedMin });

    expect(generated.plannedMin).toBeLessThan(1080);
    // The missed 9 hours are not simply added on top.
    expect(generated.plannedMin).toBeLessThan(1080 + 540);
  });
});

describe('Scenario 3: travel reduces capacity', () => {
  it('reduces the planned workload instead of ignoring the disruption', () => {
    const clearWeek = calculateWeekCapacity(makeState(), WEEK_START, TODAY);
    const travelState = makeState({
      commitments: [
        makeCommitment({ type: 'travel', title: 'Travel', startDate: TODAY, endDate: addDays(TODAY, 3), hoursPerDay: 3 }),
      ],
    });
    const travelWeek = calculateWeekCapacity(travelState, WEEK_START, TODAY);
    const generated = generateWeek(travelState, WEEK_START, TODAY);

    expect(travelWeek.plannedMin).toBeLessThan(clearWeek.plannedMin);
    expect(generated.plannedMin).toBeLessThanOrEqual(travelWeek.plannedMin * 1.06);
  });

  it('protects P1 CAT work and does not build a backlog for the return', () => {
    const criticalTask = makeTask({ title: 'Analyse mock', importance: 'critical', impact: 5, type: 'analysis', estimateMin: 60, date: TODAY });
    const optionalTask = makeTask({ title: 'Optional reading', importance: 'optional', impact: 1, type: 'personal', estimateMin: 90, date: TODAY });
    const state = makeState({
      tasks: [criticalTask, optionalTask],
      commitments: [makeCommitment({ type: 'travel', startDate: TODAY, endDate: addDays(TODAY, 3), hoursPerDay: 2.5 })],
    });

    const result = rebalanceWeek(state, WEEK_START, TODAY);
    const critical = result.tasks.find((t) => t.id === criticalTask.id)!;
    const optional = result.tasks.find((t) => t.id === optionalTask.id)!;

    expect(critical.status).not.toBe('removed');
    expect(['removed', 'postponed', 'planned']).toContain(optional.status);
    // Whatever happened, nothing was silently stacked onto a single day.
    expect(result.after.overloadedDays).toHaveLength(0);
  });
});

describe('Scenario 4 & 5: missed work is judged, not carried', () => {
  it('evaluates dependency and deadline for important work', () => {
    const blocker = makeTask({ title: 'Learn algebra basics', status: 'missed', importance: 'critical' });
    const dependent = makeTask({ title: 'Algebra sectional', dependsOn: [blocker.id], date: addDays(TODAY, 2) });
    const decision = handleMissedTask(blocker, makeState({ tasks: [blocker, dependent] }), TODAY);
    expect(['RESCHEDULE', 'SHORTEN']).toContain(decision.kind);
  });

  it('removes low-priority missed work', () => {
    const task = makeTask({ status: 'missed', importance: 'optional', impact: 1, type: 'personal' });
    expect(handleMissedTask(task, makeState({ tasks: [task] }), TODAY).kind).toBe('REMOVE');
  });
});

describe('Scenario 6 & 7: estimates follow reality', () => {
  it('flags consistent overruns and consistent early finishes', () => {
    const slow = makeState({
      tasks: Array.from({ length: 6 }, (_, i) =>
        makeTask({ status: 'done', estimateMin: 60, actualMin: 95, type: 'practice', section: 'QA', date: addDays(TODAY, -(i + 2)) }),
      ),
    });
    const fast = makeState({
      tasks: Array.from({ length: 6 }, (_, i) =>
        makeTask({ status: 'done', estimateMin: 60, actualMin: 38, type: 'practice', section: 'QA', date: addDays(TODAY, -(i + 2)) }),
      ),
    });

    expect(detectBehaviourPatterns(slow, TODAY).some((p) => p.kind === 'underestimation')).toBe(true);
    expect(detectBehaviourPatterns(fast, TODAY).some((p) => p.kind === 'fast-completion' || p.kind === 'overestimation')).toBe(true);
  });
});

describe('Scenario 8: repeated morning failures', () => {
  it('moves important work to the stronger window', () => {
    const tasks = [
      ...Array.from({ length: 8 }, (_, i) =>
        makeTask({ window: 'morning', status: i < 6 ? 'missed' : 'done', date: addDays(TODAY, -(i + 1)) }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        makeTask({ window: 'evening', status: i === 0 ? 'missed' : 'done', date: addDays(TODAY, -(i + 1)) }),
      ),
    ];
    const pattern = detectBehaviourPatterns(makeState({ tasks }), TODAY).find((p) => p.kind === 'morning-failure');
    expect(pattern?.data?.bestWindow).toBe('evening');
  });
});

describe('Scenario 9: remaining work exceeds capacity', () => {
  it('flags the target as at risk and cuts lower-value work', () => {
    const state = makeState({ mocks: [makeMock({ overallPercentile: 70 })] });
    state.profile.weekdayHours = { min: 0.25, normal: 0.5, max: 1 };
    state.profile.weekendHours = { min: 0.5, normal: 1, max: 2 };

    const feasibility = calculateFeasibility(state, TODAY);
    expect(feasibility.safety.breached).toBe(true);
    expect(['AT_RISK', 'BEHIND']).toContain(feasibility.status);
    expect(feasibility.safety.suggestions.join(' ')).toMatch(/lowest-weight topics/i);

    const withJunk = {
      ...state,
      tasks: [
        makeTask({ title: 'Optional busywork', importance: 'optional', impact: 1, estimateMin: 120, date: TODAY }),
        makeTask({ title: 'Weak-area drill', importance: 'critical', impact: 5, estimateMin: 60, date: TODAY }),
      ],
    };
    const result = rebalanceWeek(withJunk, WEEK_START, TODAY);
    const junk = result.tasks.find((t) => t.title === 'Optional busywork')!;
    expect(junk.status).not.toBe('planned');
  });

  it('never claims more capacity exists than the calendar allows', () => {
    const state = makeState();
    const workload = projectRemainingWorkload(state, TODAY);
    const available = capacityBetween(state, TODAY, state.profile.examDate, TODAY);
    expect(workload.surplusMin).toBe(Math.round(available - workload.remainingMin));
  });
});

describe('Scenario 10: rapid mock improvement', () => {
  it('shifts the recommendation from fundamentals to consistency and analysis', () => {
    const percentiles = [72, 76, 81, 87, 91, 94, 97];
    const mocks = percentiles.map((p, i) =>
      makeMock({ name: `Mock ${i + 1}`, date: addDays(TODAY, -70 + i * 7), overallPercentile: p }),
    );
    const trajectory = calculateTrajectory(makeState({ mocks }), TODAY);

    expect(trajectory.status).toBe('ON_TRACK');
    expect(trajectory.trend).toBe('IMPROVING');
    expect(trajectory.recommendedAction).toMatch(/consistency/i);
    expect(trajectory.recommendedAction).not.toMatch(/beginner|start from scratch/i);
  });
});

describe('The most important product test', () => {
  it('answers "what should week 2 look like?" without simply reallocating the missed hours', () => {
    const tasks = week(1080, 11 / 18);
    const mocks = [
      makeMock({
        date: '2026-08-29',
        overallPercentile: 82,
        analysed: false,
        sections: {
          VARC: { score: 34, percentile: 88, attempts: 20, correct: 14, incorrect: 6 },
          DILR: { score: 10, percentile: 55, attempts: 10, correct: 4, incorrect: 6 },
          QA: { score: 22, percentile: 68, attempts: 18, correct: 9, incorrect: 9 },
        },
      }),
    ];
    const state = makeState({ tasks, mocks });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);
    const generated = generateWeek(state, addDays(LAST_WEEK, 7), TODAY, {
      targetPlannedMin: reality.targetPlannedMin,
      generatedFrom: 'review',
    });

    // 1. Week 2 is planned against demonstrated capacity, not the original 18h.
    expect(generated.plannedMin).toBeLessThan(1080);

    // 2. Mock analysis debt is the first thing scheduled.
    expect(generated.tasks.some((t) => t.type === 'analysis')).toBe(true);

    // 3. The weakest sections get the weight, and VARC does not dominate.
    const min = (section: 'VARC' | 'DILR' | 'QA') =>
      generated.tasks.filter((t) => t.section === section).reduce((a, t) => a + t.estimateMin, 0);
    expect(min('DILR') + min('QA')).toBeGreaterThan(min('VARC'));

    // 4. Outcomes stay between three and five.
    expect(generated.week.outcomes.length).toBeGreaterThanOrEqual(3);
    expect(generated.week.outcomes.length).toBeLessThanOrEqual(5);

    // 5. Buffer survives.
    expect(generated.bufferMin).toBeGreaterThan(0);
  });
});
