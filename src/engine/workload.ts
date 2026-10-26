/**
 * Remaining-workload model and the critical safety check.
 *
 * The point of this module is to make the arithmetic between "what is left to
 * do" and "what time actually exists" impossible to ignore. When the two do not
 * reconcile, the app says so in plain language instead of compressing reality.
 */
import { daysBetween, formatHours } from '../domain/date';
import type {
  AppState,
  ISODate,
  RemainingWorkload,
  TrackStatus,
  WorkloadHealth,
} from '../domain/types';
import { capacityBetween, sustainableWeeklyMin } from './capacity';
import { backlogTasks, clamp, isOpen, mean, unanalysedMocks } from './derive';
import { calculateForecast, encouragement, TREND_WORDS } from './forecast';
import { recommendedMockCadence } from './readiness';

const STATUS_COVERAGE_WEIGHT: Record<string, number> = {
  'not-started': 1,
  learning: 0.65,
  practised: 0.3,
  strong: 0,
  skipped: 0,
};

export function projectRemainingWorkload(state: AppState, today: ISODate): RemainingWorkload {
  const params = state.settings.planning;
  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));
  const weeksRemaining = Math.max(0.5, daysRemaining / 7);

  const weeklyCapacity = sustainableWeeklyMin(state, today);
  const cadence = recommendedMockCadence(state, today, weeklyCapacity);

  /* --- 1. Work already written down ------------------------------- */
  const openTasks = state.tasks.filter(isOpen);
  const openTaskMin = openTasks.reduce((a, t) => a + t.estimateMin, 0);
  const scheduledMocks = openTasks.filter((t) => t.type === 'mock').length;
  const scheduledSectionals = openTasks.filter((t) => t.type === 'sectional').length;

  /* --- 2. Topic coverage still owed -------------------------------- */
  const topicCoverageMin = state.topics.reduce((acc, topic) => {
    const remainingShare = STATUS_COVERAGE_WEIGHT[topic.status] ?? 1;
    if (remainingShare === 0) return acc;
    // Low-weight topics are only partially budgeted - they are the first
    // candidates to be cut if capacity runs short.
    const weightScale = clamp(topic.weight / 5, 0.4, 1);
    return acc + topic.baseHours * 60 * remainingShare * weightScale;
  }, 0);

  /* --- 3. Mocks + sectionals still to come ------------------------- */
  const projectedMocks = Math.max(0, Math.round(cadence.perWeek * weeksRemaining) - scheduledMocks);
  const mockMin = projectedMocks * (params.fullMockMin + params.mockAnalysisMin);
  const projectedSectionals = Math.max(
    0,
    Math.round(cadence.sectionalsPerWeek * weeksRemaining) - scheduledSectionals,
  );
  const sectionalMin = projectedSectionals * (params.sectionalMin + params.sectionalAnalysisMin);

  /* --- 4. Debt already accrued ------------------------------------- */
  const analysisBacklogMin = unanalysedMocks(state).length * params.mockAnalysisMin;

  /* --- 5. Revision of what is already covered ---------------------- */
  const coveredTopics = state.topics.filter((t) => t.status === 'practised' || t.status === 'strong').length;
  const revisionRounds = daysRemaining > 60 ? 1 : daysRemaining > 25 ? 1.5 : 2;
  const revisionMin = coveredTopics * params.topicRevisionMin * revisionRounds;

  const breakdown = [
    { label: 'Scheduled and backlog tasks', min: Math.round(openTaskMin) },
    { label: 'Topic coverage still owed', min: Math.round(topicCoverageMin) },
    { label: 'Mocks + analysis', min: Math.round(mockMin) },
    { label: 'Sectionals + analysis', min: Math.round(sectionalMin) },
    { label: 'Mock analysis backlog', min: Math.round(analysisBacklogMin) },
    { label: 'Revision', min: Math.round(revisionMin) },
  ].filter((b) => b.min > 0);

  const remainingMin = breakdown.reduce((a, b) => a + b.min, 0);

  /* --- 6. What has already been converted into work ---------------- */
  const completedMin =
    state.tasks
      .filter((t) => t.status === 'done' || t.status === 'partial')
      .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0) +
    state.practice.filter((p) => !p.taskId).reduce((a, p) => a + p.timeMin, 0);

  const requiredPerWeekMin = Math.round(remainingMin / weeksRemaining);
  const realisticPerWeekMin = weeklyCapacity;
  const actualPerWeekMin = recentActualWeeklyMin(state);
  const totalAvailableMin = capacityBetween(state, today, state.profile.examDate, today);
  const surplusMin = Math.round(totalAvailableMin - remainingMin);

  const ratio = realisticPerWeekMin > 0 ? requiredPerWeekMin / realisticPerWeekMin : Infinity;
  let health: WorkloadHealth;
  if (ratio <= 0.8) health = 'COMFORTABLE';
  else if (ratio <= 1.0) health = 'TIGHT';
  else if (ratio <= 1.25) health = 'AT_RISK';
  else health = 'UNSUSTAINABLE';

  return {
    totalMin: Math.round(remainingMin + completedMin),
    completedMin: Math.round(completedMin),
    remainingMin,
    weeksRemaining: Math.round(weeksRemaining * 10) / 10,
    requiredPerWeekMin,
    actualPerWeekMin,
    realisticPerWeekMin,
    surplusMin,
    health,
    breakdown,
  };
}

