/**
 * Duration learning.
 *
 * Compares estimated against actual durations and nudges future estimates.
 * Deliberately slow-moving: an exponentially weighted average with a minimum
 * sample gate, so one bad afternoon does not rewrite every future estimate.
 */
import type { AppState, PlanningParams, SectionKey, Task, TaskType } from '../domain/types';
import { clamp, mean } from './derive';

export interface EstimationStats {
  key: string;
  samples: number;
  /** actual / estimated. >1 means the user consistently needs longer. */
  factor: number;
  meanEstimateMin: number;
  meanActualMin: number;
  confidence: 'low' | 'medium' | 'high';
}

export type EstimationModel = Map<string, EstimationStats>;

export function estimationKey(type: TaskType, section?: SectionKey): string {
  return section ? `${type}|${section}` : type;
}

function completedWithActuals(state: AppState): Task[] {
  return state.tasks
    .filter((t) => (t.status === 'done' || t.status === 'partial') && (t.actualMin ?? 0) > 0 && t.estimateMin > 0)
    .sort((a, b) => (a.completedAt ?? a.updatedAt).localeCompare(b.completedAt ?? b.updatedAt));
}

/** Builds per-key rolling statistics from completed tasks. */
export function buildEstimationModel(state: AppState, params: PlanningParams): EstimationModel {
  const alpha = clamp(params.estimationAlpha, 0.05, 0.6);
  const buckets = new Map<string, { ratios: number[]; est: number[]; act: number[] }>();

  const push = (key: string, ratio: number, est: number, act: number) => {
    const b = buckets.get(key) ?? { ratios: [], est: [], act: [] };
    b.ratios.push(ratio);
    b.est.push(est);
    b.act.push(act);
    buckets.set(key, b);
  };

  for (const task of completedWithActuals(state)) {
    // A partial completion tells us little about total duration; skip it.
    if (task.status === 'partial') continue;
    const ratio = clamp((task.actualMin as number) / task.estimateMin, 0.25, 4);
    push('*', ratio, task.estimateMin, task.actualMin as number);
    push(estimationKey(task.type), ratio, task.estimateMin, task.actualMin as number);
    if (task.section) {
      push(estimationKey(task.type, task.section), ratio, task.estimateMin, task.actualMin as number);
    }
  }

  const model: EstimationModel = new Map();
  for (const [key, b] of buckets) {
    let factor = 1;
    for (const r of b.ratios) factor = factor * (1 - alpha) + r * alpha;
    model.set(key, {
      key,
      samples: b.ratios.length,
      factor: clamp(factor, params.estimationBounds[0], params.estimationBounds[1]),
      meanEstimateMin: Math.round(mean(b.est)),
      meanActualMin: Math.round(mean(b.act)),
      confidence: b.ratios.length >= 8 ? 'high' : b.ratios.length >= 5 ? 'medium' : 'low',
    });
  }
  return model;
}

/** Most specific stats available for a task shape. */
export function lookupStats(
  model: EstimationModel,
  type: TaskType,
  section: SectionKey | undefined,
  minSamples: number,
): EstimationStats | undefined {
  const candidates = [section ? estimationKey(type, section) : null, estimationKey(type), '*'].filter(
    Boolean,
  ) as string[];
  for (const key of candidates) {
    const stats = model.get(key);
    if (stats && stats.samples >= minSamples) return stats;
  }
  return undefined;
}

/**
 * Adjusts a base estimate using learned behaviour. The adjustment is damped
 * (only half of the observed drift is applied) so estimates converge instead
 * of oscillating.
 */
export function estimateFutureDuration(
  baseMin: number,
  type: TaskType,
  section: SectionKey | undefined,
  model: EstimationModel,
  params: PlanningParams,
): number {
  const stats = lookupStats(model, type, section, params.estimationMinSamples);
  if (!stats) return Math.round(baseMin);
  const damped = 1 + (stats.factor - 1) * 0.5;
  const adjusted = baseMin * clamp(damped, params.estimationBounds[0], params.estimationBounds[1]);
  // Round to the nearest 5 minutes - false precision helps nobody.
  return Math.max(5, Math.round(adjusted / 5) * 5);
}
