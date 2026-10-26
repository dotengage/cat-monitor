/**
 * Mock cadence and preparation phase.
 *
 * Readiness, trajectory and the forecast itself live in `./forecast`, which
 * works in marks and follows the forecasting guide. What remains here is
 * scheduling: how often to sit a mock, and which phase of preparation the
 * calendar puts you in.
 */
import { PHASE_THRESHOLDS } from '../config/catConfig';
import { addDays, daysBetween } from '../domain/date';
import type { AppState, ISODate } from '../domain/types';
import { daysToExam, fullMocks, unanalysedMocks } from './derive';

/* ------------------------------------------------------------------ */
/* Mock cadence                                                        */
/* ------------------------------------------------------------------ */

export interface MockCadence {
  perWeek: number;
  reason: string;
  nextRecommendedDate: ISODate;
  sectionalsPerWeek: number;
  analysisBacklog: number;
}

/**
 * Mock frequency is derived, never hardcoded. A mock without analysis is worth
 * less than a mock with analysis, so an analysis backlog throttles the cadence.
 */
export function recommendedMockCadence(state: AppState, today: ISODate, weeklyCapacityMin: number): MockCadence {
  const daysRemaining = daysToExam(state, today);
  const mocks = fullMocks(state);
  const backlog = unanalysedMocks(state).length;
  const params = state.settings.planning;
  const mockCost = params.fullMockMin + params.mockAnalysisMin;

  let perWeek: number;
  let reason: string;

  if (mocks.length === 0) {
    perWeek = 1;
    reason = 'No baseline exists yet - one full mock is the highest-value action available.';
  } else if (daysRemaining > PHASE_THRESHOLDS.foundation) {
    perWeek = 0.5;
    reason = 'Foundation phase: one mock per fortnight is enough to track the trend while concepts are still being built.';
  } else if (daysRemaining > PHASE_THRESHOLDS.application) {
    perWeek = 1;
    reason = 'Application phase: weekly mocks with full analysis, supported by sectionals.';
  } else {
    perWeek = 2;
    reason = 'Readiness phase: mock exposure and analysis are now the main lever.';
  }

  if (backlog >= 2) {
    perWeek = Math.min(perWeek, 0.5);
    reason = `${backlog} mocks are still unanalysed. Cadence is reduced until the analysis backlog is cleared - an unanalysed mock adds little.`;
  }

  // Never plan more mocks than the week can actually absorb (mock + analysis).
  const affordable = weeklyCapacityMin > 0 ? Math.floor((weeklyCapacityMin * 0.55) / mockCost) : 0;
  if (mocks.length > 0 && affordable < perWeek) {
    perWeek = Math.max(0.5, affordable);
    reason += ` Weekly capacity supports about ${affordable} full mock${affordable === 1 ? '' : 's'} including analysis.`;
  }

  const lastMock = mocks[mocks.length - 1];
  const gapDays = perWeek >= 2 ? 3 : perWeek >= 1 ? 7 : 14;
  const nextRecommendedDate = lastMock ? addDays(lastMock.date, gapDays) : today;

  const sectionalsPerWeek =
    daysRemaining > PHASE_THRESHOLDS.foundation ? 2 : daysRemaining > PHASE_THRESHOLDS.application ? 3 : 2;

  return {
    perWeek,
    reason,
    nextRecommendedDate: nextRecommendedDate < today ? today : nextRecommendedDate,
    sectionalsPerWeek,
    analysisBacklog: backlog,
  };
}

export function preparationPhase(state: AppState, today: ISODate): 'FOUNDATION' | 'APPLICATION' | 'READINESS' {
  const days = daysBetween(today, state.profile.examDate);
  if (days > PHASE_THRESHOLDS.foundation) return 'FOUNDATION';
  if (days > PHASE_THRESHOLDS.application) return 'APPLICATION';
  return 'READINESS';
}
