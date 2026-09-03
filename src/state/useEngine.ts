import { useMemo } from 'react';
import { calculateWeekCapacity, calculateCapacity } from '../engine/capacity';
import { detectConflicts } from '../engine/conflicts';
import { calculateAllGoalStatuses } from '../engine/goalStatus';
import { generateInsights } from '../engine/insights';
import { buildMonthlyStrategy } from '../engine/monthly';
import { detectBehaviourPatterns } from '../engine/patterns';
import { buildTodayPlan } from '../engine/priority';
import { calculateCATReadiness, recommendedMockCadence } from '../engine/readiness';
import { calculateFeasibility } from '../engine/workload';
import { useStore } from './store';

/**
 * Single memoised entry point for every derived value the UI needs.
 * Keeping this in one place means engine work happens once per state change,
 * not once per component.
 */
export function useEngine() {
  const { state, today, weekStart } = useStore();

  return useMemo(() => {
    const capacityWeek = calculateWeekCapacity(state, weekStart, today);
    const todayCapacity = calculateCapacity(state, today, { today });
    const feasibility = calculateFeasibility(state, today);
    const readiness = calculateCATReadiness(state, today);
    const todayPlan = buildTodayPlan(state, today, todayCapacity.plannedMin);
    const conflicts = detectConflicts(state, weekStart, today);
    const insights = generateInsights(state, today, weekStart);
    const goals = calculateAllGoalStatuses(state, today);
    const patterns = detectBehaviourPatterns(state, today);
    const monthly = buildMonthlyStrategy(state, today);
    const cadence = recommendedMockCadence(state, today, capacityWeek.plannedMin);

    return {
      capacityWeek,
      todayCapacity,
      feasibility,
      readiness,
      todayPlan,
      conflicts,
      insights,
      goals,
      patterns,
      monthly,
      cadence,
      workload: feasibility.workload,
      trajectory: readiness.trajectory,
    };
  }, [state, today, weekStart]);
}
