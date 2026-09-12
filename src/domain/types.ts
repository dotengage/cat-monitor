import type { ThemeName } from '../config/themes';
import type { ISODate } from './date';

export type { ISODate };
export type ID = string;

/** Every persisted record carries a stable id and audit timestamps. */
export interface Entity {
  id: ID;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export type SectionKey = 'VARC' | 'DILR' | 'QA';

export type GoalPriority = 'P1' | 'P2' | 'P3';

export type Importance = 'critical' | 'important' | 'optional';

export type TaskType =
  | 'study'
  | 'practice'
  | 'mock'
  | 'sectional'
  | 'analysis'
  | 'revision'
  | 'error-review'
  | 'planning'
  | 'admin'
  | 'personal'
  | 'buffer';

export type TaskStatus =
  | 'planned'
  | 'done'
  | 'partial'
  | 'missed'
  | 'postponed'
  | 'removed';

/** 1 = very low - 5 = very high. */
export type EnergyLevel = 1 | 2 | 3 | 4 | 5;

export type EnergyMode = 'HIGH' | 'NORMAL' | 'LOW' | 'VERY_LOW';

/** Qualitative status. `UNCONFIRMED` means "not enough evidence yet". */
export type TrackStatus = 'ON_TRACK' | 'AT_RISK' | 'BEHIND' | 'UNCONFIRMED';

export type WorkloadHealth = 'COMFORTABLE' | 'TIGHT' | 'AT_RISK' | 'UNSUSTAINABLE';

export type Trend = 'IMPROVING' | 'FLAT' | 'DECLINING' | 'VOLATILE' | 'UNKNOWN';

export type TimeWindow = 'early-morning' | 'morning' | 'afternoon' | 'evening' | 'night';

export type CommitmentType =
  | 'college'
  | 'work'
  | 'travel'
  | 'family'
  | 'social'
  | 'exam'
  | 'deadline'
  | 'personal'
  | 'unexpected';

export type PlanningDecisionKind =
  | 'RESCHEDULE'
  | 'SHORTEN'
  | 'COMBINE'
  | 'POSTPONE'
  | 'DELEGATE'
  | 'REPLACE'
  | 'REMOVE'
  | 'KEEP'
  | 'PROMOTE'
  | 'GENERATE'
  | 'CAPACITY'
  | 'ESTIMATE';

export type ErrorType =
  | 'concept-gap'
  | 'calculation'
  | 'misread'
  | 'silly'
  | 'selection'
  | 'time-management'
  | 'guessing'
  | 'knowledge-gap'
  | 'approach'
  | 'too-slow'
  | 'panic'
  | 'unknown';

/** Why a DILR set went wrong - tracked at set level, not question level. */
export type SetMissReason =
  | 'chose-incorrectly'
  | 'understood-not-solved'
  | 'calculation'
  | 'logic'
  | 'time'
  | 'abandoned-too-late'
  | 'abandoned-too-early'
  | 'careless';

/* ------------------------------------------------------------------ */
/* Profile, capacity, energy                                           */
/* ------------------------------------------------------------------ */

export interface HourBand {
  min: number;
  normal: number;
  max: number;
}

export interface UserProfile extends Entity {
  name?: string;
  examDate: ISODate;
  startDate: ISODate;
  targetPercentile: number;
  prepMode: string;
  /** Hours per day, self-reported during onboarding. */
  weekdayHours: HourBand;
  weekendHours: HourBand;
  /** Fraction of raw capacity held back as buffer (0.20 - 0.30). */
  bufferPct: number;
  /** Energy 1-5 keyed by `Date.getDay()` (0 = Sunday). */
  energyByDay: Record<number, EnergyLevel>;
  bestWindow: TimeWindow;
  worstWindow: TimeWindow;
  heavyDays: number[];
  longStudyDays: number[];
  onboarded: boolean;
}

export interface Commitment extends Entity {
  title: string;
  type: CommitmentType;
  startDate: ISODate;
  endDate: ISODate;
  /** Weekly recurrence uses `daysOfWeek`; 'once' uses the date range. */
  recurrence: 'once' | 'weekly';
  daysOfWeek: number[];
  /** Hours consumed on each affected day. */
  hoursPerDay: number;
  /**
   * Whether these hours come out of planning capacity.
   *
   * Routine recurring commitments (college, work) are normally already
   * reflected in the study hours the user stated during onboarding - the
   * "3 hours on a weekday" figure is what is left after lectures. Subtracting
   * them again would drive capacity to zero, so they default to `false`.
   * Everything else - travel, exams, one-off events - genuinely removes time
   * the user had counted on, so it defaults to `true`.
   */
  reducesCapacity: boolean;
  flexible: boolean;
  notes?: string;
}

export interface SectionStudyEntry {
  /** Minutes spent on this section today. */
  minutes: number;
  /** What was actually covered, in the user's own words. */
  topics: string;
}

export interface DayLog extends Entity {
  date: ISODate;
  energy: EnergyLevel;
  /** What the user thought was available, in minutes. */
  estimatedAvailableMin: number;
  /** What they actually spent focused, in minutes. */
  focusedMin: number;
  unexpectedCommitments: string;
  note?: string;
  /**
   * The daily study log: what was covered per section and for how long.
   * When present, `focusedMin` is kept in step with the sum, so logging
   * study also feeds the capacity model's realism factor.
   */
  study?: Partial<Record<SectionKey, SectionStudyEntry>>;
}

/* ------------------------------------------------------------------ */
/* Habits and streaks                                                  */
/* ------------------------------------------------------------------ */

export interface Habit extends Entity {
  name: string;
  /** Display order in the tracker grid. */
  order: number;
  active: boolean;
}

/** One row of the habit tracker: the marks for a single day. */
export interface HabitDay extends Entity {
  date: ISODate;
  /** habitId -> done. A missing key means "not marked". */
  marks: Record<ID, boolean>;
  note?: string;
}

export interface CapacityRecord extends Entity {
  weekStart: ISODate;
  plannedMin: number;
  capacityMin: number;
  actualMin: number;
}

/* ------------------------------------------------------------------ */
/* Goals, weeks, tasks                                                 */
/* ------------------------------------------------------------------ */

export interface Goal extends Entity {
  title: string;
  priority: GoalPriority;
  description?: string;
  /** The primary goal drives the whole feasibility engine. */
  isPrimary: boolean;
  metric: string;
  targetValue?: number;
  currentValue?: number;
  deadline?: ISODate;
  archived: boolean;
  dependsOn: ID[];
}

export interface WeeklyOutcome {
  id: ID;
  title: string;
  metric: string;
  section?: SectionKey;
  goalId?: ID;
  achieved: boolean;
  /** 0-1, derived from linked tasks unless manually set. */
  progress?: number;
}

export interface WeekPlan extends Entity {
  startDate: ISODate;
  endDate: ISODate;
  outcomes: WeeklyOutcome[];
  /** Snapshot of the numbers used when the week was generated. */
  capacityMin: number;
  plannedMin: number;
  bufferMin: number;
  generatedFrom: 'onboarding' | 'review' | 'manual' | 'rebalance';
  reviewId?: ID;
  focusNote?: string;
}

export interface Task extends Entity {
  title: string;
  detail?: string;
  /** `null` means backlog: identified work with no committed date. */
  date: ISODate | null;
  weekStart: ISODate | null;
  type: TaskType;
  section?: SectionKey;
  topicId?: ID;
  goalId?: ID;
  outcomeId?: ID;
  estimateMin: number;
  actualMin?: number;
  importance: Importance;
  /** Energy required, 1-5. High-cognition work is 4-5. */
  energyRequired: EnergyLevel;
  /** Expected contribution to readiness, 1-5. Drives value density. */
  impact: number;
  dependsOn: ID[];
  deadline?: ISODate;
  status: TaskStatus;
  /** User-protected tasks are never auto-moved or auto-removed. */
  locked: boolean;
  postponeCount: number;
  completedAt?: string;
  window?: TimeWindow;
  origin: 'auto' | 'user';
  /** Set when a missed task still needs an explicit decision. */
  needsDecision?: boolean;
  sourceRef?: string;
}

export interface PlanningDecision extends Entity {
  date: ISODate;
  subject: string;
  subjectId?: ID;
  kind: PlanningDecisionKind;
  reason: string;
  detail?: string;
  auto: boolean;
  reverted?: boolean;
}

/* ------------------------------------------------------------------ */
/* CAT tracking                                                        */
/* ------------------------------------------------------------------ */

export interface Topic extends Entity {
  name: string;
  section: SectionKey;
  area: string;
  /** Rough hours to reach working competence from zero. */
  baseHours: number;
  /** 1-5 exam frequency / return on investment. */
  weight: number;
  status: 'not-started' | 'learning' | 'practised' | 'strong' | 'skipped';
  builtIn: boolean;
}

export interface SectionScore {
  score: number;
  percentile: number;
  attempts: number;
  correct: number;
  incorrect: number;
}

export interface Mock extends Entity {
  kind: 'full' | 'sectional';
  date: ISODate;
  provider: string;
  name: string;
  /** Only present for sectionals. */
  section?: SectionKey;
  overallScore?: number;
  overallPercentile?: number;
  sections: Partial<Record<SectionKey, SectionScore>>;
  dilrSetsAttempted?: number;
  dilrSetsSolved?: number;
  timeNotes?: string;
  selectionNotes?: string;
  mainMistakes?: string;
  lessons: string[];
  analysed: boolean;
  analysedAt?: string;
  weakTopicIds: ID[];
}

export interface PracticeSession extends Entity {
  date: ISODate;
  section: SectionKey;
  topicId?: ID;
  label: string;
  attempted: number;
  correct: number;
  timeMin: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  confidence: 1 | 2 | 3 | 4 | 5;
  /** DILR only. */
  setsAttempted?: number;
  setsSolved?: number;
  setMissReasons?: SetMissReason[];
  /** VARC only. */
  varcType?: 'rc' | 'para-jumble' | 'para-summary' | 'odd-sentence' | 'other';
  passageType?: string;
  notes?: string;
  taskId?: ID;
}

export interface ErrorEntry extends Entity {
  date: ISODate;
  section: SectionKey;
  topicId?: ID;
  question: string;
  errorType: ErrorType;
  explanation: string;
  correctedApproach: string;
  revisitDate?: ISODate;
  resolved: boolean;
  resolvedAt?: string;
  mockId?: ID;
}

/* ------------------------------------------------------------------ */
/* Reviews                                                             */
/* ------------------------------------------------------------------ */

export interface ReviewAnswers {
  completedNote: string;
  missedNote: string;
  realityNote: string;
  energy: EnergyLevel;
  actualFocusedHours: number;
  friction: string;
  wins: string;
}

export interface WeeklyReviewOutput {
  weekStart: ISODate;
  weekEnd: ISODate;
  completed: string[];
  missed: string[];
  planVsReality: {
    plannedMin: number;
    actualMin: number;
    plannedTasks: number;
    completedTasks: number;
    plannedOutcomes: number;
    achievedOutcomes: number;
    estimatedMin: number;
    loggedMin: number;
    expectedCapacityMin: number;
    actualCapacityMin: number;
    notes: string[];
  };
  goalStatus: { goalId: ID; title: string; status: TrackStatus; reason: string }[];
  recalculatedWorkload: RemainingWorkload;
  whatChanged: string[];
  nextWeek: {
    priorities: string[];
    outcomes: string[];
    revisedPlannedMin: number;
  };
  removed: string[];
  deprioritised: string[];
  risks: string[];
  singleFocus: string;
}

export interface WeeklyReview extends Entity {
  weekStart: ISODate;
  answers: ReviewAnswers;
  /** Rendered review output, stored so history stays readable. */
  output: WeeklyReviewOutput;
  appliedAt?: string;
}

/* ------------------------------------------------------------------ */
/* Engine outputs                                                      */
/* ------------------------------------------------------------------ */

export interface CapacityBreakdown {
  date: ISODate;
  baseMin: number;
  energyFactor: number;
  commitmentFactor: number;
  realismFactor: number;
  rawMin: number;
  plannedMin: number;
  bufferMin: number;
  minMin: number;
  maxMin: number;
  commitments: { title: string; hours: number }[];
  energy: EnergyLevel;
}

export interface RemainingWorkload {
  totalMin: number;
  completedMin: number;
  remainingMin: number;
  weeksRemaining: number;
  requiredPerWeekMin: number;
  actualPerWeekMin: number;
  realisticPerWeekMin: number;
  surplusMin: number;
  health: WorkloadHealth;
  breakdown: { label: string; min: number }[];
}

export interface PriorityComponents {
  goalPriority: number;
  importance: number;
  deadline: number;
  dependency: number;
  weakness: number;
  examRelevance: number;
  staleness: number;
  energyFit: number;
  valueDensity: number;
}

export interface TaskPriority {
  taskId: ID;
  score: number;
  components: PriorityComponents;
}

export interface SectionReadiness {
  section: SectionKey;
  status: TrackStatus;
  readiness: number;
  latestPercentile?: number;
  trend: Trend;
  accuracy?: number;
  coverage: number;
  weakTopics: { topicId: ID; name: string; accuracy: number }[];
  errorRecurrence: number;
  nextAction: string;
  reason: string;
}

export interface Trajectory {
  status: TrackStatus;
  confidence: 'none' | 'low' | 'medium' | 'high';
  current?: number;
  target: number;
  projected?: number;
  trend: Trend;
  slopePerWeek?: number;
  daysRemaining: number;
  requiredImprovement?: number;
  constraint?: SectionKey;
  reason: string;
  recommendedAction: string;
  history: { date: ISODate; percentile: number }[];
}

export interface Conflict {
  id: string;
  kind: 'time' | 'energy' | 'deadline' | 'goal' | 'capacity';
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  suggestion: string;
  action?: { label: string; kind: 'rebalance' | 'trim' | 'move'; date?: ISODate };
}

export interface BehaviourPattern {
  id: string;
  kind:
    | 'morning-failure'
    | 'repeated-postpone'
    | 'underestimation'
    | 'overestimation'
    | 'capacity-drift'
    | 'consistency'
    | 'fast-completion';
  title: string;
  detail: string;
  recommendation: string;
  confidence: 'low' | 'medium' | 'high';
  samples: number;
  data?: Record<string, number | string>;
}

export interface Insight {
  id: string;
  text: string;
  tone: 'neutral' | 'positive' | 'warning' | 'critical';
  source: string;
}

export interface MissedTaskDecision {
  taskId: ID;
  kind: PlanningDecisionKind;
  reason: string;
  replacementTitle?: string;
  newEstimateMin?: number;
  newDate?: ISODate | null;
  combineWithTaskId?: ID;
  remainingWorkloadMin: number;
  availableCapacityMin: number;
  verdict: 'manageable' | 'tight' | 'over capacity';
}

export interface MonthlyStrategy {
  monthKey: string;
  label: string;
  phase: 'FOUNDATION' | 'APPLICATION' | 'READINESS';
  objective: string;
  keyOutcomes: string[];
  projects: string[];
  metrics: { label: string; target: string; actual: string; met: boolean }[];
  deadlines: { label: string; date: ISODate }[];
  completionRequirements: string[];
  daysInMonthRemaining: number;
}

/* ------------------------------------------------------------------ */
/* Settings + app state                                                */
/* ------------------------------------------------------------------ */

export interface PlanningParams {
  /** Buffer fraction held back from raw capacity. */
  bufferPct: number;
  /** Maximum planned tasks generated per day. */
  maxTasksPerDay: number;
  /** Energy multipliers keyed by energy level. */
  energyFactors: Record<number, number>;
  /** Rolling-average weight for duration learning. */
  estimationAlpha: number;
  /** Minimum samples before estimates are adjusted. */
  estimationMinSamples: number;
  /** Cap on learned estimate adjustment. */
  estimationBounds: [number, number];
  /** Minutes budgeted for analysing one full mock. */
  mockAnalysisMin: number;
  fullMockMin: number;
  sectionalMin: number;
  sectionalAnalysisMin: number;
  /** Minutes per unresolved error during review. */
  errorReviewMin: number;
  /** Minutes to revise one covered topic. */
  topicRevisionMin: number;
  /** Percentile band treated as "close enough to keep the target alive". */
  atRiskBand: number;
  /** Day score at or above which a day counts towards the habit streak. */
  habitStreakThreshold: number;
}

/** Name and mark shown in the sidebar, the browser tab and the installed app. */
export interface Brand {
  name: string;
  /** One or two characters - a letter or an emoji - used when there is no image. */
  glyph: string;
  /** Data URL of an uploaded mark, downscaled before it is stored. */
  image?: string;
}

export interface Settings extends Entity {
  theme: ThemeName;
  brand: Brand;
  weekStartsOn: 0 | 1;
  mockProviders: string[];
  planning: PlanningParams;
  notifications: { weeklyReviewReminder: boolean; dailyCheckIn: boolean };
  autoBackup: boolean;
}

export interface AppState {
  version: number;
  profile: UserProfile;
  settings: Settings;
  goals: Goal[];
  topics: Topic[];
  commitments: Commitment[];
  weeks: WeekPlan[];
  tasks: Task[];
  mocks: Mock[];
  practice: PracticeSession[];
  errors: ErrorEntry[];
  dayLogs: DayLog[];
  reviews: WeeklyReview[];
  decisions: PlanningDecision[];
  capacityRecords: CapacityRecord[];
  habits: Habit[];
  habitDays: HabitDay[];
  dismissedInsights: string[];
  /**
   * Tombstones: entity id -> ISO timestamp of deletion.
   *
   * Without these, syncing would resurrect anything deleted on one device,
   * because the other device still holds the record. Pruned after 90 days.
   */
  deletedIds: Record<string, string>;
}
