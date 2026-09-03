/**
 * Weekly review.
 *
 * The review is not a report - it is the input to next week's plan. It works
 * out what actually happened, distinguishes a temporary disruption from a new
 * reality, and hands the planner a capacity target grounded in evidence.
 */
import { addDays, endOfWeek, formatHours, formatMinutes } from '../domain/date';
import type {
  AppState,
  ISODate,
  ReviewAnswers,
  Task,
  WeeklyReviewOutput,
} from '../domain/types';
import { calculateWeekCapacity } from './capacity';
import { detectConflicts } from './conflicts';
import { clamp, isOpen } from './derive';
import { generateWeek } from './generateWeek';
import { calculateAllGoalStatuses } from './goalStatus';
import { detectBehaviourPatterns } from './patterns';
import { calculateFeasibility, projectRemainingWorkload } from './workload';

export interface CapacityReality {
  kind: 'stable' | 'temporary-disruption' | 'new-reality' | 'improving';
  targetPlannedMin: number;
  demonstratedMin: number;
  modelledMin: number;
  explanation: string;
}

/**
 * Distinguishes "this week was disrupted" from "my capacity is genuinely
 * lower than I thought". A one-off travel block should not permanently shrink
 * the plan; three consistent weeks should.
 */
export function assessCapacityReality(state: AppState, weekStart: ISODate, today: ISODate): CapacityReality {
  const weekEnd = endOfWeek(weekStart, state.settings.weekStartsOn);
  const nextStart = addDays(weekEnd, 1);
  const modelled = calculateWeekCapacity(state, nextStart, today).plannedMin;

  const weekTasks = state.tasks.filter((t) => t.date !== null && t.date >= weekStart && t.date <= weekEnd);
  const actualMin =
    weekTasks
      .filter((t) => t.status === 'done' || t.status === 'partial')
      .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0) ||
    state.dayLogs
      .filter((d) => d.date >= weekStart && d.date <= weekEnd)
      .reduce((a, d) => a + d.focusedMin, 0);

  const plannedMin = weekTasks.reduce((a, t) => a + t.estimateMin, 0);
  const ratio = plannedMin > 0 ? actualMin / plannedMin : 1;

  // Was the shortfall explained by commitments that no longer apply next week?
  const disruptiveTypes = ['travel', 'exam', 'unexpected', 'family'];
  const hadDisruption = state.commitments.some(
    (c) =>
      disruptiveTypes.includes(c.type) &&
      c.startDate <= weekEnd &&
      c.endDate >= weekStart &&
      !(c.startDate <= addDays(nextStart, 6) && c.endDate >= nextStart),
  );

  const priorRecords = [...state.capacityRecords]
    .filter((r) => r.weekStart < weekStart && r.plannedMin > 0)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, 2);
  const priorRatios = priorRecords.map((r) => r.actualMin / r.plannedMin);
  const consistentlyLow = priorRatios.length >= 1 && priorRatios.every((r) => r < 0.8) && ratio < 0.8;

  if (ratio >= 0.95 && priorRatios.every((r) => r >= 0.9)) {
    const target = Math.round(modelled * 1.1);
    return {
      kind: 'improving',
      targetPlannedMin: target,
      demonstratedMin: actualMin,
      modelledMin: modelled,
      explanation: `You completed ${Math.round(ratio * 100)}% of planned volume, and previous weeks were similar. Planned volume increases by about 10%, with buffer preserved.`,
    };
  }

  if (ratio < 0.8 && hadDisruption && !consistentlyLow) {
    return {
      kind: 'temporary-disruption',
      targetPlannedMin: modelled,
      demonstratedMin: actualMin,
      modelledMin: modelled,
      explanation: `The shortfall lines up with a commitment that does not repeat next week, so this reads as a temporary disruption rather than a lower baseline. Normal capacity is restored.`,
    };
  }

  if (consistentlyLow || ratio < 0.65) {
    const target = Math.round(clamp(actualMin * 1.05, modelled * 0.5, modelled));
    return {
      kind: 'new-reality',
      targetPlannedMin: target,
      demonstratedMin: actualMin,
      modelledMin: modelled,
      explanation: `Actual output was ${formatHours(actualMin, 1)} against ${formatHours(plannedMin, 1)} planned${
        consistentlyLow ? ', and previous weeks show the same gap' : ''
      }. The original estimate was inaccurate, so next week is planned against demonstrated capacity (${formatHours(target, 1)}) rather than the aspiration.`,
    };
  }

  return {
    kind: 'stable',
    targetPlannedMin: modelled,
    demonstratedMin: actualMin,
    modelledMin: modelled,
    explanation: `Output tracked the plan closely enough (${Math.round(ratio * 100)}%). Capacity assumptions stay as they are.`,
  };
}

