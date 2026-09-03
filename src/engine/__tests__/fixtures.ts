import { createInitialState } from '../../data/defaultState';
import { nowISO, uid } from '../../domain/ids';
import type {
  AppState,
  Commitment,
  DayLog,
  ErrorEntry,
  Mock,
  PracticeSession,
  Task,
} from '../../domain/types';

export const TODAY = '2026-09-03';
export const WEEK_START = '2026-08-31'; // Monday of the week containing TODAY

export function makeState(patch: Partial<AppState> = {}): AppState {
  const base = createInitialState(TODAY);
  base.profile.onboarded = true;
  return {
    ...base,
    ...patch,
    profile: { ...base.profile, ...(patch.profile ?? {}) },
    settings: { ...base.settings, ...(patch.settings ?? {}) },
  };
}

const stamp = () => ({ id: uid('t'), createdAt: nowISO(), updatedAt: nowISO() });

export function makeTask(over: Partial<Task> = {}): Task {
  return {
    ...stamp(),
    title: 'Practice task',
    date: TODAY,
    weekStart: WEEK_START,
    type: 'practice',
    estimateMin: 60,
    importance: 'important',
    energyRequired: 3,
    impact: 3,
    dependsOn: [],
    status: 'planned',
    locked: false,
    postponeCount: 0,
    origin: 'auto',
    ...over,
  };
}

export function makeMock(over: Partial<Mock> = {}): Mock {
  return {
    ...stamp(),
    kind: 'full',
    date: TODAY,
    provider: 'IMS',
    name: 'Mock 1',
    overallScore: 80,
    overallPercentile: 80,
    sections: {
      VARC: { score: 30, percentile: 85, attempts: 18, correct: 12, incorrect: 6 },
      DILR: { score: 18, percentile: 62, attempts: 12, correct: 6, incorrect: 6 },
      QA: { score: 32, percentile: 78, attempts: 20, correct: 12, incorrect: 8 },
    },
    lessons: [],
    analysed: true,
    weakTopicIds: [],
    ...over,
  };
}

export function makePractice(over: Partial<PracticeSession> = {}): PracticeSession {
  return {
    ...stamp(),
    date: TODAY,
    section: 'QA',
    label: 'Practice',
    attempted: 12,
    correct: 8,
    timeMin: 30,
    difficulty: 3,
    confidence: 3,
    ...over,
  };
}

export function makeError(over: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    ...stamp(),
    date: TODAY,
    section: 'QA',
    question: 'Q1',
    errorType: 'calculation',
    explanation: '',
    correctedApproach: '',
    resolved: false,
    ...over,
  };
}

export function makeCommitment(over: Partial<Commitment> = {}): Commitment {
  return {
    ...stamp(),
    title: 'Commitment',
    type: 'college',
    startDate: TODAY,
    endDate: TODAY,
    recurrence: 'once',
    daysOfWeek: [],
    hoursPerDay: 3,
    reducesCapacity: true,
    flexible: false,
    ...over,
  };
}

export function makeDayLog(over: Partial<DayLog> = {}): DayLog {
  return {
    ...stamp(),
    date: TODAY,
    energy: 3,
    estimatedAvailableMin: 180,
    focusedMin: 120,
    unexpectedCommitments: '',
    ...over,
  };
}

/** A series of completed tasks used to drive the estimation model. */
export function completedTasks(count: number, estimateMin: number, actualMin: number, over: Partial<Task> = {}): Task[] {
  return Array.from({ length: count }, (_, i) =>
    makeTask({
      status: 'done',
      estimateMin,
      actualMin,
      completedAt: `2026-08-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
      date: `2026-08-${String(10 + i).padStart(2, '0')}`,
      ...over,
    }),
  );
}
