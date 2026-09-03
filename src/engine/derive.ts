/**
 * Derived read-models shared by the rest of the engine.
 *
 * Everything here is a pure function of `AppState`. Nothing mutates, nothing
 * reads the clock unless a date is passed in, so all of it is directly testable.
 */
import { SECTIONS } from '../config/catConfig';
import { addDays, daysBetween } from '../domain/date';
import type {
  AppState,
  ErrorEntry,
  ID,
  ISODate,
  Mock,
  SectionKey,
  Task,
  Topic,
} from '../domain/types';

export const OPEN_TASK_STATUSES: Task['status'][] = ['planned', 'postponed', 'missed', 'partial'];

export function isOpen(task: Task): boolean {
  return OPEN_TASK_STATUSES.includes(task.status);
}

export function isClosed(task: Task): boolean {
  return task.status === 'done' || task.status === 'removed';
}

export function openTasks(state: AppState): Task[] {
  return state.tasks.filter(isOpen);
}

export function tasksOnDate(state: AppState, date: ISODate): Task[] {
  return state.tasks.filter((t) => t.date === date && t.status !== 'removed');
}

export function tasksInWeek(state: AppState, weekStart: ISODate): Task[] {
  const end = addDays(weekStart, 6);
  return state.tasks.filter(
    (t) => t.date !== null && t.date >= weekStart && t.date <= end && t.status !== 'removed',
  );
}

export function backlogTasks(state: AppState): Task[] {
  return state.tasks.filter((t) => t.date === null && isOpen(t));
}

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

