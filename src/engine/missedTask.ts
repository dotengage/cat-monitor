/**
 * Missed-task algorithm.
 *
 * A missed task never carries forward automatically. Every miss triggers a
 * fresh decision that weighs importance, dependencies, deadline, remaining
 * workload and remaining capacity, and is allowed to conclude "this is no
 * longer worth carrying forward".
 */
import { addDays, daysBetween, endOfWeek, formatHours } from '../domain/date';
import type { AppState, ISODate, MissedTaskDecision, Task } from '../domain/types';
import { capacityBetween } from './capacity';
import { isOpen } from './derive';
import { findHostDay } from './rebalance';

export interface MissedTaskContext {
  blockedDownstream: Task[];
  deadlineDays: number;
  remainingWorkloadMin: number;
  availableCapacityMin: number;
  ratio: number;
  similarTask?: Task;
  isP1: boolean;
}

export function buildMissedTaskContext(task: Task, state: AppState, today: ISODate): MissedTaskContext {
  // Step 2: dependencies - is anything actually blocked by this?
  const horizon = addDays(today, 7);
  const blockedDownstream = state.tasks.filter(
    (t) => isOpen(t) && t.dependsOn.includes(task.id) && (t.date === null || t.date <= horizon),
  );

  // Step 3: deadline pressure.
  const deadlineDays = task.deadline ? daysBetween(today, task.deadline) : Number.POSITIVE_INFINITY;

  // Steps 4-6: remaining workload for the rest of the week vs real capacity.
  const weekEnd = endOfWeek(today, state.settings.weekStartsOn);
  const remainingWorkloadMin = state.tasks
    .filter((t) => isOpen(t) && t.id !== task.id && t.date !== null && t.date >= today && t.date <= weekEnd)
    .reduce((a, t) => a + t.estimateMin, 0);
  const availableCapacityMin = capacityBetween(state, today, weekEnd, today);
  const ratio = availableCapacityMin > 0 ? remainingWorkloadMin / availableCapacityMin : Number.POSITIVE_INFINITY;

  // Candidate for combining: same section and type, still open, this week.
  const similarTask = state.tasks.find(
    (t) =>
      t.id !== task.id &&
      isOpen(t) &&
      t.type === task.type &&
      t.section === task.section &&
      t.date !== null &&
      t.date >= today &&
      t.date <= weekEnd,
  );

  const goal = task.goalId ? state.goals.find((g) => g.id === task.goalId) : undefined;
  const isP1 = goal ? goal.priority === 'P1' : task.type !== 'personal' && task.type !== 'admin';

  return { blockedDownstream, deadlineDays, remainingWorkloadMin, availableCapacityMin, ratio, similarTask, isP1 };
}

/** A shortened, still-useful version of a task. */
export function shortenTask(task: Task): { title: string; estimateMin: number; detail: string } {
  const estimateMin = Math.max(15, Math.round((task.estimateMin * 0.5) / 5) * 5);
  switch (task.type) {
    case 'practice':
      return {
        title: `${task.title} (reduced)`,
        estimateMin,
        detail: `Cut to the highest-value half: attempt 8 targeted questions, then classify every incorrect answer in the error log.`,
      };
    case 'study':
      return {
        title: `${task.title} (reduced)`,
        estimateMin,
        detail: 'Cover the core concept and worked examples only. Skip the extended problem set; it can be recovered during revision.',
      };
    case 'mock':
      return {
        title: task.title.replace(/full mock/i, 'sectional'),
        estimateMin: Math.max(40, Math.round(task.estimateMin * 0.35)),
        detail: 'A full mock no longer fits. One timed sectional preserves the measurement without consuming the whole day.',
      };
    case 'analysis':
      return {
        title: `${task.title} (core analysis only)`,
        estimateMin,
        detail: 'Analyse only the incorrect and skipped questions, plus question-selection decisions. Skip the full solution walkthrough.',
      };
    default:
      return {
        title: `${task.title} (reduced)`,
        estimateMin,
        detail: 'Scope reduced to the part that actually moves readiness.',
      };
  }
}

function verdictFor(ratio: number): MissedTaskDecision['verdict'] {
  if (ratio <= 0.85) return 'manageable';
  if (ratio <= 1.0) return 'tight';
  return 'over capacity';
}

/**
 * The nine-step decision. Returns exactly one of RESCHEDULE / SHORTEN /
 * COMBINE / POSTPONE / DELEGATE / REPLACE / REMOVE.
 */
