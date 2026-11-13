import { describe, expect, it } from 'vitest';
import { calculateForecast } from '../../engine/forecast';
import { reducer } from '../../state/store';
import { migrate } from '../migrate';
import { buildSampleState } from '../sampleState';

const TODAY = '2026-11-13';

describe('sample data', () => {
  const started = performance.now();
  const s = buildSampleState(TODAY);
  const elapsed = performance.now() - started;

  it('is marked as sample data and skips onboarding', () => {
    expect(s.demo).toBe(true);
    expect(s.profile.onboarded).toBe(true);
  });

  it('has a climbing series of analysed full mocks, the latest left to analyse', () => {
    const full = s.mocks.filter((m) => m.kind === 'full').sort((a, b) => a.date.localeCompare(b.date));
    expect(full.length).toBeGreaterThanOrEqual(10);
    expect(full.every((m) => m.date < TODAY)).toBe(true);
    expect(full[full.length - 1].overallScore!).toBeGreaterThan(full[0].overallScore!);
    expect(full.filter((m) => !m.analysed)).toHaveLength(1);
    // Every section's counts agree with each other.
    for (const m of full) {
      for (const sec of Object.values(m.sections)) expect(sec!.correct + sec!.incorrect).toBe(sec!.attempts);
    }
    expect(s.mocks.some((m) => m.kind === 'sectional')).toBe(true);
  });

  it('gives the forecast enough to work with', () => {
    const f = calculateForecast(s, TODAY);
    expect(f.status).not.toBe('UNCONFIRMED');
    expect(f.forecast?.probability).toBeDefined();
    expect(f.trend.label).toBe('RISING');
  });

  it('has weeks of plans, reviews and logs behind it, and a plan for this week', () => {
    expect(s.reviews.length).toBeGreaterThanOrEqual(10);
    expect(s.weeks.length).toBeGreaterThanOrEqual(12);
    expect(s.tasks.some((t) => t.status === 'done')).toBe(true);
    expect(s.tasks.some((t) => t.status === 'planned' && (t.date ?? '') >= TODAY)).toBe(true);
    expect(s.practice.length).toBeGreaterThan(30);
    expect(s.dayLogs.length).toBeGreaterThan(40);
    expect(s.habitDays.length).toBeGreaterThan(40);
  });

  it('leaves no past planned work for the day rollover to turn into a pile of misses', () => {
    const rolled = reducer(s, { type: 'rollover', today: TODAY });
    expect(rolled.tasks.filter((t) => t.needsDecision).length).toBeLessThanOrEqual(6);
  });

  it('has three decks studied through the real scheduler', () => {
    expect(s.decks).toHaveLength(3);
    expect(s.flashcards.length).toBeGreaterThanOrEqual(30);
    expect(s.cardReviews.length).toBeGreaterThan(100);
    expect(new Set(s.flashcards.map((c) => c.state)).size).toBeGreaterThan(1);
    expect(s.flashcards.every((c) => c.createdAt.slice(0, 10) <= TODAY)).toBe(true);
  });

  it('is the same every time it is loaded', () => {
    const again = buildSampleState(TODAY);
    expect(again.mocks.map((m) => m.overallScore)).toEqual(s.mocks.map((m) => m.overallScore));
    expect(again.cardReviews.map((r) => r.rating)).toEqual(s.cardReviews.map((r) => r.rating));
  });

  it('survives a save and reload, flag included', () => {
    expect(migrate(JSON.parse(JSON.stringify(s))).demo).toBe(true);
  });

  it('builds quickly enough to load on a click', () => {
    expect(elapsed).toBeLessThan(3000);
  });
});
