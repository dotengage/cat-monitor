/**
 * Weekly planning engine.
 *
 * Produces 3-5 weekly outcomes and a small number of specific, startable tasks
 * that fit inside 70-80% of realistic capacity. Candidate work is generated
 * from the current evidence (mock analysis debt, error log, weak topics,
 * coverage gaps, mock cadence), scored, then greedily selected and placed on
 * days that can actually host it.
 */
import { SECTIONS, SECTION_FULL_NAMES, SECTION_LABELS } from '../config/catConfig';
import { addDays, daysBetween, endOfWeek, formatHours, isWeekend, shortDayName, weekDates } from '../domain/date';
import { nowISO, uid } from '../domain/ids';
import type {
  AppState,
  EnergyLevel,
  ID,
  ISODate,
  Importance,
  SectionKey,
  Task,
  TaskType,
  WeekPlan,
  WeeklyOutcome,
} from '../domain/types';
import { calculateWeekCapacity, energyForDate } from './capacity';
import {
  clamp,
  coverageBySection,
  errorsDueForReview,
  isOpen,
  sectionStats,
  topicStats,
  unanalysedMocks,
  weaknessScores,
} from './derive';
import { buildEstimationModel, estimateFutureDuration } from './estimation';
import { preferredWindow } from './patterns';
import { preparationPhase, recommendedMockCadence } from './readiness';
import type { DecisionDraft } from './rebalance';

interface Candidate {
  key: string;
  title: string;
  detail: string;
  type: TaskType;
  section?: SectionKey;
  topicId?: ID;
  baseMin: number;
  importance: Importance;
  energyRequired: EnergyLevel;
  impact: number;
  outcomeKey: string;
  outcomeTitle: string;
  outcomeMetric: string;
  preferWeekend?: boolean;
  dependsOnKey?: string;
  deadlineOffset?: number;
}

export interface GenerateWeekOptions {
  /** Explicit weekly planned minutes, e.g. from the previous week's reality. */
  targetPlannedMin?: number;
  generatedFrom?: WeekPlan['generatedFrom'];
  reviewId?: ID;
}

export interface GeneratedWeek {
  week: WeekPlan;
  tasks: Task[];
  decisions: DecisionDraft[];
  notes: string[];
  capacityMin: number;
  plannedMin: number;
  bufferMin: number;
  unplaced: string[];
}

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