function recentActualWeeklyMin(state: AppState): number {
  const records = [...state.capacityRecords]
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, 4)
    .filter((r) => r.actualMin > 0);
  if (records.length === 0) return 0;
  return Math.round(mean(records.map((r) => r.actualMin)));
}

/* ------------------------------------------------------------------ */
/* Critical safety check                                               */
/* ------------------------------------------------------------------ */

export interface SafetyCheck {
  breached: boolean;
  severity: 'ok' | 'warn' | 'critical';
  message: string;
  suggestions: string[];
  requiredHours: number;
  availableHours: number;
}

export function criticalSafetyCheck(state: AppState, today: ISODate): SafetyCheck {
  const workload = projectRemainingWorkload(state, today);
  const availableMin = capacityBetween(state, today, state.profile.examDate, today);
  const requiredHours = Math.round(workload.remainingMin / 60);
  const availableHours = Math.round(availableMin / 60);
  const weeklyHours = Math.round((workload.realisticPerWeekMin / 60) * 10) / 10;

  if (workload.health === 'COMFORTABLE' || workload.health === 'TIGHT') {
    return {
      breached: false,
      severity: 'ok',
      message: `Identified work is about ${requiredHours} focused hours. At a sustainable ${weeklyHours}h per week, roughly ${availableHours} hours are realistically available before the exam. The plan reconciles.`,
      suggestions: [],
      requiredHours,
      availableHours,
    };
  }

  const deficit = requiredHours - availableHours;
  return {
    breached: true,
    severity: workload.health === 'UNSUSTAINABLE' ? 'critical' : 'warn',
    message:
      `Your current plan requires approximately ${requiredHours} focused hours before CAT. At your current sustainable capacity of ${weeklyHours} hours per week, only about ${availableHours} hours are realistically available. ` +
      (deficit > 0 ? `That is roughly ${deficit} hours more than fits, so the plan needs trimming to match.` : 'The margin is thin, so keep the buffer free for the unexpected.'),
    suggestions: [
      'Drop the lowest-weight topics entirely rather than half-covering them.',
      'Reduce or pause P2/P3 goals until the gap closes.',
      'Raise weekly capacity temporarily - but only if it is genuinely sustainable, not aspirational.',
      'Prioritise the weakest section and repeated error patterns; both return more percentile per hour than new topics.',
      'Cut sectional volume before cutting mock analysis - analysis is where percentile actually moves.',
    ],
    requiredHours,
    availableHours,
  };
}

