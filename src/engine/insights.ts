/**
 * Adaptive insights: plain-language statements about what the system has
 * noticed and what it changed. No moralising, no productivity theatre - the
 * subject of every sentence is the plan, not the person.
 */
import { SECTION_LABELS } from '../config/catConfig';
import { formatHours } from '../domain/date';
import type { AppState, ISODate, Insight } from '../domain/types';
import { calculateWeekCapacity } from './capacity';
import { isOpen, unanalysedMocks } from './derive';
import { detectBehaviourPatterns } from './patterns';
import { calculateForecast } from './forecast';
import { calculateFeasibility } from './workload';

export function generateInsights(state: AppState, today: ISODate, weekStart: ISODate): Insight[] {
  const out: Insight[] = [];
  const feasibility = calculateFeasibility(state, today);
  const workload = feasibility.workload;
  const forecast = calculateForecast(state, today);

  /* Behaviour patterns become insights verbatim - they already carry both
     the observation and the intervention. */
  for (const pattern of detectBehaviourPatterns(state, today)) {
    out.push({
      id: `pattern:${pattern.id}`,
      text: `${pattern.detail} ${pattern.recommendation}`,
      tone: pattern.kind === 'consistency' && pattern.id === 'consistency-good' ? 'positive' : 'neutral',
      source: 'Behaviour learning',
    });
  }

  /* Capacity */
  const capacity = calculateWeekCapacity(state, weekStart, today);
  const weekLoad = state.tasks
    .filter((t) => isOpen(t) && t.weekStart === weekStart && (t.date ?? today) >= today)
    .reduce((a, t) => a + t.estimateMin, 0);
  const reachableMin = capacity.remainingPlannedMin;
  if (weekLoad > reachableMin) {
    out.push({
      id: 'capacity:over',
      text: `This week's plan exceeds the capacity still available by ${formatHours(weekLoad - reachableMin, 1)}. Lower-priority work should be removed rather than carried.`,
      tone: 'warning',
      source: 'Capacity model',
    });
  } else if (reachableMin > 0 && weekLoad < reachableMin * 0.6) {
    out.push({
      id: 'capacity:under',
      text: `Only ${Math.round((weekLoad / reachableMin) * 100)}% of the capacity still available this week is allocated. There is room to pull high-value work forward.`,
      tone: 'neutral',
      source: 'Capacity model',
    });
  }

  /* Analysis debt */
  const unanalysed = unanalysedMocks(state);
  if (unanalysed.length > 0) {
    out.push({
      id: 'mock:unanalysed',
      text: `${unanalysed.length} mock(s) are recorded but not analysed. A mock without analysis is worth less than one with it, so mock cadence has been throttled until the backlog clears.`,
      tone: 'warning',
      source: 'Mock Centre',
    });
  }

  /* Forecast */
  if (forecast.status === 'UNCONFIRMED') {
    out.push({
      id: 'forecast:unconfirmed',
      text: `Target feasibility is unconfirmed. ${forecast.recommendedAction}`,
      tone: 'neutral',
      source: 'Forecast',
    });
  } else if (forecast.cleanPaper?.consistencyHeadline) {
    out.push({
      id: 'forecast:consistency',
      text: `Your best section scores together already clear ${forecast.target}, but only ${forecast.cleanPaper.count} of ${forecast.cleanPaper.n} papers had every section above the floor. Consistency, not new material, is the lever.`,
      tone: 'warning',
      source: 'Forecast',
    });
  } else if (forecast.trend.label === 'RISING' && forecast.status !== 'ON_TRACK') {
    const lead = forecast.constraint.top[0];
    out.push({
      id: 'forecast:rising',
      text: `Marks are rising with a 90% interval that excludes zero${lead ? `, and ${SECTION_LABELS[lead.section]} is the binding constraint` : ''}.`,
      tone: 'neutral',
      source: 'Forecast',
    });
  } else if (forecast.status === 'ON_TRACK') {
    out.push({
      id: 'forecast:on-track',
      text: 'The likely exam-day percentile is within a point of the target. Protect consistency and analysis rather than adding new material.',
      tone: 'positive',
      source: 'Forecast',
    });
  } else if (forecast.trend.label === 'VOLATILE') {
    out.push({
      id: 'forecast:volatile',
      text: 'Marks swing by 8 or more between recent papers with no clear direction. Consistency of question selection is a bigger lever right now than new topics.',
      tone: 'warning',
      source: 'Forecast',
    });
  }

  /* Workload */
  if (feasibility.safety.breached) {
    out.push({
      id: 'workload:breach',
      text: feasibility.safety.message,
      tone: workload.health === 'UNSUSTAINABLE' ? 'critical' : 'warning',
      source: 'Workload model',
    });
  } else if (workload.health === 'COMFORTABLE' && workload.actualPerWeekMin > 0) {
    out.push({
      id: 'workload:ok',
      text: `Required pace is ${formatHours(workload.requiredPerWeekMin, 1)} per week against ${formatHours(workload.realisticPerWeekMin, 1)} of realistic capacity. Capacity appears sustainable.`,
      tone: 'positive',
      source: 'Workload model',
    });
  }

  /* Binding constraint - only once it can be named from enough mocks */
  const lead = forecast.constraint.top[0];
  if (forecast.constraint.established && lead) {
    out.push({
      id: `constraint:${lead.section}`,
      text: `${SECTION_LABELS[lead.section]} is the binding constraint: ${lead.why}`,
      tone: 'warning',
      source: 'Forecast',
    });
  }

  return out.filter((i) => !state.dismissedInsights.includes(i.id));
}
