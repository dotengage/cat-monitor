/**
 * Configuration layer.
 *
 * Nothing about CAT is hardcoded inside the engine or the UI. Sections,
 * topics, planning constants and labels all live here, so a change in exam
 * structure (or in the user's personal target) is a config edit, not a rewrite.
 */
import type {
  CommitmentType,
  ErrorType,
  PlanningParams,
  SectionKey,
  SetMissReason,
  TaskType,
  TimeWindow,
} from '../domain/types';

export const APP_NAME = 'CAT Monitor';
export const STATE_VERSION = 2;

/** Defaults used the first time the app is opened. Editable in Settings. */
export const DEFAULT_EXAM_DATE = '2026-11-29';
export const DEFAULT_TARGET_PERCENTILE = 96;
export const DEFAULT_PREP_MODE = 'Self-study (IMS mocks, YouTube, peer help)';

export const SECTIONS: SectionKey[] = ['VARC', 'DILR', 'QA'];

export const SECTION_LABELS: Record<SectionKey, string> = {
  VARC: 'VARC',
  DILR: 'DILR',
  QA: 'QA',
};

export const SECTION_FULL_NAMES: Record<SectionKey, string> = {
  VARC: 'Verbal Ability & Reading Comprehension',
  DILR: 'Data Interpretation & Logical Reasoning',
  QA: 'Quantitative Ability',
};

/** Minutes per section in a full CAT paper. Used for mock/sectional sizing. */
export const SECTION_DURATION_MIN: Record<SectionKey, number> = {
  VARC: 40,
  DILR: 40,
  QA: 40,
};

export interface TopicSeed {
  name: string;
  section: SectionKey;
  area: string;
  baseHours: number;
  weight: number;
}

/**
 * Seed topic list. `baseHours` is time-to-working-competence from zero;
 * `weight` is exam frequency / return on investment (1-5).
 * The user can add, edit, skip or delete any of these.
 */