export function sortedMocks(state: AppState): Mock[] {
  return [...state.mocks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function fullMocks(state: AppState): Mock[] {
  return sortedMocks(state).filter((m) => m.kind === 'full');
}

export function sectionals(state: AppState): Mock[] {
  return sortedMocks(state).filter((m) => m.kind === 'sectional');
}

export function latestFullMock(state: AppState): Mock | undefined {
  const list = fullMocks(state);
  return list[list.length - 1];
}

export function unanalysedMocks(state: AppState): Mock[] {
  return sortedMocks(state).filter((m) => !m.analysed);
}

/** Percentile history for a section, drawn from full mocks and sectionals. */
export function sectionPercentileHistory(
  state: AppState,
  section: SectionKey,
): { date: ISODate; percentile: number }[] {
  const points: { date: ISODate; percentile: number }[] = [];
  for (const m of sortedMocks(state)) {
    const s = m.sections[section];
    if (s && Number.isFinite(s.percentile) && s.percentile > 0) {
      points.push({ date: m.date, percentile: s.percentile });
    }
  }
  return points;
}

export function overallPercentileHistory(state: AppState): { date: ISODate; percentile: number }[] {
  return fullMocks(state)
    .filter((m) => typeof m.overallPercentile === 'number' && m.overallPercentile > 0)
    .map((m) => ({ date: m.date, percentile: m.overallPercentile as number }));
}

/* ------------------------------------------------------------------ */
/* Practice + accuracy                                                 */
/* ------------------------------------------------------------------ */

export interface TopicStat {
  topicId: ID;
  name: string;
  section: SectionKey;
  area: string;
  attempted: number;
  correct: number;
  accuracy: number | null;
  timeMin: number;
  avgSecPerQuestion: number | null;
  errorCount: number;
  status: Topic['status'];
  weight: number;
}

export function topicStats(state: AppState): TopicStat[] {
  const byTopic = new Map<ID, TopicStat>();
  for (const topic of state.topics) {
    byTopic.set(topic.id, {
      topicId: topic.id,
      name: topic.name,
      section: topic.section,
      area: topic.area,
      attempted: 0,
      correct: 0,
      accuracy: null,
      timeMin: 0,
      avgSecPerQuestion: null,
      errorCount: 0,
      status: topic.status,
      weight: topic.weight,
    });
  }
  for (const p of state.practice) {
    if (!p.topicId) continue;
    const stat = byTopic.get(p.topicId);
    if (!stat) continue;
    stat.attempted += p.attempted;
    stat.correct += p.correct;
    stat.timeMin += p.timeMin;
  }
  for (const e of state.errors) {
    if (!e.topicId) continue;
    const stat = byTopic.get(e.topicId);
    if (stat) stat.errorCount += 1;
  }
  for (const stat of byTopic.values()) {
    stat.accuracy = stat.attempted > 0 ? stat.correct / stat.attempted : null;
    stat.avgSecPerQuestion = stat.attempted > 0 ? (stat.timeMin * 60) / stat.attempted : null;
  }
  return [...byTopic.values()];
}

export interface SectionStat {
  section: SectionKey;
  attempted: number;
  correct: number;
  accuracy: number | null;
  timeMin: number;
  sessions: number;
  setsAttempted: number;
  setsSolved: number;
  avgSetMin: number | null;
}

export function sectionStats(state: AppState, sinceDays?: number, today?: ISODate): Record<SectionKey, SectionStat> {
  const cutoff = sinceDays && today ? addDays(today, -sinceDays) : null;
  const base = {} as Record<SectionKey, SectionStat>;
  for (const s of SECTIONS) {
    base[s] = {
      section: s,
      attempted: 0,
      correct: 0,
      accuracy: null,
      timeMin: 0,
      sessions: 0,
      setsAttempted: 0,
      setsSolved: 0,
      avgSetMin: null,
    };
  }
  for (const p of state.practice) {
    if (cutoff && p.date < cutoff) continue;
    const s = base[p.section];
    if (!s) continue;
    s.attempted += p.attempted;
    s.correct += p.correct;
    s.timeMin += p.timeMin;
    s.sessions += 1;
    s.setsAttempted += p.setsAttempted ?? 0;
    s.setsSolved += p.setsSolved ?? 0;
  }
  for (const s of SECTIONS) {
    const stat = base[s];
    stat.accuracy = stat.attempted > 0 ? stat.correct / stat.attempted : null;
    stat.avgSetMin = stat.setsAttempted > 0 ? stat.timeMin / stat.setsAttempted : null;
  }
  return base;
}

/** 0-1 fraction of the section's weighted topic mass that is at least practised. */
export function coverageBySection(state: AppState): Record<SectionKey, number> {
  const out = {} as Record<SectionKey, number>;
  const statusWeight: Record<Topic['status'], number> = {
    'not-started': 0,
    learning: 0.35,
    practised: 0.7,
    strong: 1,
    skipped: 1,
  };
  for (const s of SECTIONS) {
    const topics = state.topics.filter((t) => t.section === s);
    const total = topics.reduce((acc, t) => acc + t.weight, 0);
    if (total === 0) {
      out[s] = 0;
      continue;
    }
    const covered = topics.reduce((acc, t) => acc + t.weight * statusWeight[t.status], 0);
    out[s] = covered / total;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export function openErrors(state: AppState): ErrorEntry[] {
  return state.errors.filter((e) => !e.resolved);
}

export function errorsDueForReview(state: AppState, today: ISODate): ErrorEntry[] {
  return openErrors(state).filter((e) => !e.revisitDate || e.revisitDate <= today);
}

/** Recurrence = repeated error types within a section over the recent window. */
export function errorRecurrence(state: AppState, section: SectionKey, today: ISODate, windowDays = 28): number {
  const cutoff = addDays(today, -windowDays);
  const recent = state.errors.filter((e) => e.section === section && e.date >= cutoff);
  if (recent.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const e of recent) counts.set(e.errorType, (counts.get(e.errorType) ?? 0) + 1);
  const repeated = [...counts.values()].filter((c) => c >= 2).reduce((a, c) => a + c, 0);
  return repeated / recent.length;
}

export function errorCountsByType(state: AppState): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of state.errors) counts.set(e.errorType, (counts.get(e.errorType) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Weakness                                                            */
/* ------------------------------------------------------------------ */

/**
 * Weakness per section on 0-1 (1 = weakest / most in need of attention).
 * Blends mock percentile gap, practice accuracy, coverage and error recurrence
 * so the score still means something before any mock exists.
 */
export function weaknessScores(state: AppState, today: ISODate): Record<SectionKey, number> {
  const target = state.profile.targetPercentile;
  const coverage = coverageBySection(state);
  const stats = sectionStats(state);
  const out = {} as Record<SectionKey, number>;

  for (const section of SECTIONS) {
    const history = sectionPercentileHistory(state, section);
    const latest = history[history.length - 1]?.percentile;
    const parts: { value: number; weight: number }[] = [];

    if (typeof latest === 'number') {
      // Gap to target, normalised over a 40-percentile span.
      parts.push({ value: clamp01((target - latest) / 40), weight: 3 });
    }
    const acc = stats[section].accuracy;
    if (acc !== null && stats[section].attempted >= 15) {
      // Below 60% accuracy is weak; above 85% is strong.
      parts.push({ value: clamp01((0.85 - acc) / 0.35), weight: 2 });
    }
    parts.push({ value: clamp01(1 - coverage[section]), weight: 1.5 });
    parts.push({ value: errorRecurrence(state, section, today), weight: 1 });

    const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
    out[section] = totalWeight === 0 ? 0.5 : parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
  }
  return out;
}

export function weakestSection(state: AppState, today: ISODate): SectionKey {
  const scores = weaknessScores(state, today);
  return SECTIONS.reduce((best, s) => (scores[s] > scores[best] ? s : best), SECTIONS[0]);
}

/**
 * Whether the sections are actually distinguishable yet. With no mock and no
 * practice every section scores identically, and naming a "weakest" one would
 * be arbitrary rather than informative.
 */
export function weaknessIsMeaningful(state: AppState, today: ISODate): boolean {
  const scores = weaknessScores(state, today);
  const values = SECTIONS.map((s) => scores[s]);
  return Math.max(...values) - Math.min(...values) > 0.05;
}

/* ------------------------------------------------------------------ */
/* Small maths helpers                                                 */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Least-squares slope/intercept of y over x. */
export function linearFit(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

/** Fit percentile against weeks elapsed; returns slope in percentile/week. */
export function weeklySlope(history: { date: ISODate; percentile: number }[]): number {
  if (history.length < 2) return 0;
  const base = history[0].date;
  return linearFit(
    history.map((h) => ({ x: daysBetween(base, h.date) / 7, y: h.percentile })),
  ).slope;
}

export function daysToExam(state: AppState, today: ISODate): number {
  return Math.max(0, daysBetween(today, state.profile.examDate));
}
