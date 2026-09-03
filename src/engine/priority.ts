/**
 * Task priority.
 *
 * Priority is never "sort by due date". A 20-minute high-value task should be
 * able to outrank a 2-hour low-value one, so value density is a first-class
 * component alongside goal priority, deadline, dependency, weakness, exam
 * relevance and fit with today's energy.
 */
import { TASK_TYPE_EXAM_RELEVANCE } from '../config/catConfig';
import { daysBetween } from '../domain/date';
import type {
  AppState,
  EnergyLevel,
  EnergyMode,
  Goal,
  ID,
  ISODate,
  PriorityComponents,
  SectionKey,
  Task,
  TaskPriority,
} from '../domain/types';
import { energyForDate, energyModeFor } from './capacity';
import { clamp, isOpen, weaknessScores } from './derive';

export interface PriorityContext {
  state: AppState;
  today: ISODate;
  weakness: Record<SectionKey, number>;
  dependents: Map<ID, number>;
  goals: Map<ID, Goal>;
  energyLevel: EnergyLevel;
  energyMode: EnergyMode;
}

const MAX_RAW = 118;

export function buildPriorityContext(
  state: AppState,
  today: ISODate,
  energyOverride?: EnergyLevel,
): PriorityContext {
  const dependents = new Map<ID, number>();
  for (const task of state.tasks) {
    if (!isOpen(task)) continue;
    for (const dep of task.dependsOn) {
      dependents.set(dep, (dependents.get(dep) ?? 0) + 1);
    }
  }
  const energyLevel = energyOverride ?? energyForDate(state, today);
  return {
    state,
    today,
    weakness: weaknessScores(state, today),
    dependents,
    goals: new Map(state.goals.map((g) => [g.id, g])),
    energyLevel,
    energyMode: energyModeFor(energyLevel),
  };
}

function goalPriorityPoints(task: Task, ctx: PriorityContext): number {
  const goal = task.goalId ? ctx.goals.get(task.goalId) : undefined;
  const priority = goal?.priority ?? inferPriority(task);
  if (priority === 'P1') return 25;
  if (priority === 'P2') return 14;
  return 6;
}

function inferPriority(task: Task): 'P1' | 'P2' | 'P3' {
  if (task.type === 'personal') return 'P3';
  if (task.type === 'admin' || task.type === 'planning') return 'P2';
  return 'P1';
}

function deadlinePoints(task: Task, today: ISODate): number {
  if (!task.deadline) return 0;
  const days = daysBetween(today, task.deadline);
  if (days <= 0) return 15;
  if (days === 1) return 13;
  if (days === 2) return 11;
  if (days === 3) return 9;
  if (days <= 7) return 6;
  if (days <= 14) return 3;
  return 1;
}

function energyFitPoints(task: Task, ctx: PriorityContext): number {
  // Use the concrete energy level: rounding through the coarse mode would
  // treat "very high" and "high" days as identical.
  const available = ctx.energyLevel;
  const diff = task.energyRequired - available;
  if (diff >= 2) return 0;
  if (diff === 1) return 4;
  // Do not waste a high-energy day on trivial work.
  if (available >= 4 && task.energyRequired <= 2) return 3;
  return 8;
}

function valueDensityPoints(task: Task): number {
  const hours = Math.max(0.15, task.estimateMin / 60);
  const density = task.impact / hours;
  return clamp(density * 2, 0, 10);
}

export function calculateTaskPriority(task: Task, ctx: PriorityContext): TaskPriority {
  const components: PriorityComponents = {
    goalPriority: goalPriorityPoints(task, ctx),
    importance: task.importance === 'critical' ? 18 : task.importance === 'important' ? 11 : 4,
    deadline: deadlinePoints(task, ctx.today),
    dependency: clamp((ctx.dependents.get(task.id) ?? 0) * 4, 0, 12),
    weakness: task.section ? ctx.weakness[task.section] * 14 : 4,
    examRelevance: TASK_TYPE_EXAM_RELEVANCE[task.type] * 10,
    staleness: clamp(task.postponeCount * 2, 0, 6),
    energyFit: energyFitPoints(task, ctx),
    valueDensity: valueDensityPoints(task),
  };
  const raw = Object.values(components).reduce((a, v) => a + v, 0);
  return {
    taskId: task.id,
    score: Math.round((raw / MAX_RAW) * 1000) / 10,
    components,
  };
}

export function rankTasks(tasks: Task[], ctx: PriorityContext): { task: Task; priority: TaskPriority }[] {
  return tasks
    .map((task) => ({ task, priority: calculateTaskPriority(task, ctx) }))
    .sort((a, b) => b.priority.score - a.priority.score);
}

/* ------------------------------------------------------------------ */
/* Today plan                                                          */
/* ------------------------------------------------------------------ */

export interface TodayPlan {
  date: ISODate;
  mustDo: Task[];
  shouldDo: Task[];
  optional: Task[];
  done: Task[];
  /** Lower-friction swaps offered when energy is low. */
  alternatives: Task[];
  plannedMin: number;
  allocatedMin: number;
  bufferMin: number;
  energyMode: EnergyMode;
  note?: string;
}

/**
 * The Today view stays deliberately small: 1-2 must-do, 1-2 should-do, 1
 * optional, and visible unallocated buffer. Anything beyond that is noise.
 */
export function buildTodayPlan(
  state: AppState,
  today: ISODate,
  plannedCapacityMin: number,
  energyOverride?: EnergyLevel,
): TodayPlan {
  const ctx = buildPriorityContext(state, today, energyOverride);
  const dayTasks = state.tasks.filter((t) => t.date === today && t.status !== 'removed');
  const done = dayTasks.filter((t) => t.status === 'done' || t.status === 'partial');
  // Missed work is not silently re-offered as today's plan: it is surfaced
  // separately as a decision that has to be made.
  const openForDay = dayTasks.filter((t) => t.status === 'planned');
  const ranked = rankTasks(openForDay, ctx);

  const mustDo: Task[] = [];
  const shouldDo: Task[] = [];
  const optional: Task[] = [];
  let allocated = done.reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);

  const lowEnergy = ctx.energyMode === 'LOW' || ctx.energyMode === 'VERY_LOW';

  for (const { task } of ranked) {
    const fits = allocated + task.estimateMin <= plannedCapacityMin * 1.1;
    if (mustDo.length < 2 && (task.importance === 'critical' || mustDo.length === 0) && fits) {
      mustDo.push(task);
      allocated += task.estimateMin;
    } else if (shouldDo.length < 2 && fits) {
      shouldDo.push(task);
      allocated += task.estimateMin;
    } else if (optional.length < 1) {
      optional.push(task);
    }
  }

  // On a low-energy day, offer concrete low-friction swaps rather than
  // asking the user to push through work the day cannot support.
  const alternatives = lowEnergy
    ? rankTasks(
        state.tasks.filter(
          (t) => isOpen(t) && t.date !== today && t.energyRequired <= 2 && t.status !== 'removed',
        ),
        ctx,
      )
        .slice(0, 2)
        .map((r) => r.task)
    : [];

  return {
    date: today,
    mustDo,
    shouldDo,
    optional,
    done,
    alternatives,
    plannedMin: plannedCapacityMin,
    allocatedMin: allocated,
    bufferMin: Math.max(0, plannedCapacityMin - allocated),
    energyMode: ctx.energyMode,
    note: lowEnergy
      ? 'Low-energy mode: the day has not been abandoned, but high-cognition work has been pushed down the list in favour of review, revision and video learning.'
      : undefined,
  };
}
