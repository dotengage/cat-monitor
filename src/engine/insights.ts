/**
 * Adaptive insights: plain-language statements about what the system has
 * noticed and what it changed. No moralising, no productivity theatre - the
 * subject of every sentence is the plan, not the person.
 */
import { SECTION_LABELS } from '../config/catConfig';
import { formatHours } from '../domain/date';
import type { AppState, ISODate, Insight } from '../domain/types';
import { calculateWeekCapacity } from './capacity';
import { isOpen, unanalysedMocks, weaknessScores } from './derive';
import { detectBehaviourPatterns } from './patterns';
import { calculateTrajectory } from './readiness';
import { calculateFeasibility } from './workload';

export function generateInsights(state: AppState, today: ISODate, weekStart: ISODate): Insight[] {
  const out: Insight[] = [];
  const feasibility = calculateFeasibility(state, today);
  const workload = feasibility.workload;
  const trajectory = calculateTrajectory(state, today);
  const weakness = weaknessScores(state, today);

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

  /* Trajectory */
  if (trajectory.status === 'UNCONFIRMED') {
    out.push({
      id: 'trajectory:unconfirmed',
      text: 'Target feasibility is unconfirmed: there is no mock evidence yet. The first baseline is the highest-value action available.',
      tone: 'neutral',
      source: 'Feasibility engine',
    });
  } else if (trajectory.trend === 'IMPROVING' && trajectory.status !== 'ON_TRACK') {
    out.push({
      id: 'trajectory:improving',
      text: `Your recent mock trend is improving, but ${SECTION_LABELS[trajectory.constraint ?? 'DILR']} remains the main constraint.`,
      tone: 'neutral',
      source: 'Feasibility engine',
    });
  } else if (trajectory.status === 'ON_TRACK') {
    out.push({
      id: 'trajectory:on-track',
      text: 'Recent mock performance has crossed the target threshold. Focus should now shift towards consistency, analysis and section balance rather than new material.',
      tone: 'positive',
      source: 'Feasibility engine',
    });
  } else if (trajectory.trend === 'VOLATILE') {
    out.push({
      id: 'trajectory:volatile',
      text: 'Mock scores are swinging widely between attempts. Consistency of question selection is a bigger lever right now than new topics.',
      tone: 'warning',
      source: 'Feasibility engine',
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

  /* Weakness */
  const weakest = (['VARC', 'DILR', 'QA'] as const).reduce((a, b) => (weakness[b] > weakness[a] ? b : a), 'VARC');
  if (weakness[weakest] > 0.6) {
    out.push({
      id: `weakness:${weakest}`,
      text: `${SECTION_LABELS[weakest]} is currently the section putting the target at most risk. Planning weight has been shifted towards it.`,
      tone: 'warning',
      source: 'Section readiness',
    });
  }

  return out.filter((i) => !state.dismissedInsights.includes(i.id));
}
