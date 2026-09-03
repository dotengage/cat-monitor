/**
 * Conflict detection.
 *
 * A conflict is never just a warning: every one carries the decision the
 * system would take, so the user can accept it in one action or override it.
 */
import { SECTION_LABELS } from '../config/catConfig';
import { addDays, formatHours, formatMinutes, shortDayName, weekDates } from '../domain/date';
import type { AppState, Conflict, ISODate } from '../domain/types';
import { calculateWeekCapacity, energyForDate } from './capacity';
import { isOpen } from './derive';

export function detectConflicts(state: AppState, weekStart: ISODate, today: ISODate): Conflict[] {
  const conflicts: Conflict[] = [];
  const capacity = calculateWeekCapacity(state, weekStart, today);
  const days = weekDates(weekStart);
  const capMap = new Map(capacity.days.map((d) => [d.date, d]));

  const openInWeek = state.tasks.filter(
    (t) => isOpen(t) && t.date !== null && t.date >= weekStart && t.date <= addDays(weekStart, 6),
  );
  const weekLoad = openInWeek.reduce((a, t) => a + t.estimateMin, 0);

  /* --- Capacity: the week as a whole --------------------------------- */
  if (weekLoad > capacity.plannedMin) {
    const over = weekLoad - capacity.plannedMin;
    conflicts.push({
      id: 'capacity-week',
      kind: 'capacity',
      severity: over > capacity.plannedMin * 0.25 ? 'critical' : 'warn',
      title: 'Planned work exceeds realistic capacity',
      detail: `${formatHours(weekLoad, 1)} planned against ${formatHours(capacity.plannedMin, 1)} of planned capacity (${formatHours(capacity.bufferMin, 1)} is held as buffer).`,
      suggestion: `Rebalance the week: ${formatMinutes(over)} of the lowest-value work should move, shrink or be removed. Buffer is not available for reallocation.`,
      action: { label: 'Rebalance week', kind: 'rebalance' },
    });
  }

  /* --- Time: individual overloaded days ------------------------------ */
  for (const date of days) {
    if (date < today) continue;
    const cap = capMap.get(date);
    if (!cap) continue;
    const load = openInWeek.filter((t) => t.date === date).reduce((a, t) => a + t.estimateMin, 0);
    if (cap.plannedMin === 0 && load > 0) {
      conflicts.push({
        id: `time-${date}`,
        kind: 'time',
        severity: 'critical',
        title: `${shortDayName(date)} has no available capacity`,
        detail: `${formatMinutes(load)} is scheduled on a day with commitments consuming all available time${
          cap.commitments.length ? ` (${cap.commitments.map((c) => c.title).join(', ')})` : ''
        }.`,
        suggestion: 'Move this work to another day or accept that it will not happen.',
        action: { label: 'Rebalance week', kind: 'rebalance', date },
      });
    } else if (load > cap.plannedMin * 1.05) {
      conflicts.push({
        id: `time-${date}`,
        kind: 'time',
        severity: load > cap.plannedMin * 1.4 ? 'critical' : 'warn',
        title: `${shortDayName(date)} is overloaded`,
        detail: `${formatMinutes(load)} scheduled against ${formatMinutes(cap.plannedMin)} of planned capacity.`,
        suggestion: 'Move the lowest-priority task to a lighter day, or reduce its scope.',
        action: { label: 'Rebalance week', kind: 'rebalance', date },
      });
    }
  }

  /* --- Energy: hard work on flat days -------------------------------- */
  for (const task of openInWeek) {
    if (!task.date || task.date < today) continue;
    const energy = energyForDate(state, task.date);
    if (task.energyRequired - energy >= 2) {
      conflicts.push({
        id: `energy-${task.id}`,
        kind: 'energy',
        severity: 'warn',
        title: 'High-cognition work on a low-energy day',
        detail: `"${task.title}" needs energy ${task.energyRequired} but ${shortDayName(task.date)} is modelled at energy ${energy}.`,
        suggestion: 'Move it to your strongest day this week, or swap in revision / error review instead.',
        action: { label: 'Move task', kind: 'move', date: task.date },
      });
    }
  }

  /* --- Deadline: competing deadlines in the same window --------------- */
  const soon = openInWeek.filter((t) => t.deadline && t.deadline <= addDays(today, 3));
  if (soon.length >= 2) {
    const total = soon.reduce((a, t) => a + t.estimateMin, 0);
    const windowCap = capacity.days
      .filter((d) => d.date >= today && d.date <= addDays(today, 3))
      .reduce((a, d) => a + d.plannedMin, 0);
    if (total > windowCap) {
      conflicts.push({
        id: 'deadline-cluster',
        kind: 'deadline',
        severity: 'critical',
        title: `${soon.length} deadlines compete in the next 3 days`,
        detail: `${formatHours(total, 1)} of deadline-bound work against ${formatHours(windowCap, 1)} of capacity in that window.`,
        suggestion: 'Keep the item with genuine downstream dependencies at full size and shorten the rest.',
        action: { label: 'Rebalance week', kind: 'rebalance' },
      });
    }
  }

  /* --- Goal: secondary goals crowding out P1 -------------------------- */
  const goalById = new Map(state.goals.map((g) => [g.id, g]));
  const nonP1Min = openInWeek
    .filter((t) => {
      const g = t.goalId ? goalById.get(t.goalId) : undefined;
      return g ? g.priority !== 'P1' : t.type === 'personal' || t.type === 'admin';
    })
    .reduce((a, t) => a + t.estimateMin, 0);
  const p1Backlog = state.tasks.filter((t) => {
    if (!isOpen(t) || t.date !== null) return false;
    const g = t.goalId ? goalById.get(t.goalId) : undefined;
    return (g?.priority ?? 'P1') === 'P1';
  });
  if (weekLoad > 0 && nonP1Min / weekLoad > 0.25 && p1Backlog.length > 0) {
    conflicts.push({
      id: 'goal-competition',
      kind: 'goal',
      severity: 'warn',
      title: 'Secondary goals are taking P1 time',
      detail: `${Math.round((nonP1Min / weekLoad) * 100)}% of this week is P2/P3 work while ${p1Backlog.length} P1 item(s) sit in the backlog.`,
      suggestion: 'Postpone the P2/P3 work and promote the highest-value P1 backlog item into the freed slot.',
      action: { label: 'Rebalance week', kind: 'rebalance' },
    });
  }

  /* --- Section imbalance --------------------------------------------- */
  const sectionMin: Record<string, number> = {};
  for (const t of openInWeek) {
    if (!t.section) continue;
    sectionMin[t.section] = (sectionMin[t.section] ?? 0) + t.estimateMin;
  }
  const covered = Object.keys(sectionMin);
  if (covered.length > 0 && covered.length < 3 && weekLoad > 240) {
    const missing = (['VARC', 'DILR', 'QA'] as const).filter((s) => !covered.includes(s));
    conflicts.push({
      id: 'section-gap',
      kind: 'goal',
      severity: 'info',
      title: `No ${missing.map((m) => SECTION_LABELS[m]).join(' or ')} work this week`,
      detail: 'CAT is sectional. A week with no exposure to a section lets that section decay quietly.',
      suggestion: 'Add at least one short session for each missing section, even 20 minutes.',
    });
  }

  return conflicts;
}