export const TOPIC_SEEDS: TopicSeed[] = [
  // ---- QA: Arithmetic (highest frequency block in recent CAT papers) ----
  { name: 'Percentages', section: 'QA', area: 'Arithmetic', baseHours: 3, weight: 5 },
  { name: 'Ratio & Proportion', section: 'QA', area: 'Arithmetic', baseHours: 3, weight: 5 },
  { name: 'Averages, Mixtures & Alligation', section: 'QA', area: 'Arithmetic', baseHours: 3, weight: 4 },
  { name: 'Time, Speed & Distance', section: 'QA', area: 'Arithmetic', baseHours: 4, weight: 5 },
  { name: 'Time & Work', section: 'QA', area: 'Arithmetic', baseHours: 3, weight: 4 },
  { name: 'Profit, Loss & Interest', section: 'QA', area: 'Arithmetic', baseHours: 3, weight: 4 },
  // ---- QA: Algebra ----
  { name: 'Linear & Quadratic Equations', section: 'QA', area: 'Algebra', baseHours: 4, weight: 5 },
  { name: 'Inequalities & Modulus', section: 'QA', area: 'Algebra', baseHours: 3, weight: 4 },
  { name: 'Functions & Graphs', section: 'QA', area: 'Algebra', baseHours: 3, weight: 3 },
  { name: 'Logarithms & Exponents', section: 'QA', area: 'Algebra', baseHours: 2.5, weight: 3 },
  { name: 'Progressions (AP, GP, HP)', section: 'QA', area: 'Algebra', baseHours: 3, weight: 4 },
  // ---- QA: Geometry ----
  { name: 'Triangles', section: 'QA', area: 'Geometry', baseHours: 4, weight: 4 },
  { name: 'Circles', section: 'QA', area: 'Geometry', baseHours: 3, weight: 3 },
  { name: 'Quadrilaterals & Polygons', section: 'QA', area: 'Geometry', baseHours: 2.5, weight: 3 },
  { name: 'Mensuration (2D & 3D)', section: 'QA', area: 'Geometry', baseHours: 3, weight: 3 },
  { name: 'Coordinate Geometry', section: 'QA', area: 'Geometry', baseHours: 2.5, weight: 2 },
  { name: 'Trigonometry', section: 'QA', area: 'Geometry', baseHours: 2, weight: 2 },
  // ---- QA: Number System ----
  { name: 'Divisibility & Remainders', section: 'QA', area: 'Number System', baseHours: 3, weight: 4 },
  { name: 'Factors, Factorials & HCF/LCM', section: 'QA', area: 'Number System', baseHours: 3, weight: 3 },
  { name: 'Base Systems & Digit Problems', section: 'QA', area: 'Number System', baseHours: 2, weight: 2 },
  // ---- QA: Modern Math ----
  { name: 'Permutation & Combination', section: 'QA', area: 'Modern Math', baseHours: 3.5, weight: 3 },
  { name: 'Probability', section: 'QA', area: 'Modern Math', baseHours: 2.5, weight: 3 },
  { name: 'Set Theory & Venn Diagrams', section: 'QA', area: 'Modern Math', baseHours: 2, weight: 3 },

  // ---- DILR: tracked as set families ----
  { name: 'Arrangements & Seating Puzzles', section: 'DILR', area: 'Logical Reasoning', baseHours: 5, weight: 5 },
  { name: 'Grid / Matrix Logic', section: 'DILR', area: 'Logical Reasoning', baseHours: 4, weight: 4 },
  { name: 'Games & Tournaments', section: 'DILR', area: 'Logical Reasoning', baseHours: 4, weight: 4 },
  { name: 'Venn Diagram Sets', section: 'DILR', area: 'Logical Reasoning', baseHours: 3, weight: 3 },
  { name: 'Scheduling & Sequencing', section: 'DILR', area: 'Logical Reasoning', baseHours: 3, weight: 3 },
  { name: 'Tables & Caselets', section: 'DILR', area: 'Data Interpretation', baseHours: 4, weight: 5 },
  { name: 'Bar, Line & Pie DI', section: 'DILR', area: 'Data Interpretation', baseHours: 3, weight: 4 },
  { name: 'Quant-heavy DI', section: 'DILR', area: 'Data Interpretation', baseHours: 4, weight: 4 },
  { name: 'Networks, Routes & Flows', section: 'DILR', area: 'Data Interpretation', baseHours: 3, weight: 3 },

  // ---- VARC ----
  { name: 'RC: Business & Economics', section: 'VARC', area: 'Reading Comprehension', baseHours: 4, weight: 5 },
  { name: 'RC: Science & Technology', section: 'VARC', area: 'Reading Comprehension', baseHours: 4, weight: 4 },
  { name: 'RC: Philosophy & Abstract', section: 'VARC', area: 'Reading Comprehension', baseHours: 5, weight: 5 },
  { name: 'RC: Humanities & Arts', section: 'VARC', area: 'Reading Comprehension', baseHours: 4, weight: 4 },
  { name: 'RC: History & Society', section: 'VARC', area: 'Reading Comprehension', baseHours: 4, weight: 4 },
  { name: 'Para Jumbles', section: 'VARC', area: 'Verbal Ability', baseHours: 3, weight: 4 },
  { name: 'Para Summary', section: 'VARC', area: 'Verbal Ability', baseHours: 2.5, weight: 4 },
  { name: 'Odd Sentence Out', section: 'VARC', area: 'Verbal Ability', baseHours: 2.5, weight: 3 },
  { name: 'Inference & Critical Reasoning', section: 'VARC', area: 'Verbal Ability', baseHours: 3, weight: 3 },
];

export const DEFAULT_MOCK_PROVIDERS = ['IMS', 'TIME', 'CL', 'Self-made', 'Other'];

