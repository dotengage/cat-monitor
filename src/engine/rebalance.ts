/**
 * Week rebalancing.
 *
 * Fits the committed work into the capacity that actually exists, day by day,
 * while preserving buffer and never touching P1 or user-locked tasks unless
 * there is genuinely no alternative. Every move is logged as a decision so the
 * user can see - and reverse - what the system did.
 */
import { addDays, formatMinutes, weekDates } from '../domain/date';
import type { AppState, ISODate, PlanningDecisionKind, Task } from '../domain/types';
import { calculateWeekCapacity, energyForDate } from './capacity';
import { isOpen } from './derive';
import { buildPriorityContext, calculateTaskPriority, rankTasks, type PriorityContext } from './priority';

export interface DecisionDraft {
  date: ISODate;
  subject: string;
  subjectId?: string;
  kind: PlanningDecisionKind;
  reason: string;
  detail?: string;
  auto: boolean;
}

export interface RebalanceResult {
  tasks: Task[];
  decisions: DecisionDraft[];
  before: { plannedMin: number; capacityMin: number; overloadedDays: ISODate[] };
  after: { plannedMin: number; capacityMin: number; overloadedDays: ISODate[] };
  moved: number;
  removed: number;
  postponed: number;
  promoted: number;
}

/** Free planned capacity per day after existing open work is accounted for. */
export function loadByDay(state: AppState, weekStart: ISODate, today: ISODate) {
  const capacity = calculateWeekCapacity(state, weekStart, today);
  return capacity.days.map((day) => {
    const tasks = state.tasks.filter((t) => t.date === day.date && isOpen(t));
    const loadMin = tasks.reduce((a, t) => a + t.estimateMin, 0);
    return {
      date: day.date,
      capacityMin: day.plannedMin,
      loadMin,
      freeMin: day.plannedMin - loadMin,
      energy: day.energy,
      tasks,
    };
  });
}

function canHostTask(task: Task, date: ISODate, state: AppState, freeMin: number): boolean {
  if (freeMin < task.estimateMin) return false;
  if (task.deadline && date > task.deadline) return false;
  const energy = energyForDate(state, date);
  // Never place a high-cognition task on a day the model expects to be flat.
  if (task.energyRequired - energy >= 2) return false;
  return true;
}