export function generateWeeklyReview(
  state: AppState,
  weekStart: ISODate,
  today: ISODate,
  answers: ReviewAnswers,
): WeeklyReviewOutput {
  const weekEnd = endOfWeek(weekStart, state.settings.weekStartsOn);
  const week = state.weeks.find((w) => w.startDate === weekStart);
  const weekTasks = state.tasks.filter((t) => t.date !== null && t.date >= weekStart && t.date <= weekEnd);
  const doneTasks = weekTasks.filter((t) => t.status === 'done');
  const partialTasks = weekTasks.filter((t) => t.status === 'partial');
  const missedTasks = weekTasks.filter((t) => t.status === 'missed' || t.status === 'postponed');
  const removedTasks = state.tasks.filter(
    (t) => t.status === 'removed' && t.updatedAt.slice(0, 10) >= weekStart && t.updatedAt.slice(0, 10) <= weekEnd,
  );

  const capacity = calculateWeekCapacity(state, weekStart, weekStart);
  const plannedMin = weekTasks.reduce((a, t) => a + t.estimateMin, 0);
  const loggedMin = [...doneTasks, ...partialTasks].reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);
  const dayLogMin = state.dayLogs
    .filter((d) => d.date >= weekStart && d.date <= weekEnd)
    .reduce((a, d) => a + d.focusedMin, 0);
  const actualMin = answers.actualFocusedHours > 0 ? Math.round(answers.actualFocusedHours * 60) : dayLogMin || loggedMin;

  const decisionsThisWeek = state.decisions.filter((d) => d.date >= weekStart && d.date <= weekEnd);
  const reasonFor = (task: Task) =>
    decisionsThisWeek.find((d) => d.subjectId === task.id)?.reason ?? 'No reason recorded.';

  /* --- Plan vs reality notes ---------------------------------------- */
  const notes: string[] = [];
  const overruns = [...doneTasks, ...partialTasks].filter((t) => (t.actualMin ?? 0) > t.estimateMin * 1.2);
  const underruns = doneTasks.filter((t) => (t.actualMin ?? t.estimateMin) < t.estimateMin * 0.8);
  if (overruns.length > 0) {
    notes.push(
      `${overruns.length} task(s) took materially longer than estimated, notably "${overruns[0].title}" (${formatMinutes(
        overruns[0].actualMin ?? 0,
      )} against ${formatMinutes(overruns[0].estimateMin)}).`,
    );
  }
  if (underruns.length > 0) {
    notes.push(`${underruns.length} task(s) finished faster than estimated; the freed capacity is available for high-value work.`);
  }
  if (plannedMin > capacity.plannedMin) {
    notes.push(
      `The week was planned at ${formatHours(plannedMin, 1)} against ${formatHours(capacity.plannedMin, 1)} of planned capacity - the plan was over capacity before the week began.`,
    );
  }
  const lowEnergyDays = state.dayLogs.filter((d) => d.date >= weekStart && d.date <= weekEnd && d.energy <= 2);
  if (lowEnergyDays.length > 0) notes.push(`${lowEnergyDays.length} low-energy day(s) were logged.`);
  const unexpected = state.dayLogs.filter(
    (d) => d.date >= weekStart && d.date <= weekEnd && d.unexpectedCommitments.trim().length > 0,
  );
  if (unexpected.length > 0) {
    notes.push(`Unexpected commitments on ${unexpected.length} day(s): ${unexpected.map((d) => d.unexpectedCommitments).join('; ')}.`);
  }
  if (answers.realityNote.trim()) notes.push(answers.realityNote.trim());

  /* --- Goals, workload, next week ------------------------------------ */
  const goalStatuses = calculateAllGoalStatuses(state, today);
  const workload = projectRemainingWorkload(state, today);
  const feasibility = calculateFeasibility(state, today);
  const reality = assessCapacityReality(state, weekStart, today);
  const nextStart = addDays(weekEnd, 1);
  const preview = generateWeek(state, nextStart, today, {
    targetPlannedMin: reality.targetPlannedMin,
    generatedFrom: 'review',
  });

  /* --- What changed --------------------------------------------------- */
  const whatChanged: string[] = [reality.explanation];
  for (const pattern of detectBehaviourPatterns(state, today)) {
    whatChanged.push(`${pattern.title}: ${pattern.recommendation}`);
  }
  const removedByEngine = decisionsThisWeek.filter((d) => d.kind === 'REMOVE');
  if (removedByEngine.length > 0) {
    whatChanged.push(`${removedByEngine.length} low-value item(s) were removed rather than carried forward.`);
  }
  if (preview.notes.length > 0) whatChanged.push(...preview.notes);

  /* --- Risks ---------------------------------------------------------- */
  const risks: string[] = [];
  if (feasibility.safety.breached) risks.push(feasibility.safety.message);
  for (const conflict of detectConflicts(state, nextStart, today)) {
    if (conflict.severity !== 'info') risks.push(`${conflict.title}: ${conflict.detail}`);
  }
  if (state.mocks.some((m) => !m.analysed)) {
    risks.push(`${state.mocks.filter((m) => !m.analysed).length} mock(s) remain unanalysed. An unanalysed mock contributes very little.`);
  }
  if (risks.length === 0) risks.push('No capacity or feasibility breach detected for next week.');

  /* --- Achieved outcomes ---------------------------------------------- */
  const outcomes = week?.outcomes ?? [];
  const achievedOutcomes = outcomes.filter((o) => {
    if (o.achieved) return true;
    const linked = weekTasks.filter((t) => t.outcomeId === o.id);
    return linked.length > 0 && linked.every((t) => t.status === 'done');
  });

  const singleFocus = buildSingleFocus(state, feasibility, workload);

  return {
    weekStart,
    weekEnd,
    completed: [
      ...doneTasks.map((t) => `${t.title} (${formatMinutes(t.actualMin ?? t.estimateMin)})`),
      ...partialTasks.map((t) => `${t.title} - partially completed`),
      ...achievedOutcomes.map((o) => `Outcome achieved: ${o.title}`),
      ...(answers.completedNote.trim() ? [answers.completedNote.trim()] : []),
    ],
    missed: [
      ...missedTasks.map((t) => `${t.title} - ${reasonFor(t)}`),
      ...(answers.missedNote.trim() ? [answers.missedNote.trim()] : []),
    ],
    planVsReality: {
      plannedMin,
      actualMin,
      plannedTasks: weekTasks.length,
      completedTasks: doneTasks.length,
      plannedOutcomes: outcomes.length,
      achievedOutcomes: achievedOutcomes.length,
      estimatedMin: plannedMin,
      loggedMin,
      expectedCapacityMin: capacity.plannedMin,
      actualCapacityMin: actualMin,
      notes,
    },
    goalStatus: goalStatuses.map((g) => ({ goalId: g.goalId, title: g.title, status: g.status, reason: g.reason })),
    recalculatedWorkload: workload,
    whatChanged,
    nextWeek: {
      priorities: preview.tasks
        .filter((t) => t.importance === 'critical')
        .slice(0, 5)
        .map((t) => t.title),
      outcomes: preview.week.outcomes.map((o) => `${o.title} - ${o.metric}`),
      revisedPlannedMin: preview.plannedMin,
    },
    removed: removedTasks.map((t) => `${t.title} - ${reasonFor(t)}`),
    deprioritised: state.tasks
      .filter((t) => t.status === 'postponed' && isOpen(t))
      .map((t) => `${t.title} (postponed ${t.postponeCount}x)`),
    risks,
    singleFocus,
  };
}

function buildSingleFocus(
  state: AppState,
  feasibility: ReturnType<typeof calculateFeasibility>,
  workload: ReturnType<typeof projectRemainingWorkload>,
): string {
  if (state.mocks.length === 0) {
    return 'Take and analyse one full mock. Nothing else in the system can be calibrated until a baseline exists.';
  }
  const unanalysed = state.mocks.filter((m) => !m.analysed).length;
  if (unanalysed > 0) {
    return `Analyse the ${unanalysed} outstanding mock(s). Mock volume without analysis does not move percentile.`;
  }
  if (workload.health === 'UNSUSTAINABLE') {
    return 'Cut scope. The remaining workload does not fit the remaining capacity, and no amount of scheduling fixes that.';
  }
  if (feasibility.status === 'BEHIND' && feasibility.workload.remainingMin > 0) {
    return `Concentrate everything on ${feasibility.inputs.find((i) => i.label === 'Main constraint')?.value ?? 'the weakest section'}. Breadth is no longer affordable.`;
  }
  return feasibility.nextAction;
}
