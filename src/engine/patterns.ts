/**
 * Behaviour learning.
 *
 * Looks for repeatable patterns in how the plan actually gets executed and
 * turns each into a diagnosis plus an intervention. The tone is fixed: the
 * system diagnoses itself, never the user.
 */
import { SECTION_LABELS, TASK_TYPE_LABELS, TIME_WINDOW_LABELS } from '../config/catConfig';
import { addDays } from '../domain/date';
import type { AppState, BehaviourPattern, ISODate, Task, TimeWindow } from '../domain/types';
import { buildEstimationModel } from './estimation';
import { clamp, mean } from './derive';

const WINDOWS: TimeWindow[] = ['early-morning', 'morning', 'afternoon', 'evening', 'night'];

function completionRate(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => t.status === 'done').length;
  return done / tasks.length;
}

function settled(tasks: Task[]): Task[] {
  return tasks.filter((t) => ['done', 'missed', 'partial', 'postponed'].includes(t.status));
}

export function detectBehaviourPatterns(state: AppState, today: ISODate, lookbackDays = 42): BehaviourPattern[] {
  const cutoff = addDays(today, -lookbackDays);
  const recent = settled(state.tasks).filter((t) => t.date !== null && t.date >= cutoff && t.date <= today);
  const patterns: BehaviourPattern[] = [];

  patterns.push(...detectWindowPattern(recent));
  patterns.push(...detectPostponePatterns(recent));
  patterns.push(...detectEstimationPatterns(state));
  patterns.push(...detectCapacityDrift(state));
  patterns.push(...detectConsistency(state, today));

  return patterns;
}

/* ------------------------------------------------------------------ */
/* Time-of-day completion (the "morning failure" case)                 */
/* ------------------------------------------------------------------ */

function detectWindowPattern(recent: Task[]): BehaviourPattern[] {
  const byWindow = new Map<TimeWindow, Task[]>();
  for (const t of recent) {
    if (!t.window) continue;
    byWindow.set(t.window, [...(byWindow.get(t.window) ?? []), t]);
  }
  const scored = WINDOWS.map((w) => ({
    window: w,
    tasks: byWindow.get(w) ?? [],
  })).filter((x) => x.tasks.length >= 4);

  if (scored.length < 2) return [];

  const rates = scored.map((x) => ({ ...x, rate: completionRate(x.tasks) }));
  const worst = rates.reduce((a, b) => (b.rate < a.rate ? b : a));
  const best = rates.reduce((a, b) => (b.rate > a.rate ? b : a));

  if (worst.window === best.window) return [];
  if (worst.tasks.length < 6) return [];
  if (worst.rate >= 0.55) return [];
  if (best.rate - worst.rate < 0.25) return [];

  const isMorning = worst.window === 'morning' || worst.window === 'early-morning';
  return [
    {
      id: `window-failure:${worst.window}`,
      kind: isMorning ? 'morning-failure' : 'repeated-postpone',
      title: `${TIME_WINDOW_LABELS[worst.window]} tasks are not landing`,
      detail:
        `${Math.round(worst.rate * 100)}% of tasks scheduled in the ${TIME_WINDOW_LABELS[worst.window].toLowerCase()} ` +
        `window were completed across ${worst.tasks.length} attempts, against ` +
        `${Math.round(best.rate * 100)}% in the ${TIME_WINDOW_LABELS[best.window].toLowerCase()} window.`,
      recommendation:
        `Deep-work tasks are being moved to your historically stronger study window ` +
        `(${TIME_WINDOW_LABELS[best.window].toLowerCase()}). Lower-friction work stays where it is.`,
      confidence: worst.tasks.length >= 10 ? 'high' : 'medium',
      samples: worst.tasks.length,
      data: { worstWindow: worst.window, bestWindow: best.window, worstRate: worst.rate, bestRate: best.rate },
    },
  ];
}

