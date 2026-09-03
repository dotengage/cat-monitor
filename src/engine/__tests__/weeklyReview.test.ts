import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import type { ReviewAnswers, Task } from '../../domain/types';
import { generateWeek } from '../generateWeek';
import { assessCapacityReality, generateWeeklyReview } from '../weeklyReview';
import { makeCommitment, makeMock, makeState, makeTask, TODAY } from './fixtures';

const LAST_WEEK = '2026-08-24'; // Monday
const LAST_WEEK_DAYS = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'];

const answers: ReviewAnswers = {
  completedNote: '',
  missedNote: '',
  realityNote: 'Two unexpected meetings and one social event.',
  energy: 3,
  actualFocusedHours: 11,
  friction: 'QA sessions took longer than expected.',
  wins: '',
};

/** Week 1 of the "most important product test": 18h planned, 11h actual. */
function week1Tasks(): Task[] {
  const planned: Task[] = [];
  // 12 x 90 minutes = 18 hours planned.
  for (let i = 0; i < 12; i += 1) {
    planned.push(
      makeTask({
        title: `Session ${i}`,
        estimateMin: 90,
        date: LAST_WEEK_DAYS[i % 7],
        weekStart: LAST_WEEK,
        section: i % 3 === 0 ? 'QA' : i % 3 === 1 ? 'DILR' : 'VARC',
        status: i < 7 ? 'done' : 'missed',
        actualMin: i < 7 ? 94 : undefined,
      }),
    );
  }
  return planned;
}

describe('assessCapacityReality', () => {
  it('treats a large, repeated shortfall as a new reality and plans against it', () => {
    const state = makeState({
      tasks: week1Tasks(),
      capacityRecords: [
        { id: 'c1', createdAt: '', updatedAt: '', weekStart: '2026-08-17', plannedMin: 1080, capacityMin: 1100, actualMin: 660 },
      ],
    });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);

    expect(reality.kind).toBe('new-reality');
    // Roughly what was actually achieved, not the original 18 hours.
    expect(reality.targetPlannedMin).toBeLessThan(18 * 60 * 0.8);
    expect(reality.targetPlannedMin).toBeGreaterThanOrEqual(reality.demonstratedMin);
    expect(reality.explanation).toMatch(/original estimate was inaccurate/i);
  });

  it('restores normal capacity when the shortfall was a one-off disruption', () => {
    const state = makeState({
      tasks: week1Tasks(),
      commitments: [
        makeCommitment({ type: 'travel', title: 'Wedding travel', startDate: '2026-08-27', endDate: '2026-08-30', hoursPerDay: 6 }),
      ],
    });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);

    expect(reality.kind).toBe('temporary-disruption');
    expect(reality.targetPlannedMin).toBe(reality.modelledMin);
    expect(reality.explanation).toMatch(/does not repeat next week/i);
  });

  it('increases planned volume gradually when weeks are consistently completed', () => {
    const tasks = LAST_WEEK_DAYS.flatMap((date) =>
      Array.from({ length: 2 }, (_, i) =>
        makeTask({ title: `Done ${date}-${i}`, date, weekStart: LAST_WEEK, status: 'done', estimateMin: 60, actualMin: 60 }),
      ),
    );
    const state = makeState({
      tasks,
      capacityRecords: [
        { id: 'c1', createdAt: '', updatedAt: '', weekStart: '2026-08-17', plannedMin: 800, capacityMin: 900, actualMin: 790 },
      ],
    });
    const reality = assessCapacityReality(state, LAST_WEEK, TODAY);
    expect(reality.kind).toBe('improving');
    expect(reality.targetPlannedMin).toBeGreaterThan(reality.modelledMin);
  });
});

describe('generateWeeklyReview', () => {
  const state = makeState({
    tasks: week1Tasks(),
    mocks: [makeMock({ date: '2026-08-29', overallPercentile: 82, analysed: false })],
  });
  const output = generateWeeklyReview(state, LAST_WEEK, TODAY, answers);

  it('produces the full review structure', () => {
    expect(output.completed.length).toBeGreaterThan(0);
    expect(output.missed.length).toBeGreaterThan(0);
    expect(output.planVsReality.plannedMin).toBe(12 * 90);
    expect(output.planVsReality.actualMin).toBe(11 * 60);
    expect(output.goalStatus.length).toBeGreaterThan(0);
    expect(output.recalculatedWorkload.remainingMin).toBeGreaterThan(0);
    expect(output.whatChanged.length).toBeGreaterThan(0);
    expect(output.nextWeek.outcomes.length).toBeGreaterThan(0);
    expect(output.risks.length).toBeGreaterThan(0);
    expect(output.singleFocus.length).toBeGreaterThan(10);
  });

  it('does not simply demand the missed hours back next week', () => {
    expect(output.nextWeek.revisedPlannedMin).toBeLessThan(18 * 60);
    expect(output.nextWeek.revisedPlannedMin).toBeLessThan(output.planVsReality.plannedMin);
  });

  it('names mock analysis as the single most important focus when a mock is unanalysed', () => {
    expect(output.singleFocus).toMatch(/analyse/i);
  });

  it('explains overruns as inaccurate estimates, not personal failure', () => {
    const text = [...output.whatChanged, ...output.planVsReality.notes].join(' ');
    expect(text).not.toMatch(/you failed|lazy|discipline/i);
  });

  it('carries forward only what is genuinely necessary', () => {
    const nextWeekStart = addDays(LAST_WEEK, 7);
    const preview = generateWeek(state, nextWeekStart, TODAY, { targetPlannedMin: 660 });
    expect(preview.plannedMin).toBeLessThanOrEqual(660 * 1.06);
  });
});