/* ------------------------------------------------------------------ */
/* Combined feasibility                                                */
/* ------------------------------------------------------------------ */

export interface Feasibility {
  status: TrackStatus;
  headline: string;
  reason: string;
  nextAction: string;
  workload: RemainingWorkload;
  safety: SafetyCheck;
  inputs: { label: string; value: string }[];
}

/** The forecast's ladder, worst last. Capacity can only move a status down it. */
const LADDER: TrackStatus[] = ['ON_TRACK', 'STRETCH', 'AT_RISK', 'OFF_TRACK'];

function worsen(status: TrackStatus): TrackStatus {
  const i = LADDER.indexOf(status);
  return i < 0 ? status : LADDER[Math.min(LADDER.length - 1, i + 1)];
}

/**
 * The goal feasibility engine: the forecast's rule-based status, corrected by
 * whether the remaining workload can actually fit in the remaining capacity.
 */
export function calculateFeasibility(state: AppState, today: ISODate): Feasibility {
  const forecast = calculateForecast(state, today);
  const workload = projectRemainingWorkload(state, today);
  const safety = criticalSafetyCheck(state, today);
  const target = state.profile.targetPercentile;

  let status = forecast.status;
  const reasons: string[] = [];
  if (forecast.forecast?.percentile && forecast.forecast.probability !== undefined) {
    const p = forecast.forecast.percentile;
    reasons.push(`Likely exam-day percentile ${round(p.p50)}; chance of ${target}: ${chance(forecast.forecast.probability)}.`);
  } else {
    reasons.push(forecast.statusRule);
  }

  // Capacity can only make the picture worse, never better.
  if (status !== 'UNCONFIRMED') {
    if (workload.health === 'UNSUSTAINABLE') {
      const before = status;
      status = worsen(status);
      if (status !== before) {
        reasons.push('The plan holds more work than your available hours, so trimming it is the quickest win.');
      }
    } else if (workload.health === 'AT_RISK' && status === 'ON_TRACK') {
      reasons.push('Your hours are fully used: protect the buffer rather than adding more.');
    }
  }

  const headline = encouragement(status, target, forecast.forecast?.percentile?.p50);

  const level = forecast.level;
  const lead = forecast.constraint.top[0];
  const inputs: { label: string; value: string }[] = [
    { label: 'Days remaining', value: String(forecast.daysRemaining) },
    { label: 'Full mocks with marks', value: `${forecast.n} of ${forecast.fullMocks}` },
    { label: 'Unanalysed mocks', value: String(unanalysedMocks(state).length) },
    {
      label: 'Current level',
      value: !level
        ? 'not recorded'
        : level.percentile !== undefined
          ? `${round(level.marks)} marks (about ${round(level.percentile)} percentile)`
          : `${round(level.marks)} marks`,
    },
    { label: 'Trend', value: TREND_WORDS[forecast.trend.label].toLowerCase() },
    { label: 'Focus area', value: lead ? lead.section : 'not yet clear' },
    { label: 'Remaining workload', value: formatHours(workload.remainingMin, 0) },
    { label: 'Required per week', value: formatHours(workload.requiredPerWeekMin, 1) },
    { label: 'Realistic per week', value: formatHours(workload.realisticPerWeekMin, 1) },
    { label: 'Actual per week (recent)', value: workload.actualPerWeekMin ? formatHours(workload.actualPerWeekMin, 1) : 'not recorded' },
    { label: 'Backlog items', value: String(backlogTasks(state).length) },
  ];

  return {
    status,
    headline,
    reason: reasons.join(' '),
    nextAction: forecast.recommendedAction,
    workload,
    safety,
    inputs,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function chance(share: number): string {
  return share < 0.01 ? 'under 1%' : share > 0.99 ? 'over 99%' : `about ${Math.round(share * 100)}%`;
}