function candidatesFor(state: AppState, weekStart: ISODate, today: ISODate, weeklyCapacityMin: number): Candidate[] {
  const out: Candidate[] = [];
  // Before a baseline exists the week is a measurement week, so all section
  // work rolls up into one "begin fundamentals" outcome rather than three.
  const baselineWeek = state.mocks.length === 0;
  const sectionOutcome = (section: SectionKey) =>
    baselineWeek
      ? {
          outcomeKey: 'fundamentals',
          outcomeTitle: 'Begin high-priority fundamentals',
          outcomeMetric: 'Highest-weight topics started and drilled',
        }
      : {
          outcomeKey: `section-${section}`,
          outcomeTitle: `Improve ${SECTION_FULL_NAMES[section]}`,
          outcomeMetric: `${SECTION_LABELS[section]} work completed and logged`,
        };
  const phase = preparationPhase(state, today);
  const weakness = weaknessScores(state, today);
  const coverage = coverageBySection(state);
  const stats = sectionStats(state);
  const cadence = recommendedMockCadence(state, today, weeklyCapacityMin);
  const params = state.settings.planning;

  /* 1. Mock analysis debt - the highest-value work in the system. */
  for (const mock of unanalysedMocks(state).slice(0, 2)) {
    out.push({
      key: `analysis:${mock.id}`,
      title: `Analyse ${mock.name || mock.provider} and classify every error`,
      detail:
        'Go through every incorrect and skipped question. For each: record the error type in the error log, write the corrected approach in one line, and note whether the question should have been attempted at all. Finish with the top 3 lessons.',
      type: 'analysis',
      baseMin: params.mockAnalysisMin,
      importance: 'critical',
      energyRequired: 4,
      impact: 5,
      outcomeKey: 'analysis-debt',
      outcomeTitle: 'Close the mock analysis backlog',
      outcomeMetric: `${unanalysedMocks(state).length} unanalysed mock(s) -> 0`,
      deadlineOffset: 3,
    });
  }

  /* 2. Baseline, when none exists. */
  if (state.mocks.length === 0) {
    out.push({
      key: 'baseline-mock',
      title: 'Take one full-length mock under exam conditions',
      detail:
        'Single sitting, no pauses, no reference material, 40 minutes per section in CAT order. The purpose is measurement, not a score you are happy with. Note the time at which you started each section.',
      type: 'mock',
      baseMin: params.fullMockMin,
      importance: 'critical',
      energyRequired: 5,
      impact: 5,
      outcomeKey: 'baseline',
      outcomeTitle: 'Establish baseline performance',
      outcomeMetric: '1 full mock attempted and recorded',
      preferWeekend: true,
    });
    out.push({
      key: 'baseline-analysis',
      title: 'Record and analyse the baseline mock',
      detail:
        'Enter overall and sectional scores, percentiles, attempts and accuracy in the Mock Centre. Then classify every incorrect question in the error log and identify the two weakest topics per section.',
      type: 'analysis',
      baseMin: params.mockAnalysisMin,
      importance: 'critical',
      energyRequired: 4,
      impact: 5,
      outcomeKey: 'weakness-map',
      outcomeTitle: 'Identify section-level weaknesses',
      outcomeMetric: 'Weak topics identified for all three sections',
      dependsOnKey: 'baseline-mock',
    });
    out.push({
      key: 'capacity-calibration',
      title: 'Log energy and focused minutes every evening this week',
      detail:
        'Two minutes per day in the Today view: energy 1-5, time you thought you had, time you actually focused, and anything unexpected. This is what calibrates every future plan; without it the planner is guessing.',
      type: 'planning',
      baseMin: 20,
      importance: 'critical',
      energyRequired: 1,
      impact: 5,
      outcomeKey: 'capacity',
      outcomeTitle: 'Establish realistic weekly capacity',
      outcomeMetric: '7 days logged',
    });
    out.push({
      key: 'error-log-setup',
      title: 'Log every incorrect question from this week with an error type',
      detail:
        'For each mistake record: section, topic, what went wrong (concept gap, calculation, misread, selection, too slow...), and the corrected approach in one line. Set a revisit date 7 days out.',
      type: 'error-review',
      baseMin: 30,
      importance: 'critical',
      energyRequired: 2,
      impact: 5,
      outcomeKey: 'error-system',
      outcomeTitle: 'Establish error tracking',
      outcomeMetric: 'Every mistake this week logged and classified',
    });
  } else {
    /* 3. Mocks on the recommended cadence. */
    const mockCount =
      cadence.perWeek >= 1
        ? Math.round(cadence.perWeek)
        : weeksSinceLastMock(state, weekStart) >= 1 / Math.max(cadence.perWeek, 0.25)
          ? 1
          : 0;
    for (let i = 0; i < mockCount; i += 1) {
      out.push({
        key: `mock:${i}`,
        title: `Take full mock #${state.mocks.filter((m) => m.kind === 'full').length + i + 1} under exam conditions`,
        detail:
          'Single sitting, exam timing, no pauses. Before starting, write down your intended section strategy (order, attempt targets, abandon rules). Afterwards note where you deviated from it.',
        type: 'mock',
        baseMin: params.fullMockMin,
        importance: 'critical',
        energyRequired: 5,
        impact: 4,
        outcomeKey: 'mock-cycle',
        outcomeTitle: 'Complete a full mock cycle (attempt + analysis)',
        outcomeMetric: `${mockCount} mock(s) attempted and analysed`,
        preferWeekend: true,
      });
      out.push({
        key: `mock-analysis:${i}`,
        title: `Analyse full mock #${state.mocks.filter((m) => m.kind === 'full').length + i + 1}`,
        detail:
          'Record scores and percentiles, then classify every incorrect and skipped question. Separate "could not solve" from "should not have attempted". Write the top 3 lessons.',
        type: 'analysis',
        baseMin: params.mockAnalysisMin,
        importance: 'critical',
        energyRequired: 4,
        impact: 5,
        outcomeKey: 'mock-cycle',
        outcomeTitle: 'Complete a full mock cycle (attempt + analysis)',
        outcomeMetric: `${mockCount} mock(s) attempted and analysed`,
        dependsOnKey: `mock:${i}`,
      });
    }

    /* 4. Sectionals, weighted towards the weakest sections. */
    const sectionalPlan = sectionalAllocation(cadence.sectionalsPerWeek, weakness);
    sectionalPlan.forEach((section, i) => {
      out.push({
        key: `sectional:${section}:${i}`,
        title: `Take a timed ${SECTION_LABELS[section]} sectional (40 minutes) and record the percentile`,
        detail:
          section === 'DILR'
            ? 'Spend the first 5 minutes choosing sets. Commit to 2 sets, cap each at 15 minutes, and record why you selected or abandoned each one.'
            : section === 'VARC'
              ? 'Cap each RC passage at 8 minutes. Record accuracy per passage and which passage type cost the most time.'
              : 'Attempt in two passes: easy questions first, then the rest. Record time spent on questions you eventually skipped.',
        type: 'sectional',
        section,
        baseMin: params.sectionalMin,
        importance: 'important',
        energyRequired: 4,
        impact: 4,
        outcomeKey: `section-${section}`,
        outcomeTitle: `Improve ${SECTION_FULL_NAMES[section]}`,
        outcomeMetric: `${SECTION_LABELS[section]} sectional percentile recorded`,
      });
    });
  }

  /* 5. Error review, once there is anything to review. */
  const dueErrors = errorsDueForReview(state, addDays(weekStart, 6));
  if (dueErrors.length >= 3) {
    const n = Math.min(dueErrors.length, 12);
    out.push({
      key: 'error-review',
      title: `Re-solve ${n} logged errors from memory, without looking at the solution`,
      detail:
        'Work each one cold. Mark it resolved only if you reached the correct answer using the corrected approach; otherwise re-log it and set a new revisit date. Repeated error types are the cheapest percentile available.',
      type: 'error-review',
      baseMin: clamp(n * params.errorReviewMin, 20, 60),
      importance: 'critical',
      energyRequired: 3,
      impact: 5,
      outcomeKey: 'error-system',
      outcomeTitle: 'Reduce repeated errors',
      outcomeMetric: `${n} logged errors re-solved`,
    });
  }

  /* 6. Weak-topic remediation, driven by measured accuracy. */
  const weakTopics = topicStats(state)
    .filter((t) => t.status !== 'skipped')
    .filter((t) => (t.attempted >= 8 && (t.accuracy ?? 1) < 0.6) || t.errorCount >= 3)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
    .slice(0, 3);
  for (const topic of weakTopics) {
    out.push({
      key: `weak:${topic.topicId}`,
      title: `Fix ${topic.name}: re-learn the core method, then solve 10 questions with a 90-second cap`,
      detail: `Measured accuracy is ${Math.round((topic.accuracy ?? 0) * 100)}% across ${topic.attempted} attempts. Rebuild the standard approach first, then drill. Log every error with its type.`,
      type: 'practice',
      section: topic.section,
      topicId: topic.topicId,
      baseMin: 55,
      importance: 'critical',
      energyRequired: 4,
      impact: 5,
      ...sectionOutcome(topic.section),
    });
  }

  /* 7. Coverage: high-weight topics not yet built. New learning is
        progressively de-emphasised as the exam approaches. */
  const learningBudget = baselineWeek ? 2 : phase === 'FOUNDATION' ? 4 : phase === 'APPLICATION' ? 2 : 1;
  const uncovered = state.topics
    .filter((t) => t.status === 'not-started' || t.status === 'learning')
    .map((t) => ({ topic: t, score: t.weight * (1 + weakness[t.section]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, learningBudget);

  for (const { topic } of uncovered) {
    const lessonMin = topic.status === 'not-started' ? 40 : 30;
    out.push({
      key: `learn:${topic.id}`,
      title: `Watch a ${lessonMin}-minute concept lesson on ${topic.name} and write 5-line notes`,
      detail:
        'Notes must contain: the standard approach, the two formulas or rules that actually get used, one worked example, and the trap that most commonly costs marks.',
      type: 'study',
      section: topic.section,
      topicId: topic.id,
      baseMin: lessonMin,
      importance: topic.weight >= 4 ? 'critical' : 'important',
      energyRequired: 3,
      impact: topic.weight >= 4 ? 4 : 3,
      ...sectionOutcome(topic.section),
    });
    out.push({
      key: `drill:${topic.id}`,
      title: `Solve 12 ${topic.name} questions and review every incorrect answer`,
      detail: 'Cap each question at 2 minutes. After the set, classify every error and record the corrected approach.',
      type: 'practice',
      section: topic.section,
      topicId: topic.id,
      baseMin: 45,
      importance: topic.weight >= 4 ? 'critical' : 'important',
      energyRequired: 4,
      impact: topic.weight >= 4 ? 4 : 3,
      ...sectionOutcome(topic.section),
      dependsOnKey: `learn:${topic.id}`,
    });
  }

  /* 8. Standing weekly volume: RC and DILR sets are non-negotiable. */
  const rcCount = baselineWeek ? 2 : weakness.VARC > 0.55 ? 3 : 2;
  for (let i = 0; i < rcCount; i += 1) {
    out.push({
      key: `rc:${i}`,
      title: 'Complete 2 RC passages and record accuracy and time for each',
      detail:
        'Cap each passage at 8 minutes including questions. Log passage type, accuracy, and for every wrong answer whether it was a comprehension failure or an option-elimination failure.',
      type: 'practice',
      section: 'VARC',
      baseMin: 35,
      importance: 'important',
      energyRequired: 3,
      impact: weakness.VARC > 0.55 ? 5 : 4,
      ...sectionOutcome('VARC'),
    });
  }

  const dilrCount = baselineWeek ? 2 : weakness.DILR > 0.55 ? 3 : 2;
  for (let i = 0; i < dilrCount; i += 1) {
    out.push({
      key: `dilr:${i}`,
      title: 'Complete 2 DILR sets, maximum 20 minutes per set, and log why each set was selected or abandoned',
      detail:
        'Read all available sets for 3 minutes before choosing. For each set record: chosen or rejected, time taken, questions solved, and the miss reason (selection, logic, calculation, time, abandoned too late or too early).',
      type: 'practice',
      section: 'DILR',
      baseMin: 50,
      importance: 'critical',
      energyRequired: 4,
      impact: weakness.DILR > 0.55 ? 5 : 4,
      ...sectionOutcome('DILR'),
    });
  }

  if (stats.QA.attempted > 0 || coverage.QA > 0.2) {
    out.push({
      key: 'qa-mixed',
      title: 'Solve a mixed 15-question QA set across Arithmetic and Algebra, timed at 25 minutes',
      detail:
        'Mixed sets train question selection, not just technique. Mark each question as attempt / skip within 20 seconds of reading it, then check how good those calls were.',
      type: 'practice',
      section: 'QA',
      baseMin: 40,
      importance: 'important',
      energyRequired: 4,
      impact: 4,
      ...sectionOutcome('QA'),
    });
  }

  /* 9. Revision of covered ground, weighted up near the exam. */
  const revisable = state.topics.filter((t) => t.status === 'practised' || t.status === 'strong');
  if (revisable.length >= 3) {
    // Revise the highest-weight covered topic that has seen the least recent work.
    const topic = [...revisable].sort((a, b) => b.weight - a.weight)[0];
    out.push({
      key: `revise:${topic.id}`,
      title: `Revise ${topic.name}: formulas, standard approaches, and 5 previously incorrect questions`,
      detail: 'Work from your own notes first. Anything you cannot reconstruct from memory goes back into the error log.',
      type: 'revision',
      section: topic.section,
      topicId: topic.id,
      baseMin: params.topicRevisionMin,
      importance: phase === 'READINESS' ? 'critical' : 'important',
      energyRequired: 2,
      impact: phase === 'READINESS' ? 5 : 3,
      outcomeKey: 'revision',
      outcomeTitle: 'Keep covered ground warm',
      outcomeMetric: 'At least 1 revision pass completed',
    });
  }

  /* 10. Strategy work, only once there is mock evidence to work from. */
  if (phase !== 'FOUNDATION' && state.mocks.length >= 2) {
    out.push({
      key: 'strategy',
      title: 'Write your section-by-section exam strategy on one page and test it in the next mock',
      detail:
        'Include: section order, target attempts per section, abandon rules (time per question and per set), and what you will do in the last 8 minutes of each section.',
      type: 'planning',
      baseMin: 30,
      importance: 'important',
      energyRequired: 2,
      impact: 4,
      outcomeKey: 'strategy',
      outcomeTitle: 'Lock an exam-day strategy',
      outcomeMetric: 'One-page strategy written and tested',
    });
  }

  /* 11. The weekly review itself. */
  out.push({
    key: 'weekly-review',
    title: 'Complete the weekly review (7 questions)',
    detail: 'The review feeds directly into next week’s plan. Skipping it means the next plan is built on assumptions instead of evidence.',
    type: 'planning',
    baseMin: 15,
    importance: 'critical',
    energyRequired: 1,
    impact: 4,
    outcomeKey: 'review',
    outcomeTitle: 'Close the week with a review',
    outcomeMetric: 'Weekly review completed',
  });

  return out;
}

function weeksSinceLastMock(state: AppState, weekStart: ISODate): number {
  const mocks = state.mocks.filter((m) => m.kind === 'full').sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = mocks[mocks.length - 1];
  if (!last) return 99;
  return Math.max(0, daysBetween(last.date, weekStart)) / 7;
}

/** Distributes sectional slots towards the weakest sections. */
function sectionalAllocation(count: number, weakness: Record<SectionKey, number>): SectionKey[] {
  const ordered = [...SECTIONS].sort((a, b) => weakness[b] - weakness[a]);
  const out: SectionKey[] = [];
  for (let i = 0; i < Math.max(0, Math.round(count)); i += 1) {
    out.push(ordered[i % ordered.length]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Week assembly                                                       */
/* ------------------------------------------------------------------ */

export function generateWeek(
  state: AppState,
  weekStart: ISODate,
  today: ISODate,
  opts: GenerateWeekOptions = {},
): GeneratedWeek {
  const stamp = nowISO();
  const params = state.settings.planning;
  const capacity = calculateWeekCapacity(state, weekStart, today);
  const days = weekDates(weekStart);
  const notes: string[] = [];
  const decisions: DecisionDraft[] = [];

  /* Capacity target: modelled, unless the previous week's reality says
     otherwise. Buffer is preserved in both cases. */
  let scale = 1;
  if (opts.targetPlannedMin && capacity.plannedMin > 0) {
    scale = clamp(opts.targetPlannedMin / capacity.plannedMin, 0.5, 1.2);
    if (Math.abs(scale - 1) > 0.05) {
      notes.push(
        `Planned volume scaled to ${Math.round(scale * 100)}% of the modelled capacity, based on what last week actually produced.`,
      );
    }
  }

  const dayCapacity = new Map<ISODate, number>();
  for (const d of capacity.days) {
    // Days already in the past this week cannot be planned into.
    dayCapacity.set(d.date, d.date < today ? 0 : Math.round(d.plannedMin * scale));
  }
  const weeklyPlannedTarget = [...dayCapacity.values()].reduce((a, v) => a + v, 0);

  /* Existing open work in this week counts against capacity. */
  const existing = state.tasks.filter(
    (t) => isOpen(t) && t.date !== null && t.date >= weekStart && t.date <= addDays(weekStart, 6),
  );
  const dayLoad = new Map<ISODate, number>(days.map((d) => [d, 0]));
  const dayCount = new Map<ISODate, number>(days.map((d) => [d, 0]));
  for (const t of existing) {
    if (!t.date) continue;
    dayLoad.set(t.date, (dayLoad.get(t.date) ?? 0) + t.estimateMin);
    dayCount.set(t.date, (dayCount.get(t.date) ?? 0) + 1);
  }
  let allocated = existing.reduce((a, t) => a + t.estimateMin, 0);

  /* Score and order candidates. */
  const model = buildEstimationModel(state, params);
  const weakness = weaknessScores(state, today);
  const raw = candidatesFor(state, weekStart, today, weeklyPlannedTarget);
  const scored = raw
    .map((c) => {
      const estimateMin = estimateFutureDuration(c.baseMin, c.type, c.section, model, params);
      const sectionWeakness = c.section ? weakness[c.section] : 0.5;
      const importanceBoost = c.importance === 'critical' ? 1.35 : c.importance === 'important' ? 1.1 : 0.85;
      const density = (c.impact * (1 + sectionWeakness) * importanceBoost) / Math.max(0.25, estimateMin / 60);
      // Value first, density second. Otherwise a stack of cheap 15-minute
      // tasks can crowd out the mock that the whole plan depends on.
      const rank = c.impact + (c.importance === 'critical' ? 0.5 : c.importance === 'important' ? 0.2 : 0);
      return { candidate: c, estimateMin, value: density, rank };
    })
    .sort((a, b) => (b.rank === a.rank ? b.value - a.value : b.rank - a.rank));

  /* Greedy selection inside the planned capacity. Critical work is never
     dropped for capacity reasons here - the rebalancer handles that with an
     explicit, logged decision. */
  const selected: { candidate: Candidate; estimateMin: number }[] = [];
  const maxTasks = params.maxTasksPerDay * days.filter((d) => (dayCapacity.get(d) ?? 0) > 0).length;
  const selectedKeys = new Set<string>();
  for (const item of scored) {
    if (selected.length + existing.length >= maxTasks) break;
    // Never select work whose prerequisite did not make the cut.
    const dep = item.candidate.dependsOnKey;
    if (dep && !selectedKeys.has(dep) && !scored.some((s) => s.candidate.key === dep)) continue;
    const fits = allocated + item.estimateMin <= weeklyPlannedTarget;
    if (!fits && item.candidate.importance !== 'critical') continue;
    if (!fits && allocated + item.estimateMin > weeklyPlannedTarget * 1.05) continue;
    selected.push(item);
    selectedKeys.add(item.candidate.key);
    allocated += item.estimateMin;
  }
  // Drop anything whose prerequisite was ultimately not selected.
  const finalKeys = new Set(selected.map((s) => s.candidate.key));
  const pruned = selected.filter((s) => !s.candidate.dependsOnKey || finalKeys.has(s.candidate.dependsOnKey));
  selected.length = 0;
  selected.push(...pruned);

  /* Build tasks, resolving intra-week dependencies by key. */
  const idByKey = new Map<string, ID>();
  for (const s of selected) idByKey.set(s.candidate.key, uid('task'));

  const bestWindow = preferredWindow(state, today);
  const tasks: Task[] = [];
  const unplaced: string[] = [];

  // Highest energy demand first so hard work claims the good days.
  const placementOrder = [...selected].sort((a, b) => {
    if (b.candidate.energyRequired !== a.candidate.energyRequired) {
      return b.candidate.energyRequired - a.candidate.energyRequired;
    }
    return b.estimateMin - a.estimateMin;
  });

  for (const { candidate, estimateMin } of placementOrder) {
    const depKey = candidate.dependsOnKey;
    const depId = depKey ? idByKey.get(depKey) : undefined;
    const depTask = depId ? tasks.find((t) => t.id === depId) : undefined;
    const earliest = depTask?.date ? addDays(depTask.date, 1) : days.find((d) => d >= today) ?? weekStart;

    const date = pickDay({
      days,
      earliest,
      today,
      state,
      candidate,
      estimateMin,
      dayCapacity,
      dayLoad,
      dayCount,
      maxPerDay: params.maxTasksPerDay,
    });

    if (date) {
      dayLoad.set(date, (dayLoad.get(date) ?? 0) + estimateMin);
      dayCount.set(date, (dayCount.get(date) ?? 0) + 1);
    } else {
      unplaced.push(candidate.title);
      decisions.push({
        date: today,
        subject: candidate.title,
        kind: 'POSTPONE',
        reason: 'Generated as valuable work but no day this week can host it without breaching buffer. Held in the backlog rather than forced into an overloaded day.',
        auto: true,
      });
    }

    tasks.push({
      id: idByKey.get(candidate.key) as ID,
      createdAt: stamp,
      updatedAt: stamp,
      title: candidate.title,
      detail: candidate.detail,
      date: date ?? null,
      weekStart: date ? weekStart : null,
      type: candidate.type,
      section: candidate.section,
      topicId: candidate.topicId,
      goalId: state.goals.find((g) => g.isPrimary)?.id,
      outcomeId: candidate.outcomeKey,
      estimateMin,
      importance: candidate.importance,
      energyRequired: candidate.energyRequired,
      impact: candidate.impact,
      dependsOn: depId ? [depId] : [],
      deadline: candidate.deadlineOffset ? addDays(weekStart, candidate.deadlineOffset) : undefined,
      status: 'planned',
      locked: false,
      postponeCount: 0,
      window: candidate.energyRequired >= 4 ? bestWindow : undefined,
      origin: 'auto',
    });
  }

  /* Outcomes: 3-5, ordered by the value of the work behind them. */
  const outcomes = buildOutcomes(
    selected.map((s) => s.candidate),
    tasks,
  );

  const plannedMin = tasks.filter((t) => t.date !== null).reduce((a, t) => a + t.estimateMin, 0) +
    existing.reduce((a, t) => a + t.estimateMin, 0);

  if (unplaced.length > 0) {
    notes.push(`${unplaced.length} generated item(s) stayed in the backlog because the week has no room for them.`);
  }
  notes.push(
    `Planned ${formatHours(plannedMin, 1)} against ${formatHours(capacity.rawMin, 1)} of realistic availability, leaving ${formatHours(Math.max(0, capacity.rawMin - plannedMin), 1)} of buffer.`,
  );

  const week: WeekPlan = {
    id: uid('week'),
    createdAt: stamp,
    updatedAt: stamp,
    startDate: weekStart,
    endDate: addDays(weekStart, 6),
    outcomes,
    capacityMin: capacity.rawMin,
    plannedMin,
    bufferMin: Math.max(0, capacity.rawMin - plannedMin),
    generatedFrom: opts.generatedFrom ?? 'manual',
    reviewId: opts.reviewId,
    focusNote: buildFocusNote(state, today, weakness),
  };

  return {
    week,
    tasks,
    decisions,
    notes,
    capacityMin: capacity.rawMin,
    plannedMin,
    bufferMin: week.bufferMin,
    unplaced,
  };
}

interface PickDayArgs {
  days: ISODate[];
  earliest: ISODate;
  today: ISODate;
  state: AppState;
  candidate: Candidate;
  estimateMin: number;
  dayCapacity: Map<ISODate, number>;
  dayLoad: Map<ISODate, number>;
  dayCount: Map<ISODate, number>;
  maxPerDay: number;
}

function pickDay(args: PickDayArgs): ISODate | null {
  const { days, earliest, today, state, candidate, estimateMin, dayCapacity, dayLoad, dayCount, maxPerDay } = args;
  const viable = days
    .filter((d) => d >= earliest && d >= today)
    .map((d) => {
      const cap = dayCapacity.get(d) ?? 0;
      const load = dayLoad.get(d) ?? 0;
      const free = cap - load;
      const energy = energyForDate(state, d);
      const count = dayCount.get(d) ?? 0;
      return { date: d, free, energy, count, cap };
    })
    .filter((d) => d.cap > 0 && d.count < maxPerDay && d.free >= estimateMin)
    .filter((d) => candidate.energyRequired - d.energy < 2);

  if (viable.length === 0) return null;

  // Prefer the day whose energy best matches the demand, then the emptiest day,
  // so work spreads out instead of clustering into one heroic day.
  viable.sort((a, b) => {
    if (candidate.preferWeekend) {
      const aw = isWeekend(a.date) ? 0 : 1;
      const bw = isWeekend(b.date) ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    const aFit = Math.abs(a.energy - candidate.energyRequired);
    const bFit = Math.abs(b.energy - candidate.energyRequired);
    if (aFit !== bFit) return aFit - bFit;
    return b.free - a.free;
  });
  return viable[0].date;
}

function buildOutcomes(candidates: Candidate[], tasks: Task[]): WeeklyOutcome[] {
  const groups = new Map<string, { title: string; metric: string; section?: SectionKey; value: number }>();
  for (const c of candidates) {
    const existing = groups.get(c.outcomeKey);
    const value = c.impact;
    if (existing) {
      existing.value += value;
    } else {
      groups.set(c.outcomeKey, { title: c.outcomeTitle, metric: c.outcomeMetric, section: c.section, value });
    }
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 5);
  const outcomes = ordered.map(([key, g]) => ({
    id: key,
    title: g.title,
    metric: g.metric,
    section: g.section,
    achieved: false,
    progress: 0,
  }));
  // Anything whose outcome did not make the top five is folded into the last.
  const keptKeys = new Set(outcomes.map((o) => o.id));
  for (const t of tasks) {
    if (t.outcomeId && !keptKeys.has(t.outcomeId)) t.outcomeId = outcomes[outcomes.length - 1]?.id;
  }
  return outcomes;
}

function buildFocusNote(state: AppState, today: ISODate, weakness: Record<SectionKey, number>): string {
  const phase = preparationPhase(state, today);
  const weakest = SECTIONS.reduce((a, b) => (weakness[b] > weakness[a] ? b : a), SECTIONS[0]);
  if (state.mocks.length === 0) {
    return 'This is a measurement and calibration week. The objective is a baseline and an honest picture of real capacity, not volume.';
  }
  if (phase === 'FOUNDATION') {
    return `Foundation phase. Build high-weight concepts while keeping ${SECTION_LABELS[weakest]} in every week.`;
  }
  if (phase === 'APPLICATION') {
    return `Application phase. Volume, sectionals and analysis, concentrated on ${SECTION_LABELS[weakest]}.`;
  }
  return `Readiness phase. Mocks, analysis, revision and ${SECTION_LABELS[weakest]} repair. Avoid new material unless the data demands it.`;
}

/** Convenience wrapper used by the weekly review flow. */
export function generateNextWeek(
  state: AppState,
  today: ISODate,
  opts: GenerateWeekOptions = {},
): GeneratedWeek {
  const nextStart = addDays(endOfWeek(today, state.settings.weekStartsOn), 1);
  return generateWeek(state, nextStart, today, { generatedFrom: 'review', ...opts });
}

export function describeWeek(generated: GeneratedWeek): string[] {
  const byDay = new Map<ISODate, Task[]>();
  for (const t of generated.tasks) {
    if (!t.date) continue;
    byDay.set(t.date, [...(byDay.get(t.date) ?? []), t]);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, tasks]) => `${shortDayName(date)}: ${tasks.map((t) => t.title).join('; ')}`);
}
