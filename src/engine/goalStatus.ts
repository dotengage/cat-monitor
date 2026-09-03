/**
 * Goal status.
 *
 * The primary goal is judged by the feasibility engine (mock evidence corrected
 * by capacity). Secondary goals are judged on pace: progress achieved against
 * time elapsed, or - when a goal has no measurable target - on whether its work
 * is actually getting done.
 */
import { daysBetween } from '../domain/date';
import type { AppState, Goal, ID, ISODate, TrackStatus } from '../domain/types';
import { clamp, isOpen } from './derive';
import { calculateFeasibility } from './workload';

export interface GoalStatusResult {
  goalId: ID;
  title: string;
  priority: Goal['priority'];
  status: TrackStatus;
  reason: string;
  requiredPace?: string;
  actualPace?: string;
  remainingWorkloadMin: number;
  openTasks: number;
  nextAction: string;
}

export function calculateGoalStatus(goal: Goal, state: AppState, today: ISODate): GoalStatusResult {
  const linked = state.tasks.filter((t) => t.goalId === goal.id && t.status !== 'removed');
  const open = linked.filter(isOpen);
  const remainingWorkloadMin = open.reduce((a, t) => a + t.estimateMin, 0);

  if (goal.isPrimary) {
    const feasibility = calculateFeasibility(state, today);
    const w = feasibility.workload;
    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      status: feasibility.status,
      reason: feasibility.reason,
      requiredPace: `${(w.requiredPerWeekMin / 60).toFixed(1)}h per week`,
      actualPace: w.actualPerWeekMin ? `${(w.actualPerWeekMin / 60).toFixed(1)}h per week` : 'not established',
      remainingWorkloadMin: w.remainingMin,
      openTasks: open.length,
      nextAction: feasibility.nextAction,
    };
  }

  // Measurable goal with a deadline: compare progress made to time elapsed.
  if (
    goal.deadline &&
    typeof goal.targetValue === 'number' &&
    typeof goal.currentValue === 'number' &&
    goal.targetValue !== 0
  ) {
    const totalDays = Math.max(1, daysBetween(goal.createdAt.slice(0, 10), goal.deadline));
    const elapsed = clamp(daysBetween(goal.createdAt.slice(0, 10), today) / totalDays, 0, 1);
    const progress = clamp(goal.currentValue / goal.targetValue, 0, 1);
    const daysLeft = Math.max(0, daysBetween(today, goal.deadline));
    const weeksLeft = Math.max(0.2, daysLeft / 7);
    const requiredPerWeek = (goal.targetValue - goal.currentValue) / weeksLeft;

    let status: TrackStatus;
    if (progress >= elapsed) status = 'ON_TRACK';
    else if (progress >= elapsed - 0.15) status = 'AT_RISK';
    else status = 'BEHIND';

    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      status,
      reason: `${Math.round(progress * 100)}% of the target reached with ${Math.round((1 - elapsed) * 100)}% of the time left (${daysLeft} days).`,
      requiredPace: `${round1(requiredPerWeek)} ${goal.metric || 'units'} per week`,
      actualPace: `${round1(goal.currentValue / Math.max(0.2, (totalDays * elapsed) / 7))} ${goal.metric || 'units'} per week`,
      remainingWorkloadMin,
      openTasks: open.length,
      nextAction:
        status === 'ON_TRACK'
          ? 'Keep the current pace; no correction needed.'
          : `Increase pace to about ${round1(requiredPerWeek)} ${goal.metric || 'units'} per week or reduce the target.`,
    };
  }

  // Unmeasured goal: judge it by whether its work is moving.
  const settledTasks = linked.filter((t) => ['done', 'missed', 'partial', 'postponed'].includes(t.status));
  if (settledTasks.length < 3) {
    return {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
      status: 'UNCONFIRMED',
      reason: 'Not enough completed or missed work linked to this goal to judge progress yet.',
      remainingWorkloadMin,
      openTasks: open.length,
      nextAction:
        open.length === 0
          ? 'Add at least one specific, startable task so this goal produces evidence.'
          : 'Complete the linked tasks so the system can measure this goal.',
    };
  }

  const completionRate = settledTasks.filter((t) => t.status === 'done').length / settledTasks.length;
  const status: TrackStatus = completionRate >= 0.75 ? 'ON_TRACK' : completionRate >= 0.5 ? 'AT_RISK' : 'BEHIND';
  return {
    goalId: goal.id,
    title: goal.title,
    priority: goal.priority,
    status,
    reason: `${Math.round(completionRate * 100)}% of the ${settledTasks.length} tasks scheduled for this goal were completed.`,
    requiredPace: undefined,
    actualPace: `${settledTasks.filter((t) => t.status === 'done').length} of ${settledTasks.length} tasks completed`,
    remainingWorkloadMin,
    openTasks: open.length,
    nextAction:
      status === 'ON_TRACK'
        ? 'Continue as planned.'
        : goal.priority === 'P3'
          ? 'This goal keeps losing to higher-priority work. Consider pausing it until after the exam rather than carrying it indefinitely.'
          : 'Reduce the scope of this goal so it fits alongside P1 CAT work.',
  };
}

export function calculateAllGoalStatuses(state: AppState, today: ISODate): GoalStatusResult[] {
  return state.goals
    .filter((g) => !g.archived)
    .map((g) => calculateGoalStatus(g, state, today))
    .sort((a, b) => a.priority.localeCompare(b.priority));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