export function handleMissedTask(task: Task, state: AppState, today: ISODate): MissedTaskDecision {
  const ctx = buildMissedTaskContext(task, state, today);
  const weekEnd = endOfWeek(today, state.settings.weekStartsOn);
  const base = {
    taskId: task.id,
    remainingWorkloadMin: ctx.remainingWorkloadMin,
    availableCapacityMin: ctx.availableCapacityMin,
    verdict: verdictFor(ctx.ratio),
  };
  const capacityLine = `Remaining workload after adjustment: ${formatHours(ctx.remainingWorkloadMin, 1)}. Available realistic capacity: ${formatHours(ctx.availableCapacityMin, 1)}.`;

  // Step 1: low-value work is removed rather than carried.
  if (task.importance === 'optional' && (task.impact <= 2 || ctx.ratio > 0.85) && !task.locked) {
    return {
      ...base,
      kind: 'REMOVE',
      reason: `Optional and low-impact, with the rest of the week already at ${Math.round(ctx.ratio * 100)}% of capacity. Carrying it forward would create debt without moving the target. ${capacityLine}`,
    };
  }

  // Step 2/3: genuinely blocking or deadline-critical work is rescheduled first.
  if (ctx.blockedDownstream.length > 0 || ctx.deadlineDays <= 2) {
    const host = findHostDay(state, task, today, weekEnd, today);
    if (host) {
      return {
        ...base,
        kind: 'RESCHEDULE',
        newDate: host,
        reason:
          ctx.blockedDownstream.length > 0
            ? `${ctx.blockedDownstream.length} downstream task${ctx.blockedDownstream.length === 1 ? ' is' : 's are'} genuinely blocked by this, so it keeps a slot. ${capacityLine}`
            : `Deadline is within ${Math.max(0, ctx.deadlineDays)} day(s), so it keeps a slot. ${capacityLine}`,
      };
    }
    // Blocking but nothing fits: shorten it so the dependency clears.
    const short = shortenTask(task);
    return {
      ...base,
      kind: 'SHORTEN',
      newEstimateMin: short.estimateMin,
      replacementTitle: short.title,
      reason: `Blocking work with no free slot at full size. Reduced to ${short.estimateMin} minutes so the dependency clears. ${short.detail} ${capacityLine}`,
    };
  }

  // Step 7: repeated postponement means the task itself is the problem.
  if (task.postponeCount >= 3) {
    if (!ctx.isP1 || task.importance === 'optional') {
      return {
        ...base,
        kind: 'REMOVE',
        reason: `Postponed ${task.postponeCount} times. Repeated postponement is evidence that this task is lower-value than originally estimated. ${capacityLine}`,
      };
    }
    const short = shortenTask(task);
    return {
      ...base,
      kind: 'REPLACE',
      replacementTitle: short.title,
      newEstimateMin: Math.min(short.estimateMin, 30),
      reason: `Postponed ${task.postponeCount} times, which usually means the task is too large or too vague rather than unimportant. Replaced with a smaller, immediately startable version. ${capacityLine}`,
    };
  }

  // Non-CAT overhead is the first thing to hand off when the week is full.
  if ((task.type === 'admin' || task.type === 'personal') && ctx.ratio > 0.85) {
    return {
      ...base,
      kind: 'DELEGATE',
      reason: `Non-CAT overhead competing with P1 work in a week already at ${Math.round(ctx.ratio * 100)}% of capacity. Hand it off or drop it. ${capacityLine}`,
    };
  }

  // Combine with an equivalent session already on the calendar.
  if (ctx.similarTask && ctx.ratio > 0.75) {
    return {
      ...base,
      kind: 'COMBINE',
      combineWithTaskId: ctx.similarTask.id,
      newEstimateMin: Math.round((ctx.similarTask.estimateMin + task.estimateMin * 0.6) / 5) * 5,
      reason: `An equivalent session ("${ctx.similarTask.title}") is already scheduled this week. Merging avoids two half-sessions on the same material. ${capacityLine}`,
    };
  }

  // Over capacity: shorten critical work, postpone the rest.
  if (ctx.ratio > 1) {
    if (task.importance === 'critical') {
      const short = shortenTask(task);
      return {
        ...base,
        kind: 'SHORTEN',
        newEstimateMin: short.estimateMin,
        replacementTitle: short.title,
        reason: `Foundational but not deadline-critical, and the week is over capacity. Reduced to ${short.estimateMin} minutes. ${short.detail} ${capacityLine}`,
      };
    }
    return {
      ...base,
      kind: 'POSTPONE',
      newDate: null,
      reason: `The rest of the week is already over capacity. Moved to the backlog for a fresh decision instead of being stacked onto tomorrow. ${capacityLine}`,
    };
  }

  // There is room: give it a real slot.
  const host = findHostDay(state, task, today, weekEnd, today);
  if (host) {
    return {
      ...base,
      kind: 'RESCHEDULE',
      newDate: host,
      reason: `Capacity exists later this week and this work still matters. ${capacityLine}`,
    };
  }

  return {
    ...base,
    kind: 'POSTPONE',
    newDate: null,
    reason: `No remaining day this week can host it without breaching buffer. Moved to the backlog. ${capacityLine}`,
  };
}

/** Applies a decision to the task list. Pure: returns a new array. */
export function applyMissedDecision(
  tasks: Task[],
  taskId: string,
  decision: MissedTaskDecision,
  today: ISODate,
): Task[] {
  const stamp = new Date().toISOString();
  return tasks.map((t) => {
    if (t.id === decision.combineWithTaskId && decision.kind === 'COMBINE') {
      return {
        ...t,
        estimateMin: decision.newEstimateMin ?? t.estimateMin,
        detail: [t.detail, 'Merged with a missed session covering the same material.'].filter(Boolean).join(' '),
        updatedAt: stamp,
      };
    }
    if (t.id !== taskId) return t;

    const next: Task = { ...t, needsDecision: false, updatedAt: stamp };
    switch (decision.kind) {
      case 'RESCHEDULE':
        return { ...next, status: 'planned', date: decision.newDate ?? addDays(today, 1), postponeCount: t.postponeCount + 1 };
      case 'SHORTEN':
        return {
          ...next,
          status: 'planned',
          date: decision.newDate ?? t.date ?? addDays(today, 1),
          estimateMin: decision.newEstimateMin ?? Math.round(t.estimateMin / 2),
          title: decision.replacementTitle ?? t.title,
        };
      case 'REPLACE':
        return {
          ...next,
          status: 'planned',
          date: decision.newDate ?? addDays(today, 1),
          estimateMin: decision.newEstimateMin ?? 30,
          title: decision.replacementTitle ?? t.title,
          postponeCount: 0,
        };
      case 'COMBINE':
        return { ...next, status: 'removed' };
      case 'POSTPONE':
        return { ...next, status: 'postponed', date: null, weekStart: null, postponeCount: t.postponeCount + 1 };
      case 'DELEGATE':
      case 'REMOVE':
        return { ...next, status: 'removed' };
      default:
        return next;
    }
  });
}
