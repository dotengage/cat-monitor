/**
 * Monthly strategy layer.
 *
 * Milestones are calculated, never hardcoded. "Finish 14 chapters in
 * September" is a fiction; what the month can actually contain is a function of
 * capacity, current weakness, coverage debt and the mock cadence.
 */
import { SECTION_LABELS } from '../config/catConfig';
import { addDays, daysBetween, formatHours, fromISODate, monthKey, monthName, toISODate } from '../domain/date';
import type { AppState, ISODate, MonthlyStrategy } from '../domain/types';
import { sustainableWeeklyMin } from './capacity';
import { coverageBySection, daysToExam, fullMocks, openErrors, unanalysedMocks, weaknessScores } from './derive';
import { preparationPhase, recommendedMockCadence } from './readiness';
import { projectRemainingWorkload } from './workload';

function endOfMonth(date: ISODate): ISODate {
  const d = fromISODate(date);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

const PHASE_OBJECTIVES: Record<MonthlyStrategy['phase'], string> = {
  FOUNDATION:
    'Build foundation, establish baseline, identify weaknesses and get the preparation system itself working.',
  APPLICATION:
    'High-volume application, sectional improvement, increasing mock exposure and closing the major weaknesses the data has identified.',
  READINESS:
    'Exam readiness: mocks, analysis, revision, weak-area repair, question selection, timing and consistency.',
};

/**
 * Percentile checkpoint for the end of the month. Improvement is front-loaded
 * (early gains come faster than the last few points), so the curve is eased
 * rather than linear. This is a checkpoint, not a prediction.
 */
export function percentileCheckpoint(state: AppState, at: ISODate): number | null {
  const mocks = fullMocks(state).filter((m) => typeof m.overallPercentile === 'number');
  const first = mocks[0];
  if (!first) return null;
  const baseline = first.overallPercentile as number;
  const target = state.profile.targetPercentile;
  const total = Math.max(1, daysBetween(first.date, state.profile.examDate));
  const elapsed = Math.max(0, daysBetween(first.date, at));
  const progress = Math.min(1, elapsed / total);
  const eased = Math.pow(progress, 0.7);
  return Math.round((baseline + (target - baseline) * eased) * 10) / 10;
}

export function buildMonthlyStrategy(state: AppState, today: ISODate): MonthlyStrategy {
  const key = monthKey(today);
  const monthEnd = endOfMonth(today);
  const examDate = state.profile.examDate;
  const horizon = monthEnd < examDate ? monthEnd : examDate;
  const daysInMonthRemaining = Math.max(0, daysBetween(today, horizon) + 1);
  const weeksRemainingInMonth = Math.max(0.3, daysInMonthRemaining / 7);

  const phase = preparationPhase(state, today);
  const weeklyMin = sustainableWeeklyMin(state, today);
  const cadence = recommendedMockCadence(state, today, weeklyMin);
  const weakness = weaknessScores(state, today);
  const coverage = coverageBySection(state);
  const workload = projectRemainingWorkload(state, today);
  const weakest = (['VARC', 'DILR', 'QA'] as const).reduce((a, b) => (weakness[b] > weakness[a] ? b : a), 'VARC');

  const mocksThisMonth = fullMocks(state).filter((m) => monthKey(m.date) === key);
  const sectionalsThisMonth = state.mocks.filter((m) => m.kind === 'sectional' && monthKey(m.date) === key);
  const targetMocks = Math.max(state.mocks.length === 0 ? 1 : 0, Math.round(cadence.perWeek * weeksRemainingInMonth));
  const targetSectionals = Math.round(cadence.sectionalsPerWeek * weeksRemainingInMonth);

  // How much topic coverage this month's capacity can actually buy.
  const monthCapacityMin = Math.round((weeklyMin * daysInMonthRemaining) / 7);
  const learningShare = phase === 'FOUNDATION' ? 0.45 : phase === 'APPLICATION' ? 0.25 : 0.1;
  const avgTopicMin = 90;
  const affordableTopics = Math.max(0, Math.floor((monthCapacityMin * learningShare) / avgTopicMin));
  const coveredNow = state.topics.filter((t) => t.status === 'practised' || t.status === 'strong').length;

  const monthDoneMin = state.tasks
    .filter((t) => t.status === 'done' && t.date && monthKey(t.date) === key)
    .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);

  const checkpoint = percentileCheckpoint(state, horizon);
  const latestPercentile = fullMocks(state)
    .map((m) => m.overallPercentile)
    .filter((p): p is number => typeof p === 'number')
    .pop();

  const keyOutcomes: string[] = [];
  const projects: string[] = [];
  const completionRequirements: string[] = [];

  if (state.mocks.length === 0) {
    keyOutcomes.push('Baseline mock completed, recorded and analysed');
    keyOutcomes.push('Section-level weaknesses identified for VARC, DILR and QA');
    keyOutcomes.push('Realistic weekly capacity established from 7+ days of logged data');
    keyOutcomes.push('Error log active with every mistake classified');
    completionRequirements.push('A baseline mock must exist before the next month is planned - without it every projection is guesswork.');
  } else {
    keyOutcomes.push(`${targetMocks} full mock(s) attempted and fully analysed`);
    keyOutcomes.push(`${targetSectionals} sectional(s) completed, weighted towards ${SECTION_LABELS[weakest]}`);
    if (checkpoint !== null) keyOutcomes.push(`Overall mock percentile at or above ${checkpoint} by ${monthEnd}`);
    keyOutcomes.push(`${affordableTopics} topic(s) moved to practised or better`);
    keyOutcomes.push('Repeated error types reduced - every logged error revisited at least once');
    completionRequirements.push('Every mock recorded this month must be analysed before the next month is planned.');
  }

  projects.push(`Close ${SECTION_LABELS[weakest]} weakness (currently the binding constraint)`);
  if (unanalysedMocks(state).length > 0) projects.push(`Clear the analysis backlog (${unanalysedMocks(state).length} mock(s))`);
  if (coverage.QA < 0.6) projects.push('Complete high-weight QA coverage (Arithmetic and Algebra first)');
  if (phase !== 'FOUNDATION') projects.push('Write and test a one-page exam-day strategy');
  if (openErrors(state).length > 10) projects.push(`Resolve the ${openErrors(state).length} open error-log entries`);

  completionRequirements.push(
    `Weekly reviews completed for every week in the month - the next month's plan is generated from them.`,
  );
  if (workload.health === 'AT_RISK' || workload.health === 'UNSUSTAINABLE') {
    completionRequirements.push('Scope must be cut this month: the remaining workload does not fit the remaining capacity.');
  }

  const metrics: MonthlyStrategy['metrics'] = [
    {
      label: 'Full mocks completed',
      target: String(targetMocks),
      actual: String(mocksThisMonth.length),
      met: mocksThisMonth.length >= targetMocks,
    },
    {
      label: 'Mocks analysed',
      target: String(mocksThisMonth.length),
      actual: String(mocksThisMonth.filter((m) => m.analysed).length),
      met: mocksThisMonth.every((m) => m.analysed),
    },
    {
      label: 'Sectionals completed',
      target: String(targetSectionals),
      actual: String(sectionalsThisMonth.length),
      met: sectionalsThisMonth.length >= targetSectionals,
    },
    {
      label: 'Topics at practised or better',
      target: String(coveredNow + affordableTopics),
      actual: String(coveredNow),
      met: false,
    },
    {
      label: 'Focused hours this month',
      target: formatHours(monthCapacityMin, 0),
      actual: formatHours(monthDoneMin, 0),
      met: monthDoneMin >= monthCapacityMin * 0.85,
    },
  ];

  if (checkpoint !== null) {
    metrics.push({
      label: 'Percentile checkpoint',
      target: String(checkpoint),
      actual: latestPercentile === undefined ? 'no data' : String(latestPercentile),
      met: (latestPercentile ?? 0) >= checkpoint,
    });
  }

  const deadlines: MonthlyStrategy['deadlines'] = [
    { label: 'CAT 2026', date: examDate },
    { label: 'End of month checkpoint', date: horizon },
  ];
  if (state.mocks.length > 0) {
    deadlines.unshift({ label: 'Next recommended mock', date: cadence.nextRecommendedDate });
  } else {
    deadlines.unshift({ label: 'Baseline mock', date: addDays(today, Math.min(6, daysToExam(state, today))) });
  }

  return {
    monthKey: key,
    label: `${monthName(today)} ${fromISODate(today).getFullYear()}`,
    phase,
    objective: PHASE_OBJECTIVES[phase],
    keyOutcomes,
    projects,
    metrics,
    deadlines,
    completionRequirements,
    daysInMonthRemaining,
  };
}