/** The window the planner should prefer for high-energy work, if any. */
export function preferredWindow(state: AppState, today: ISODate): TimeWindow | undefined {
  const pattern = detectBehaviourPatterns(state, today).find((p) => p.kind === 'morning-failure');
  const best = pattern?.data?.bestWindow;
  return typeof best === 'string' ? (best as TimeWindow) : undefined;
}

/* ------------------------------------------------------------------ */
/* Repeatedly postponed work                                           */
/* ------------------------------------------------------------------ */

function detectPostponePatterns(recent: Task[]): BehaviourPattern[] {
  const groups = new Map<string, Task[]>();
  for (const t of recent) {
    const key = `${t.type}|${t.section ?? 'general'}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const out: BehaviourPattern[] = [];
  for (const [key, tasks] of groups) {
    const postponements = tasks.reduce((a, t) => a + t.postponeCount, 0);
    const misses = tasks.filter((t) => t.status === 'missed' || t.status === 'postponed').length;
    if (postponements < 3 && misses < 3) continue;
    if (tasks.length < 3) continue;

    const [type, section] = key.split('|');
    const label =
      section === 'general'
        ? TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] ?? type
        : `${SECTION_LABELS[section as 'VARC' | 'DILR' | 'QA'] ?? section} ${(
            TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] ?? type
          ).toLowerCase()}`;

    const avgEstimate = mean(tasks.map((t) => t.estimateMin));
    const avgEnergy = mean(tasks.map((t) => t.energyRequired));
    const optionalShare = tasks.filter((t) => t.importance === 'optional').length / tasks.length;

    let cause: string;
    let intervention: string;
    if (avgEstimate >= 75) {
      cause = `these blocks average ${Math.round(avgEstimate)} minutes, which is large enough to feel unstartable`;
      intervention = 'Future blocks of this kind are being split into smaller, immediately startable units.';
    } else if (avgEnergy >= 4) {
      cause = 'they demand high cognitive energy and keep landing on lower-energy slots';
      intervention = 'These are being moved to your highest-energy day of the week.';
    } else if (optionalShare >= 0.5) {
      cause = 'most of them are optional, so they lose every scheduling contest';
      intervention = 'Optional items in this group are being removed rather than carried forward indefinitely.';
    } else {
      cause = 'the task description is probably too vague to start from';
      intervention = 'Future tasks of this kind will be generated with an explicit question count and time cap.';
    }

    out.push({
      id: `postpone:${key}`,
      kind: 'repeated-postpone',
      title: `${label} keeps getting postponed`,
      detail: `${postponements} postponement${postponements === 1 ? '' : 's'} across ${tasks.length} tasks. Most likely cause: ${cause}.`,
      recommendation: intervention,
      confidence: postponements >= 5 ? 'high' : 'medium',
      samples: tasks.length,
      data: { postponements, avgEstimate: Math.round(avgEstimate), avgEnergy: Math.round(avgEnergy * 10) / 10 },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Estimation drift                                                    */
/* ------------------------------------------------------------------ */

function detectEstimationPatterns(state: AppState): BehaviourPattern[] {
  const params = state.settings.planning;
  const model = buildEstimationModel(state, params);
  const out: BehaviourPattern[] = [];

  for (const stats of model.values()) {
    if (stats.key === '*') continue;
    if (stats.samples < params.estimationMinSamples) continue;
    const drift = stats.factor - 1;
    if (Math.abs(drift) < 0.15) continue;

    const [type, section] = stats.key.split('|');
    const label = section
      ? `${SECTION_LABELS[section as 'VARC' | 'DILR' | 'QA'] ?? section} ${(TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] ?? type).toLowerCase()}`
      : TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] ?? type;
    const pct = Math.round(Math.abs(drift) * 100);

    out.push({
      id: `estimate:${stats.key}`,
      kind: drift > 0 ? 'underestimation' : 'overestimation',
      title:
        drift > 0
          ? `${label} sessions run ${pct}% longer than estimated`
          : `${label} sessions finish ${pct}% faster than estimated`,
      detail: `Across ${stats.samples} completed sessions the average estimate was ${stats.meanEstimateMin} minutes and the average actual was ${stats.meanActualMin} minutes.`,
      recommendation:
        drift > 0
          ? 'Future blocks of this type are being sized upward gradually so the week stays honest.'
          : 'Future blocks of this type are being sized down, and the freed capacity goes to the highest-value pending work - not to filler.',
      confidence: stats.confidence,
      samples: stats.samples,
      data: { factor: Math.round(stats.factor * 100) / 100 },
    });
  }

  const fast = out.find((p) => p.kind === 'overestimation');
  if (fast) fast.kind = 'fast-completion';
  return out;
}

/* ------------------------------------------------------------------ */
/* Capacity drift + consistency                                        */
/* ------------------------------------------------------------------ */

function detectCapacityDrift(state: AppState): BehaviourPattern[] {
  const records = [...state.capacityRecords]
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .slice(-4)
    .filter((r) => r.plannedMin > 0);
  if (records.length < 2) return [];

  const ratios = records.map((r) => clamp(r.actualMin / r.plannedMin, 0, 2));
  const avg = mean(ratios);
  const improving = ratios.length >= 3 && ratios[ratios.length - 1] > ratios[0] + 0.15;

  if (avg < 0.7) {
    const sustainable = Math.round(mean(records.map((r) => r.actualMin)) / 6) / 10;
    return [
      {
        id: 'capacity-drift-low',
        kind: 'capacity-drift',
        title: 'Planned volume is running ahead of real capacity',
        detail: `Across the last ${records.length} weeks you completed ${Math.round(avg * 100)}% of planned volume. Demonstrated sustainable capacity looks closer to ${sustainable}h per week.`,
        recommendation: 'Next week is being planned against demonstrated capacity rather than the original estimate.',
        confidence: records.length >= 3 ? 'high' : 'medium',
        samples: records.length,
        data: { ratio: Math.round(avg * 100) / 100, sustainableHours: sustainable },
      },
    ];
  }

  if (avg > 0.92 && improving) {
    return [
      {
        id: 'capacity-drift-high',
        kind: 'capacity-drift',
        title: 'Capacity estimates look conservative',
        detail: `Completion has risen across the last ${records.length} weeks and now averages ${Math.round(avg * 100)}% of planned volume.`,
        recommendation: 'Planned volume is being increased gradually, with buffer preserved.',
        confidence: 'medium',
        samples: records.length,
        data: { ratio: Math.round(avg * 100) / 100 },
      },
    ];
  }
  return [];
}

function detectConsistency(state: AppState, today: ISODate): BehaviourPattern[] {
  const start = addDays(today, -13);
  const days = new Set(
    state.tasks
      .filter((t) => t.status === 'done' && t.date && t.date >= start && t.date <= today)
      .map((t) => t.date as string),
  );
  if (days.size === 0) return [];
  const rate = days.size / 14;
  if (rate >= 0.7) {
    return [
      {
        id: 'consistency-good',
        kind: 'consistency',
        title: 'Study rhythm is holding',
        detail: `You completed work on ${days.size} of the last 14 days.`,
        recommendation: 'Consistency is the input the target depends on most. Keep the rhythm rather than chasing volume spikes.',
        confidence: 'medium',
        samples: days.size,
      },
    ];
  }
  if (rate <= 0.35) {
    return [
      {
        id: 'consistency-low',
        kind: 'consistency',
        title: 'Work is arriving in bursts',
        detail: `Only ${days.size} of the last 14 days contain completed work.`,
        recommendation: 'Daily plans are being reduced to one small, immediately startable task so the streak can restart.',
        confidence: 'medium',
        samples: days.size,
      },
    ];
  }
  return [];
}
