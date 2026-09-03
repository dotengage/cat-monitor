import { describe, expect, it } from 'vitest';
import { addDays } from '../../domain/date';
import { calculateCapacity, calculateRealismFactor, calculateWeekCapacity, capacityBetween } from '../capacity';
import { makeCommitment, makeDayLog, makeState, TODAY, WEEK_START } from './fixtures';

describe('calculateCapacity', () => {
  it('holds back buffer instead of planning 100% of available time', () => {
    const state = makeState();
    const cap = calculateCapacity(state, TODAY);

    expect(cap.baseMin).toBe(180); // 3h weekday normal
    expect(cap.rawMin).toBe(180);
    expect(cap.plannedMin).toBe(135); // 75% of raw
    expect(cap.bufferMin).toBe(45);
    expect(cap.plannedMin + cap.bufferMin).toBe(cap.rawMin);
  });

  it('never plans more than the stated maximum for the day', () => {
    const state = makeState();
    state.profile.energyByDay = { ...state.profile.energyByDay, 4: 5 };
    state.profile.weekdayHours = { min: 1, normal: 3, max: 3 };
    const cap = calculateCapacity(state, TODAY);
    expect(cap.rawMin).toBeLessThanOrEqual(180);
  });

  it('subtracts commitments before anything is planned', () => {
    const state = makeState({ commitments: [makeCommitment({ hoursPerDay: 2 })] });
    const cap = calculateCapacity(state, TODAY);
    expect(cap.rawMin).toBe(60);
    expect(cap.plannedMin).toBe(45);
    expect(cap.commitments).toHaveLength(1);
  });

  it('reduces capacity across a multi-day travel block', () => {
    const base = makeState();
    const travelled = makeState({
      commitments: [
        makeCommitment({
          title: 'Travel',
          type: 'travel',
          startDate: TODAY,
          endDate: addDays(TODAY, 3),
          hoursPerDay: 2.5,
        }),
      ],
    });

    const before = capacityBetween(base, TODAY, addDays(TODAY, 3), TODAY);
    const after = capacityBetween(travelled, TODAY, addDays(TODAY, 3), TODAY);

    expect(after).toBeLessThan(before);
    expect(after / before).toBeLessThan(0.75);
  });

  it('applies the energy factor for low-energy days', () => {
    const state = makeState();
    const low = calculateCapacity(state, TODAY, { energyOverride: 1 });
    const normal = calculateCapacity(state, TODAY, { energyOverride: 3 });
    expect(low.rawMin).toBe(normal.rawMin / 2);
  });
});

describe('calculateRealismFactor', () => {
  it('stays at 1 until there is enough logged evidence', () => {
    const state = makeState({ dayLogs: [makeDayLog({ date: addDays(TODAY, -1), focusedMin: 30 })] });
    expect(calculateRealismFactor(state, TODAY)).toBe(1);
  });

  it('moves towards observed behaviour once several days are logged', () => {
    const logs = Array.from({ length: 8 }, (_, i) =>
      makeDayLog({ date: addDays(TODAY, -(i + 1)), focusedMin: 60, estimatedAvailableMin: 180 }),
    );
    const state = makeState({ dayLogs: logs });
    const factor = calculateRealismFactor(state, TODAY);
    expect(factor).toBeLessThan(1);
    expect(factor).toBeGreaterThanOrEqual(0.6);
  });
});

describe('calculateWeekCapacity', () => {
  it('sums seven days and keeps buffer separate', () => {
    const state = makeState();
    const week = calculateWeekCapacity(state, WEEK_START, WEEK_START);
    expect(week.days).toHaveLength(7);
    expect(week.plannedMin + week.bufferMin).toBe(week.rawMin);
    expect(week.plannedMin / week.rawMin).toBeCloseTo(0.75, 1);
  });
});
