/**
 * Habit tracking and streaks.
 *
 * Habits are the small repeatable inputs that decide whether the plan gets
 * executed at all - deliberately separate from tasks, which are specific and
 * change every week. A streak measures consistency, not volume, which is why
 * a day counts on a percentage of habits hit rather than on all of them.
 */
import { addDays, daysBetween } from '../domain/date';
import type { AppState, Habit, HabitDay, ID, ISODate, SectionKey } from '../domain/types';
import { SECTIONS } from '../config/catConfig';

export interface HabitDayScore {
  date: ISODate;
  marks: Record<ID, boolean>;
  /** Habits ticked. */
  done: number;
  /** Active habits on that day. */
  total: number;
  /** 0-1. */
  score: number;
  /** Whether the day counts towards the streak. */
  hit: boolean;
  /** Nothing was recorded at all. */
  untouched: boolean;
}

export interface HabitStats {
  today: HabitDayScore;
  currentStreak: number;
  bestStreak: number;
  /** Most recent first. */
  days: HabitDayScore[];
  /** Share of days in the window that counted as a hit. */
  consistency: number;
  activeHabits: Habit[];
  threshold: number;
}

export function activeHabits(state: AppState): Habit[] {
  return [...state.habits].filter((h) => h.active).sort((a, b) => a.order - b.order);
}

export function habitDayFor(state: AppState, date: ISODate): HabitDay | undefined {
  return state.habitDays.find((d) => d.date === date);
}

export function scoreDay(state: AppState, date: ISODate, threshold: number): HabitDayScore {
  const habits = activeHabits(state);
  const day = habitDayFor(state, date);
  const marks = day?.marks ?? {};
  const done = habits.filter((h) => marks[h.id] === true).length;
  const total = habits.length;
  const score = total > 0 ? done / total : 0;
  return {
    date,
    marks,
    done,
    total,
    score,
    hit: total > 0 && score >= threshold,
    untouched: Object.keys(marks).length === 0,
  };
}

/**
 * Consecutive hit days ending today, or ending yesterday when today has not
 * been filled in yet - an unfinished day should not read as a broken streak
 * at nine in the morning.
 */
export function currentStreak(scores: Map<ISODate, HabitDayScore>, today: ISODate): number {
  const todayScore = scores.get(today);
  let cursor = todayScore?.hit ? today : addDays(today, -1);
  // Today counts only if it has been hit; an untouched today is simply skipped.
  if (!todayScore?.hit && todayScore && !todayScore.untouched && todayScore.total > 0) {
    // Today was filled in but missed the threshold: the streak has ended.
    return 0;
  }

  let streak = 0;
  let guard = 0;
  while (guard < 1000) {
    const score = scores.get(cursor);
    if (!score?.hit) break;
    streak += 1;
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return streak;
}

export function bestStreak(scores: HabitDayScore[]): number {
  // `scores` is expected oldest first.
  let best = 0;
  let run = 0;
  for (const s of scores) {
    if (s.hit) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

export function calculateHabitStats(state: AppState, today: ISODate, windowDays = 60): HabitStats {
  const threshold = state.settings.planning.habitStreakThreshold ?? 0.6;
  const habits = activeHabits(state);

  // Cover the whole recorded history for the best streak, but only render a
  // recent window.
  const earliestRecorded = state.habitDays.reduce<ISODate | null>(
    (acc, d) => (acc === null || d.date < acc ? d.date : acc),
    null,
  );
  const historyStart = earliestRecorded && earliestRecorded < addDays(today, -windowDays)
    ? earliestRecorded
    : addDays(today, -windowDays);

  const span = Math.max(0, daysBetween(historyStart, today));
  const oldestFirst: HabitDayScore[] = [];
  const map = new Map<ISODate, HabitDayScore>();
  for (let i = 0; i <= span; i += 1) {
    const date = addDays(historyStart, i);
    const score = scoreDay(state, date, threshold);
    oldestFirst.push(score);
    map.set(date, score);
  }

  const touched = oldestFirst.filter((d) => !d.untouched);
  return {
    today: scoreDay(state, today, threshold),
    currentStreak: currentStreak(map, today),
    bestStreak: bestStreak(oldestFirst),
    days: [...oldestFirst].reverse().slice(0, windowDays),
    consistency: touched.length > 0 ? touched.filter((d) => d.hit).length / touched.length : 0,
    activeHabits: habits,
    threshold,
  };
}

/* ------------------------------------------------------------------ */
/* Daily study log                                                     */
/* ------------------------------------------------------------------ */

export interface StudyLogRow {
  date: ISODate;
  sections: Record<SectionKey, { minutes: number; topics: string }>;
  totalMin: number;
  note: string;
  energy: number | null;
}

export function studyLogRows(state: AppState, from: ISODate, to: ISODate): StudyLogRow[] {
  const rows: StudyLogRow[] = [];
  const span = Math.max(0, daysBetween(from, to));
  for (let i = 0; i <= span && i < 400; i += 1) {
    const date = addDays(from, i);
    const log = state.dayLogs.find((d) => d.date === date);
    const sections = {} as StudyLogRow['sections'];
    let total = 0;
    for (const s of SECTIONS) {
      const entry = log?.study?.[s];
      sections[s] = { minutes: entry?.minutes ?? 0, topics: entry?.topics ?? '' };
      total += entry?.minutes ?? 0;
    }
    rows.push({
      date,
      sections,
      // Fall back to the overall focused figure when nothing was split out.
      totalMin: total > 0 ? total : (log?.focusedMin ?? 0),
      note: log?.note ?? '',
      energy: log?.energy ?? null,
    });
  }
  return rows.reverse();
}

export interface StudyTotals {
  totalMin: number;
  bySection: Record<SectionKey, number>;
  daysLogged: number;
  averageMinPerLoggedDay: number;
}

export function studyTotals(rows: StudyLogRow[]): StudyTotals {
  const bySection = { VARC: 0, DILR: 0, QA: 0 } as Record<SectionKey, number>;
  let total = 0;
  let logged = 0;
  for (const row of rows) {
    for (const s of SECTIONS) bySection[s] += row.sections[s].minutes;
    total += row.totalMin;
    if (row.totalMin > 0) logged += 1;
  }
  return {
    totalMin: total,
    bySection,
    daysLogged: logged,
    averageMinPerLoggedDay: logged > 0 ? Math.round(total / logged) : 0,
  };
}

/** Sum of the per-section minutes, used to keep `focusedMin` honest. */
export function studyMinutesTotal(study: Partial<Record<SectionKey, { minutes: number }>> | undefined): number {
  if (!study) return 0;
  return SECTIONS.reduce((acc, s) => acc + (study[s]?.minutes ?? 0), 0);
}
