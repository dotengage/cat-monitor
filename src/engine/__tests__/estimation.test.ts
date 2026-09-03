import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANNING } from '../../config/catConfig';
import { buildEstimationModel, estimateFutureDuration } from '../estimation';
import { completedTasks, makeState } from './fixtures';

const params = DEFAULT_PLANNING;

describe('estimateFutureDuration', () => {
  it('does not move estimates before there is enough evidence', () => {
    const state = makeState({ tasks: completedTasks(2, 60, 120, { type: 'practice', section: 'QA' }) });
    const model = buildEstimationModel(state, params);
    expect(estimateFutureDuration(60, 'practice', 'QA', model, params)).toBe(60);
  });

  it('increases estimates gradually when work consistently runs long', () => {
    const state = makeState({ tasks: completedTasks(6, 60, 90, { type: 'practice', section: 'QA' }) });
    const model = buildEstimationModel(state, params);
    const adjusted = estimateFutureDuration(60, 'practice', 'QA', model, params);

    expect(adjusted).toBeGreaterThan(60);
    // Gradual: it must not jump straight to the observed 90 minutes.
    expect(adjusted).toBeLessThan(90);
  });

  it('reduces estimates when work consistently finishes early', () => {
    const state = makeState({ tasks: completedTasks(6, 60, 40, { type: 'practice', section: 'QA' }) });
    const model = buildEstimationModel(state, params);
    const adjusted = estimateFutureDuration(60, 'practice', 'QA', model, params);

    expect(adjusted).toBeLessThan(60);
    expect(adjusted).toBeGreaterThan(40);
  });

  it('falls back to the task type, then to the global average', () => {
    const state = makeState({ tasks: completedTasks(6, 60, 90, { type: 'practice', section: 'VARC' }) });
    const model = buildEstimationModel(state, params);

    // No QA-specific evidence, but 'practice' evidence exists.
    expect(estimateFutureDuration(60, 'practice', 'QA', model, params)).toBeGreaterThan(60);
    expect(model.get('*')?.samples).toBe(6);
  });

  it('ignores partially completed tasks, which say nothing about total duration', () => {
    const tasks = completedTasks(6, 60, 200, { type: 'study' }).map((t) => ({ ...t, status: 'partial' as const }));
    const model = buildEstimationModel(makeState({ tasks }), params);
    expect(model.get('study')).toBeUndefined();
  });

  it('never adjusts beyond the configured bounds', () => {
    const state = makeState({ tasks: completedTasks(20, 30, 120, { type: 'practice' }) });
    const model = buildEstimationModel(state, params);
    const stats = model.get('practice');
    expect(stats?.factor).toBeLessThanOrEqual(params.estimationBounds[1]);
    expect(stats?.factor).toBeGreaterThanOrEqual(params.estimationBounds[0]);
  });
});
