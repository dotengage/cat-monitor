import {
  DEFAULT_EXAM_DATE,
  DEFAULT_MOCK_PROVIDERS,
  DEFAULT_PLANNING,
  DEFAULT_PREP_MODE,
  DEFAULT_TARGET_PERCENTILE,
  STATE_VERSION,
  TOPIC_SEEDS,
} from '../config/catConfig';
import { today as todayISO } from '../domain/date';
import { nowISO, uid } from '../domain/ids';
import type { AppState, EnergyLevel, Goal, Settings, Topic, UserProfile } from '../domain/types';

export function createTopics(): Topic[] {
  const stamp = nowISO();
  return TOPIC_SEEDS.map((seed) => ({
    id: uid('topic'),
    createdAt: stamp,
    updatedAt: stamp,
    name: seed.name,
    section: seed.section,
    area: seed.area,
    baseHours: seed.baseHours,
    weight: seed.weight,
    status: 'not-started' as const,
    builtIn: true,
  }));
}

export function createProfile(start: string): UserProfile {
  const stamp = nowISO();
  const energyByDay: Record<number, EnergyLevel> = { 0: 4, 1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 4 };
  return {
    id: uid('profile'),
    createdAt: stamp,
    updatedAt: stamp,
    examDate: DEFAULT_EXAM_DATE,
    startDate: start,
    targetPercentile: DEFAULT_TARGET_PERCENTILE,
    prepMode: DEFAULT_PREP_MODE,
    weekdayHours: { min: 1, normal: 3, max: 5 },
    weekendHours: { min: 2, normal: 5, max: 8 },
    bufferPct: DEFAULT_PLANNING.bufferPct,
    energyByDay,
    bestWindow: 'morning',
    worstWindow: 'afternoon',
    heavyDays: [],
    longStudyDays: [0, 6],
    onboarded: false,
  };
}

export function createSettings(): Settings {
  const stamp = nowISO();
  return {
    id: uid('settings'),
    createdAt: stamp,
    updatedAt: stamp,
    theme: 'system',
    weekStartsOn: 1,
    mockProviders: [...DEFAULT_MOCK_PROVIDERS],
    planning: { ...DEFAULT_PLANNING, energyFactors: { ...DEFAULT_PLANNING.energyFactors } },
    notifications: { weeklyReviewReminder: true, dailyCheckIn: true },
    autoBackup: true,
  };
}

export function createGoals(examDate: string, target: number): Goal[] {
  const stamp = nowISO();
  const base = { createdAt: stamp, updatedAt: stamp, archived: false, dependsOn: [] as string[] };
  return [
    {
      ...base,
      id: uid('goal'),
      title: `CAT 2026: ${target} percentile or higher`,
      priority: 'P1',
      isPrimary: true,
      description:
        'The outcome goal. Study hours are an input; mock performance, section balance and analysis quality are the measures that matter.',
      metric: 'percentile',
      targetValue: target,
      currentValue: 0,
      deadline: examDate,
    },
    {
      ...base,
      id: uid('goal'),
      title: 'Mock analysis discipline',
      priority: 'P1',
      isPrimary: false,
      description: 'Every mock attempted is fully analysed before the next one is taken.',
      metric: 'mocks analysed',
      targetValue: 0,
      currentValue: 0,
      deadline: examDate,
    },
    {
      ...base,
      id: uid('goal'),
      title: 'Error recurrence reduction',
      priority: 'P1',
      isPrimary: false,
      description: 'Every logged error is revisited and either resolved or re-planned.',
      metric: 'errors resolved',
      deadline: examDate,
    },
  ];
}

export function createInitialState(start = todayISO()): AppState {
  const profile = createProfile(start);
  return {
    version: STATE_VERSION,
    profile,
    settings: createSettings(),
    goals: createGoals(profile.examDate, profile.targetPercentile),
    topics: createTopics(),
    commitments: [],
    weeks: [],
    tasks: [],
    mocks: [],
    practice: [],
    errors: [],
    dayLogs: [],
    reviews: [],
    decisions: [],
    capacityRecords: [],
    dismissedInsights: [],
  };
}
