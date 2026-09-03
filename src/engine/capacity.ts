/**
 * Capacity model.
 *
 *   base available time
 *     x energy factor
 *     x commitment factor
 *     x realism factor        (learned from what actually happened)
 *   = realistic available time
 *
 * Buffer is then held back from that number. The formula is deliberately
 * transparent and every factor is surfaced in the UI - it is a planning aid,
 * not a claim that human productivity is predictable.
 */
import { addDays, dayOfWeek, isWeekend, weekDates } from '../domain/date';
import type {
  AppState,
  CapacityBreakdown,
  Commitment,
  EnergyLevel,
  EnergyMode,
  ISODate,
} from '../domain/types';
import { clamp, mean } from './derive';

export function energyModeFor(level: EnergyLevel): EnergyMode {
  if (level >= 4) return 'HIGH';
  if (level === 3) return 'NORMAL';
  if (level === 2) return 'LOW';
  return 'VERY_LOW';
}

export function energyLevelForMode(mode: EnergyMode): EnergyLevel {
  switch (mode) {
    case 'HIGH':
      return 4;
    case 'NORMAL':
      return 3;
    case 'LOW':
      return 2;
    default:
      return 1;
  }
}

export function commitmentAppliesOn(c: Commitment, date: ISODate): boolean {
  if (date < c.startDate || date > c.endDate) return false;
  if (c.recurrence === 'weekly') {
    return c.daysOfWeek.length === 0 || c.daysOfWeek.includes(dayOfWeek(date));
  }
  return true;
}

export function commitmentsOn(state: AppState, date: ISODate): Commitment[] {
  return state.commitments.filter((c) => commitmentAppliesOn(c, date));
}

/** Only commitments that were not already priced into the stated hours. */
export function capacityReducingCommitmentsOn(state: AppState, date: ISODate): Commitment[] {
  return commitmentsOn(state, date).filter((c) => c.reducesCapacity !== false);
}

/** Energy for a date: an actual log wins, otherwise the profile pattern. */
export function energyForDate(state: AppState, date: ISODate): EnergyLevel {
  const log = state.dayLogs.find((d) => d.date === date);
  if (log) return log.energy;
  return state.profile.energyByDay[dayOfWeek(date)] ?? 3;
}

/**
 * Learned realism factor: how much of the theoretically available time is
 * actually converted into focused work. Uses the median of recent logged days
 * so one disastrous day does not reshape the plan.
 */
export function calculateRealismFactor(state: AppState, today: ISODate, windowDays = 28): number {
  const cutoff = addDays(today, -windowDays);
  const ratios: number[] = [];
  for (const log of state.dayLogs) {
    if (log.date < cutoff || log.date > today) continue;
    const raw = rawAvailableMin(state, log.date);
    if (raw <= 0) continue;
    ratios.push(clamp(log.focusedMin / raw, 0, 1.5));
  }
  if (ratios.length < 4) return 1;
  // Median of the recent window, softened towards 1 so the model moves gradually.
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const blended = 0.65 * mid + 0.35 * 1;
  return clamp(blended, 0.6, 1.2);
}

/** base x energy x commitments - no realism, no buffer. */
export function rawAvailableMin(state: AppState, date: ISODate): number {
  const { profile, settings } = state;
  const band = isWeekend(date) ? profile.weekendHours : profile.weekdayHours;
  const baseMin = band.normal * 60;
  const energy = energyForDate(state, date);
  const energyFactor = settings.planning.energyFactors[energy] ?? 1;
  const committedMin = capacityReducingCommitmentsOn(state, date).reduce((a, c) => a + c.hoursPerDay * 60, 0);
  const afterEnergy = baseMin * energyFactor;
  const afterCommitments = Math.max(0, afterEnergy - committedMin);
  return clamp(afterCommitments, 0, band.max * 60);
}

export interface CapacityOptions {
  energyOverride?: EnergyLevel;
  /** Skip the learned realism factor (used when measuring realism itself). */
  ignoreRealism?: boolean;
  /** Pre-computed realism factor, to avoid recomputing per day. */
  realism?: number;
  today?: ISODate;
}