export const DEFAULT_PLANNING: PlanningParams = {
  bufferPct: 0.25,
  maxTasksPerDay: 4,
  // Energy 1 halves the day; energy 5 adds a modest 20%. Deliberately
  // conservative - a good day should not licence an unrealistic plan.
  energyFactors: { 1: 0.5, 2: 0.75, 3: 1, 4: 1.1, 5: 1.2 },
  estimationAlpha: 0.25,
  estimationMinSamples: 3,
  estimationBounds: [0.6, 1.8],
  fullMockMin: 130,
  mockAnalysisMin: 90,
  sectionalMin: 45,
  sectionalAnalysisMin: 30,
  errorReviewMin: 8,
  topicRevisionMin: 25,
  atRiskBand: 5,
  habitStreakThreshold: 0.6,
};

/**
 * Default daily habits. These are the small, repeatable inputs that decide
 * whether the plan is executed at all - deliberately separate from tasks,
 * which are specific and change every week.
 */
export const HABIT_SEEDS = ['DILR sets', 'QA', 'Revision', 'RC', 'VA', 'Reading'];

/** Days-remaining thresholds that decide the current preparation phase. */
export const PHASE_THRESHOLDS = { foundation: 70, application: 28 };

export const TIME_WINDOWS: { key: TimeWindow; label: string; startHour: number; endHour: number }[] = [
  { key: 'early-morning', label: 'Early morning (5-8)', startHour: 5, endHour: 8 },
  { key: 'morning', label: 'Morning (8-12)', startHour: 8, endHour: 12 },
  { key: 'afternoon', label: 'Afternoon (12-17)', startHour: 12, endHour: 17 },
  { key: 'evening', label: 'Evening (17-21)', startHour: 17, endHour: 21 },
  { key: 'night', label: 'Night (21-1)', startHour: 21, endHour: 25 },
];

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = Object.fromEntries(
  TIME_WINDOWS.map((w) => [w.key, w.label]),
) as Record<TimeWindow, string>;

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  study: 'Study',
  practice: 'Practice',
  mock: 'Mock',
  sectional: 'Sectional',
  analysis: 'Analysis',
  revision: 'Revision',
  'error-review': 'Error review',
  planning: 'Planning',
  admin: 'Administrative',
  personal: 'Personal',
  buffer: 'Buffer',
};

/** How directly a task type converts into exam readiness (0-1). */
export const TASK_TYPE_EXAM_RELEVANCE: Record<TaskType, number> = {
  analysis: 1,
  mock: 0.95,
  sectional: 0.9,
  'error-review': 0.85,
  practice: 0.8,
  revision: 0.7,
  study: 0.65,
  planning: 0.3,
  admin: 0.15,
  personal: 0.1,
  buffer: 0,
};

export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  'concept-gap': 'Concept gap',
  calculation: 'Calculation error',
  misread: 'Misread question',
  silly: 'Silly mistake',
  selection: 'Bad question selection',
  'time-management': 'Time management',
  guessing: 'Guessing error',
  'knowledge-gap': 'Knowledge gap',
  approach: 'Approach problem',
  'too-slow': 'Could solve but too slow',
  panic: 'Panic / confusion',
  unknown: 'Unknown',
};

export const SET_MISS_REASON_LABELS: Record<SetMissReason, string> = {
  'chose-incorrectly': 'Chose the set incorrectly',
  'understood-not-solved': 'Understood but could not solve',
  calculation: 'Calculation issue',
  logic: 'Logic issue',
  time: 'Time issue',
  'abandoned-too-late': 'Abandoned too late',
  'abandoned-too-early': 'Abandoned too early',
  careless: 'Careless mistake',
};

export const COMMITMENT_TYPE_LABELS: Record<CommitmentType, string> = {
  college: 'College',
  work: 'Work',
  travel: 'Travel',
  family: 'Family',
  social: 'Social',
  exam: 'Exam',
  deadline: 'Deadline',
  personal: 'Personal',
  unexpected: 'Unexpected',
};

export const VARC_TYPE_LABELS: Record<string, string> = {
  rc: 'Reading comprehension',
  'para-jumble': 'Para jumble',
  'para-summary': 'Para summary',
  'odd-sentence': 'Odd sentence out',
  other: 'Other',
};

export const ENERGY_LABELS: Record<number, string> = {
  1: 'Very low',
  2: 'Low',
  3: 'Normal',
  4: 'High',
  5: 'Very high',
};

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
