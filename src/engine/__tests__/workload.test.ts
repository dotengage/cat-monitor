import { describe, expect, it } from 'vitest';
import { calculateFeasibility, criticalSafetyCheck, projectRemainingWorkload } from '../workload';
import { makeMock, makeState, makeTask, TODAY } from './fixtures';

describe('projectRemainingWorkload', () => {
  it('projects work beyond the tasks already written down', () => {
    const workload = projectRemainingWorkload(makeState(), TODAY);
    const labels = workload.breakdown.map((b) => b.label);

    expect(workload.remainingMin).toBeGreaterThan(0);
    expect(labels).toContain('Topic coverage still owed');
    expect(labels).toContain('Mocks + analysis');
    expect(workload.requiredPerWeekMin).toBeGreaterThan(0);
    expect(workload.realisticPerWeekMin).toBeGreaterThan(0);
  });

  it('drops covered topics out of the remaining workload', () => {
    const base = makeState();
    const covered = makeState();
    covered.topics = covered.topics.map((t) => ({ ...t, status: 'strong' as const }));

    const before = projectRemainingWorkload(base, TODAY);
    const after = projectRemainingWorkload(covered, TODAY);
    expect(after.breakdown.find((b) => b.label === 'Topic coverage still owed')).toBeUndefined();
    expect(after.remainingMin).toBeLessThan(before.remainingMin);
  });

  it('counts unanalysed mocks as outstanding debt', () => {
    const state = makeState({ mocks: [makeMock({ analysed: false })] });
    const workload = projectRemainingWorkload(state, TODAY);
    expect(workload.breakdown.some((b) => b.label === 'Mock analysis backlog')).toBe(true);
  });

  it('classifies workload health from required against realistic pace', () => {
    const tight = makeState();
    tight.profile.weekdayHours = { min: 0.25, normal: 0.5, max: 1 };
    tight.profile.weekendHours = { min: 0.5, normal: 1, max: 2 };
    expect(projectRemainingWorkload(tight, TODAY).health).toBe('UNSUSTAINABLE');

    const roomy = makeState();
    roomy.profile.weekdayHours = { min: 4, normal: 8, max: 10 };
    roomy.profile.weekendHours = { min: 6, normal: 10, max: 12 };
    expect(['COMFORTABLE', 'TIGHT']).toContain(projectRemainingWorkload(roomy, TODAY).health);
  });
});

describe('criticalSafetyCheck', () => {
  it('states the shortfall directly when work exceeds capacity', () => {
    const state = makeState();
    state.profile.weekdayHours = { min: 0.25, normal: 0.5, max: 1 };
    state.profile.weekendHours = { min: 0.5, normal: 1, max: 2 };

    const check = criticalSafetyCheck(state, TODAY);
    expect(check.breached).toBe(true);
    expect(check.message).toMatch(/requires approximately \d+ focused hours/);
    expect(check.message).toMatch(/only about \d+ hours are realistically available/);
    expect(check.suggestions.length).toBeGreaterThan(2);
  });

  it('confirms the plan reconciles when there is room', () => {
    const state = makeState();
    state.profile.weekdayHours = { min: 4, normal: 8, max: 10 };
    state.profile.weekendHours = { min: 6, normal: 10, max: 12 };
    const check = criticalSafetyCheck(state, TODAY);
    expect(check.breached).toBe(false);
    expect(check.message).toMatch(/reconciles/);
  });
});

describe('calculateFeasibility', () => {
  it('stays UNCONFIRMED until a baseline exists', () => {
    const feasibility = calculateFeasibility(makeState(), TODAY);
    expect(feasibility.status).toBe('UNCONFIRMED');
    expect(feasibility.headline).toBe('Target feasibility: UNCONFIRMED');
  });

  it('downgrades an on-track trajectory when the workload cannot fit', () => {
    const state = makeState({
      mocks: [
        makeMock({ date: '2026-08-10', overallPercentile: 90 }),
        makeMock({ date: '2026-08-17', overallPercentile: 94 }),
        makeMock({ date: '2026-08-24', overallPercentile: 97 }),
      ],
    });
    state.profile.weekdayHours = { min: 0.25, normal: 0.5, max: 1 };
    state.profile.weekendHours = { min: 0.5, normal: 1, max: 2 };

    const feasibility = calculateFeasibility(state, TODAY);
    expect(feasibility.status).not.toBe('ON_TRACK');
    expect(feasibility.reason).toMatch(/does not fit the remaining capacity|exceeds realistic capacity/);
  });

  it('lists the evidence it used without inventing a probability', () => {
    const feasibility = calculateFeasibility(makeState({ mocks: [makeMock()] }), TODAY);
    const labels = feasibility.inputs.map((i) => i.label);

    expect(labels).toContain('Days remaining');
    expect(labels).toContain('Mocks recorded');
    expect(labels).toContain('Workload health');
    expect(feasibility.headline).not.toMatch(/%/);
  });

  it('adds a task backlog to the remaining workload', () => {
    const withBacklog = makeState({
      tasks: [makeTask({ date: null, status: 'postponed', estimateMin: 240 })],
    });
    const before = projectRemainingWorkload(makeState(), TODAY).remainingMin;
    const after = projectRemainingWorkload(withBacklog, TODAY).remainingMin;
    expect(after).toBe(before + 240);
  });
});