export function rebalanceWeek(state: AppState, weekStart: ISODate, today: ISODate): RebalanceResult {
  const ctx = buildPriorityContext(state, today);
  const taskMap = new Map(state.tasks.map((t) => [t.id, { ...t }]));
  const decisions: DecisionDraft[] = [];
  let moved = 0;
  let removed = 0;
  let postponed = 0;
  let promoted = 0;

  const capacity = calculateWeekCapacity(state, weekStart, today);
  const days = weekDates(weekStart);
  const capMap = new Map(capacity.days.map((d) => [d.date, d.plannedMin]));

  const loadOf = (date: ISODate) =>
    [...taskMap.values()].filter((t) => t.date === date && isOpen(t)).reduce((a, t) => a + t.estimateMin, 0);

  const before = {
    plannedMin: days.reduce((a, d) => a + loadOf(d), 0),
    capacityMin: capacity.plannedMin,
    overloadedDays: days.filter((d) => loadOf(d) > (capMap.get(d) ?? 0)),
  };

  /* --- 1. Relieve overloaded days --------------------------------- */
  for (const date of days) {
    if (date < today) continue; // the past is history, not a planning target
    let guard = 0;
    while (loadOf(date) > (capMap.get(date) ?? 0) && guard < 30) {
      guard += 1;
      const candidates = [...taskMap.values()].filter(
        (t) => t.date === date && isOpen(t) && !t.locked,
      );
      if (candidates.length === 0) break;

      const ranked = rankTasks(candidates, ctx);
      const victim = ranked[ranked.length - 1].task;
      const overflow = loadOf(date) - (capMap.get(date) ?? 0);

      // (a) Try to move it to another day in the same week.
      const host = days.find((d) => {
        if (d === date || d < today) return false;
        const free = (capMap.get(d) ?? 0) - loadOf(d);
        return canHostTask(victim, d, state, free);
      });

      if (host) {
        taskMap.set(victim.id, { ...victim, date: host, weekStart });
        moved += 1;
        decisions.push({
          date: today,
          subject: victim.title,
          subjectId: victim.id,
          kind: 'RESCHEDULE',
          reason: `${formatMinutes(overflow)} over capacity on ${date}. Moved to ${host}, which has room and matching energy.`,
          auto: true,
        });
        continue;
      }

      // (b) Nothing fits. Optional / low-value work is cut, not carried.
      if (victim.importance === 'optional' || victim.impact <= 2) {
        taskMap.set(victim.id, { ...victim, status: 'removed', needsDecision: false });
        removed += 1;
        decisions.push({
          date: today,
          subject: victim.title,
          subjectId: victim.id,
          kind: 'REMOVE',
          reason:
            'The week is over capacity and this task is low-value. Carrying it forward would create task debt without moving the target.',
          auto: true,
        });
        continue;
      }

      // (c) Everything else goes to the backlog with an explicit decision,
      //     never silently onto tomorrow.
      taskMap.set(victim.id, {
        ...victim,
        date: null,
        weekStart: null,
        status: 'postponed',
        postponeCount: victim.postponeCount + 1,
        needsDecision: false,
      });
      postponed += 1;
      decisions.push({
        date: today,
        subject: victim.title,
        subjectId: victim.id,
        kind: 'POSTPONE',
        reason: `No day this week can host this without breaching buffer. Moved to the backlog for an explicit decision rather than stacked onto the next day.`,
        auto: true,
      });
    }
  }

  /* --- 2. Pull high-value work forward if real room appeared ------- */
  const spare = days
    .filter((d) => d >= today)
    .reduce((a, d) => a + Math.max(0, (capMap.get(d) ?? 0) - loadOf(d)), 0);

  if (spare >= 45) {
    const backlog = [...taskMap.values()].filter((t) => t.date === null && isOpen(t));
    const ranked = rankTasks(backlog, ctx).filter((r) => r.priority.score >= 55 && r.task.impact >= 3);
    for (const { task } of ranked) {
      const host = days.find((d) => {
        if (d < today) return false;
        const free = (capMap.get(d) ?? 0) - loadOf(d);
        return canHostTask(task, d, state, free);
      });
      if (!host) continue;
      taskMap.set(task.id, { ...task, date: host, weekStart, status: 'planned' });
      promoted += 1;
      decisions.push({
        date: today,
        subject: task.title,
        subjectId: task.id,
        kind: 'PROMOTE',
        reason: 'Capacity opened up this week and this is high-value pending work, so it was pulled forward rather than the week being filled with low-value tasks.',
        auto: true,
      });
      if (promoted >= 3) break;
    }
  }

  const tasks = [...taskMap.values()];
  const loadAfter = (date: ISODate) =>
    tasks.filter((t) => t.date === date && isOpen(t)).reduce((a, t) => a + t.estimateMin, 0);

  return {
    tasks,
    decisions,
    before,
    after: {
      plannedMin: days.reduce((a, d) => a + loadAfter(d), 0),
      capacityMin: capacity.plannedMin,
      overloadedDays: days.filter((d) => loadAfter(d) > (capMap.get(d) ?? 0)),
    },
    moved,
    removed,
    postponed,
    promoted,
  };
}

/** Best day in a range for a task, or null when nothing can host it. */
export function findHostDay(
  state: AppState,
  task: Task,
  from: ISODate,
  to: ISODate,
  today: ISODate,
): ISODate | null {
  let cursor = from;
  let guard = 0;
  const best: { date: ISODate; free: number }[] = [];
  while (cursor <= to && guard < 60) {
    const dayLoad = state.tasks
      .filter((t) => t.date === cursor && isOpen(t) && t.id !== task.id)
      .reduce((a, t) => a + t.estimateMin, 0);
    const cap = calculateWeekCapacity(state, cursor, today).days[0].plannedMin;
    const free = cap - dayLoad;
    if (canHostTask(task, cursor, state, free)) best.push({ date: cursor, free });
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  if (best.length === 0) return null;
  // Earliest day that comfortably fits; ties broken by most free capacity.
  best.sort((a, b) => (a.date === b.date ? b.free - a.free : a.date < b.date ? -1 : 1));
  return best[0].date;
}

export function priorityOf(task: Task, ctx: PriorityContext): number {
  return calculateTaskPriority(task, ctx).score;
}