export function calculateCapacity(
  state: AppState,
  date: ISODate,
  opts: CapacityOptions = {},
): CapacityBreakdown {
  const { profile, settings } = state;
  const band = isWeekend(date) ? profile.weekendHours : profile.weekdayHours;
  const baseMin = band.normal * 60;

  const energy = opts.energyOverride ?? energyForDate(state, date);
  const energyFactor = settings.planning.energyFactors[energy] ?? 1;

  const dayCommitments = capacityReducingCommitmentsOn(state, date);
  const committedMin = dayCommitments.reduce((a, c) => a + c.hoursPerDay * 60, 0);
  const afterEnergy = baseMin * energyFactor;
  const commitmentFactor = afterEnergy > 0 ? clamp((afterEnergy - committedMin) / afterEnergy, 0, 1) : 0;

  const realismFactor = opts.ignoreRealism
    ? 1
    : (opts.realism ?? calculateRealismFactor(state, opts.today ?? date));

  const rawMin = clamp(afterEnergy * commitmentFactor * realismFactor, 0, band.max * 60);
  const bufferPct = clamp(settings.planning.bufferPct, 0, 0.5);
  const plannedMin = Math.round(rawMin * (1 - bufferPct));

  return {
    date,
    baseMin,
    energyFactor,
    commitmentFactor: round2(commitmentFactor),
    realismFactor: round2(realismFactor),
    rawMin: Math.round(rawMin),
    plannedMin,
    bufferMin: Math.round(rawMin) - plannedMin,
    minMin: band.min * 60,
    maxMin: band.max * 60,
    commitments: dayCommitments.map((c) => ({ title: c.title, hours: c.hoursPerDay })),
    energy,
  };
}

export interface WeekCapacity {
  weekStart: ISODate;
  days: CapacityBreakdown[];
  rawMin: number;
  plannedMin: number;
  bufferMin: number;
  /** Planned capacity on days that have not already passed. */
  remainingPlannedMin: number;
  remainingBufferMin: number;
}

export function calculateWeekCapacity(state: AppState, weekStart: ISODate, today?: ISODate): WeekCapacity {
  const realism = calculateRealismFactor(state, today ?? weekStart);
  const days = weekDates(weekStart).map((d) => calculateCapacity(state, d, { realism, today }));
  const future = today ? days.filter((d) => d.date >= today) : days;
  return {
    weekStart,
    days,
    rawMin: days.reduce((a, d) => a + d.rawMin, 0),
    plannedMin: days.reduce((a, d) => a + d.plannedMin, 0),
    bufferMin: days.reduce((a, d) => a + d.bufferMin, 0),
    remainingPlannedMin: future.reduce((a, d) => a + d.plannedMin, 0),
    remainingBufferMin: future.reduce((a, d) => a + d.bufferMin, 0),
  };
}

/** Planned capacity across an arbitrary date range (inclusive). */
export function capacityBetween(state: AppState, from: ISODate, to: ISODate, today?: ISODate): number {
  const realism = calculateRealismFactor(state, today ?? from);
  let total = 0;
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 1000) {
    total += calculateCapacity(state, cursor, { realism, today }).plannedMin;
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return total;
}

/**
 * The weekly capacity the planner is willing to commit to. Uses the modelled
 * next seven days, then sanity-checks against what the user actually managed
 * in recent weeks - if reality has been consistently lower, reality wins.
 */
export function sustainableWeeklyMin(state: AppState, today: ISODate): number {
  const modelled = calculateWeekCapacity(state, today, today).plannedMin;
  const recent = [...state.capacityRecords]
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, 3)
    .filter((r) => r.actualMin > 0);
  if (recent.length < 2) return modelled;
  const actualAvg = mean(recent.map((r) => r.actualMin));
  // Blend, but never let the plan exceed 115% of demonstrated capacity.
  return Math.round(clamp(0.5 * modelled + 0.5 * actualAvg, 0, actualAvg * 1.15));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
