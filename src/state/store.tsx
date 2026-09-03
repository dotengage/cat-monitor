/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addDays, endOfWeek, startOfWeek, today as todayISO } from '../domain/date';
import { nowISO, uid } from '../domain/ids';
import type {
  AppState,
  Commitment,
  DayLog,
  ErrorEntry,
  Goal,
  ID,
  ISODate,
  MissedTaskDecision,
  Mock,
  PlanningDecision,
  PracticeSession,
  ReviewAnswers,
  Settings,
  Task,
  Topic,
  UserProfile,
  WeekPlan,
} from '../domain/types';
import { repository } from '../data/repository';
import { createInitialState } from '../data/defaultState';
import { applyMissedDecision } from '../engine/missedTask';
import { generateWeek } from '../engine/generateWeek';
import { rebalanceWeek, type DecisionDraft } from '../engine/rebalance';
import { generateWeeklyReview, assessCapacityReality } from '../engine/weeklyReview';
import { calculateWeekCapacity } from '../engine/capacity';

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'reset' }
  | { type: 'replace'; state: AppState }
  | { type: 'profile/update'; patch: Partial<UserProfile> }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'onboarding/complete'; profile: Partial<UserProfile>; commitments: Omit<Commitment, keyof BaseFields>[]; baselineMock?: Omit<Mock, keyof BaseFields>; today: ISODate }
  | { type: 'commitment/add'; commitment: Omit<Commitment, keyof BaseFields> }
  | { type: 'commitment/update'; id: ID; patch: Partial<Commitment> }
  | { type: 'commitment/delete'; id: ID }
  | { type: 'goal/add'; goal: Omit<Goal, keyof BaseFields> }
  | { type: 'goal/update'; id: ID; patch: Partial<Goal> }
  | { type: 'goal/delete'; id: ID }
  | { type: 'topic/add'; topic: Omit<Topic, keyof BaseFields> }
  | { type: 'topic/update'; id: ID; patch: Partial<Topic> }
  | { type: 'topic/delete'; id: ID }
  | { type: 'task/add'; task: Omit<Task, keyof BaseFields> }
  | { type: 'task/update'; id: ID; patch: Partial<Task> }
  | { type: 'task/complete'; id: ID; actualMin?: number }
  | { type: 'task/partial'; id: ID; actualMin?: number }
  | { type: 'task/miss'; id: ID }
  | { type: 'task/postpone'; id: ID }
  | { type: 'task/remove'; id: ID; reason?: string }
  | { type: 'task/move'; id: ID; date: ISODate | null }
  | { type: 'task/decision'; id: ID; decision: MissedTaskDecision; today: ISODate }
  | { type: 'mock/add'; mock: Omit<Mock, keyof BaseFields> }
  | { type: 'mock/update'; id: ID; patch: Partial<Mock> }
  | { type: 'mock/delete'; id: ID }
  | { type: 'practice/add'; session: Omit<PracticeSession, keyof BaseFields> }
  | { type: 'practice/delete'; id: ID }
  | { type: 'error/add'; entry: Omit<ErrorEntry, keyof BaseFields> }
  | { type: 'error/update'; id: ID; patch: Partial<ErrorEntry> }
  | { type: 'error/delete'; id: ID }
  | { type: 'day/log'; log: Omit<DayLog, keyof BaseFields> }
  | { type: 'week/generate'; weekStart: ISODate; today: ISODate; targetPlannedMin?: number }
  | { type: 'week/rebalance'; weekStart: ISODate; today: ISODate }
  | { type: 'week/update'; id: ID; patch: Partial<WeekPlan> }
  | { type: 'review/save'; weekStart: ISODate; today: ISODate; answers: ReviewAnswers }
  | { type: 'decision/add'; decision: DecisionDraft }
  | { type: 'insight/dismiss'; id: string }
  | { type: 'rollover'; today: ISODate };

type BaseFields = { id: string; createdAt: string; updatedAt: string };

function stamped<T>(entity: T): T & BaseFields {
  const stamp = nowISO();
  return { ...(entity as object), id: uid(), createdAt: stamp, updatedAt: stamp } as T & BaseFields;
}

function touch<T extends BaseFields>(entity: T, patch: Partial<T>): T {
  return { ...entity, ...patch, updatedAt: nowISO() };
}

function pushDecision(state: AppState, draft: DecisionDraft): PlanningDecision[] {
  const stamp = nowISO();
  return [
    { ...draft, id: uid('dec'), createdAt: stamp, updatedAt: stamp },
    ...state.decisions,
  ].slice(0, 400);
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
    case 'replace':
      return action.state;

    case 'reset':
      return createInitialState();

    case 'profile/update':
      return { ...state, profile: touch(state.profile, action.patch) };

    case 'settings/update':
      return { ...state, settings: touch(state.settings, action.patch) };

    case 'onboarding/complete': {
      const profile = touch(state.profile, { ...action.profile, onboarded: true });
      const commitments = action.commitments.map((c) => stamped(c) as Commitment);
      const mocks = action.baselineMock ? [stamped(action.baselineMock) as Mock] : [];
      const goals = state.goals.map((g) =>
        g.isPrimary
          ? touch(g, {
              title: `CAT 2026: ${profile.targetPercentile} percentile or higher`,
              targetValue: profile.targetPercentile,
              deadline: profile.examDate,
            })
          : g,
      );
      const seeded: AppState = { ...state, profile, commitments, mocks, goals };
      const weekStart = startOfWeek(action.today, seeded.settings.weekStartsOn);
      const generated = generateWeek(seeded, weekStart, action.today, { generatedFrom: 'onboarding' });
      return {
        ...seeded,
        weeks: [generated.week],
        tasks: generated.tasks,
        decisions: generated.decisions.reduce<PlanningDecision[]>((acc, d) => {
          const stamp = nowISO();
          return [{ ...d, id: uid('dec'), createdAt: stamp, updatedAt: stamp }, ...acc];
        }, []),
      };
    }

    /* --- Commitments ------------------------------------------------ */
    case 'commitment/add':
      return { ...state, commitments: [...state.commitments, stamped(action.commitment) as Commitment] };
    case 'commitment/update':
      return {
        ...state,
        commitments: state.commitments.map((c) => (c.id === action.id ? touch(c, action.patch) : c)),
      };
    case 'commitment/delete':
      return { ...state, commitments: state.commitments.filter((c) => c.id !== action.id) };

    /* --- Goals ------------------------------------------------------- */
    case 'goal/add':
      return { ...state, goals: [...state.goals, stamped(action.goal) as Goal] };
    case 'goal/update':
      return { ...state, goals: state.goals.map((g) => (g.id === action.id ? touch(g, action.patch) : g)) };
    case 'goal/delete':
      return { ...state, goals: state.goals.filter((g) => g.id !== action.id || g.isPrimary) };

    /* --- Topics ------------------------------------------------------ */
    case 'topic/add':
      return { ...state, topics: [...state.topics, stamped(action.topic) as Topic] };
    case 'topic/update':
      return { ...state, topics: state.topics.map((t) => (t.id === action.id ? touch(t, action.patch) : t)) };
    case 'topic/delete':
      return { ...state, topics: state.topics.filter((t) => t.id !== action.id) };

    /* --- Tasks ------------------------------------------------------- */
    case 'task/add':
      return { ...state, tasks: [...state.tasks, stamped(action.task) as Task] };

    case 'task/update':
      return { ...state, tasks: state.tasks.map((t) => (t.id === action.id ? touch(t, action.patch) : t)) };

    case 'task/complete':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? touch(t, {
                status: 'done',
                actualMin: action.actualMin ?? t.actualMin ?? t.estimateMin,
                completedAt: nowISO(),
                needsDecision: false,
              })
            : t,
        ),
      };

    case 'task/partial':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? touch(t, {
                status: 'partial',
                actualMin: action.actualMin ?? Math.round(t.estimateMin / 2),
                completedAt: nowISO(),
                needsDecision: false,
              })
            : t,
        ),
      };

    case 'task/miss':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? touch(t, { status: 'missed', needsDecision: true }) : t)),
      };

    case 'task/postpone':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? touch(t, { status: 'postponed', date: null, weekStart: null, postponeCount: t.postponeCount + 1 })
            : t,
        ),
      };

    case 'task/remove': {
      const task = state.tasks.find((t) => t.id === action.id);
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? touch(t, { status: 'removed', needsDecision: false }) : t)),
        decisions: task
          ? pushDecision(state, {
              date: todayISO(),
              subject: task.title,
              subjectId: task.id,
              kind: 'REMOVE',
              reason: action.reason ?? 'Removed by user.',
              auto: false,
            })
          : state.decisions,
      };
    }

    case 'task/move':
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? touch(t, {
                date: action.date,
                weekStart: action.date ? startOfWeek(action.date, state.settings.weekStartsOn) : null,
                status: action.date ? 'planned' : 'postponed',
                needsDecision: false,
              })
            : t,
        ),
      };

    case 'task/decision': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      return {
        ...state,
        tasks: applyMissedDecision(state.tasks, action.id, action.decision, action.today),
        decisions: pushDecision(state, {
          date: action.today,
          subject: task.title,
          subjectId: task.id,
          kind: action.decision.kind,
          reason: action.decision.reason,
          detail: action.decision.replacementTitle,
          auto: false,
        }),
      };
    }

    /* --- CAT data ---------------------------------------------------- */
    case 'mock/add': {
      const mock = stamped(action.mock) as Mock;
      const analysisGoal = state.goals.find((g) => g.metric === 'mocks analysed');
      return {
        ...state,
        mocks: [...state.mocks, mock],
        goals: analysisGoal
          ? state.goals.map((g) =>
              g.id === analysisGoal.id
                ? touch(g, {
                    targetValue: state.mocks.length + 1,
                    currentValue: [...state.mocks, mock].filter((m) => m.analysed).length,
                  })
                : g,
            )
          : state.goals,
      };
    }
    case 'mock/update': {
      const mocks = state.mocks.map((m) => (m.id === action.id ? touch(m, action.patch) : m));
      const primary = state.goals.find((g) => g.isPrimary);
      const latest = mocks
        .filter((m) => m.kind === 'full' && typeof m.overallPercentile === 'number')
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .pop();
      return {
        ...state,
        mocks,
        goals: state.goals.map((g) => {
          if (primary && g.id === primary.id && latest) {
            return touch(g, { currentValue: latest.overallPercentile });
          }
          if (g.metric === 'mocks analysed') {
            return touch(g, { targetValue: mocks.length, currentValue: mocks.filter((m) => m.analysed).length });
          }
          return g;
        }),
      };
    }
    case 'mock/delete':
      return { ...state, mocks: state.mocks.filter((m) => m.id !== action.id) };

    case 'practice/add':
      return { ...state, practice: [...state.practice, stamped(action.session) as PracticeSession] };
    case 'practice/delete':
      return { ...state, practice: state.practice.filter((p) => p.id !== action.id) };

    case 'error/add':
      return { ...state, errors: [...state.errors, stamped(action.entry) as ErrorEntry] };
    case 'error/update': {
      const errors = state.errors.map((e) => (e.id === action.id ? touch(e, action.patch) : e));
      return {
        ...state,
        errors,
        goals: state.goals.map((g) =>
          g.metric === 'errors resolved'
            ? touch(g, { targetValue: errors.length, currentValue: errors.filter((e) => e.resolved).length })
            : g,
        ),
      };
    }
    case 'error/delete':
      return { ...state, errors: state.errors.filter((e) => e.id !== action.id) };

    /* --- Day logs ----------------------------------------------------- */
    case 'day/log': {
      const existing = state.dayLogs.find((d) => d.date === action.log.date);
      const dayLogs = existing
        ? state.dayLogs.map((d) => (d.id === existing.id ? touch(d, action.log) : d))
        : [...state.dayLogs, stamped(action.log) as DayLog];
      return { ...state, dayLogs };
    }

    /* --- Weeks -------------------------------------------------------- */
    case 'week/generate': {
      const generated = generateWeek(state, action.weekStart, action.today, {
        targetPlannedMin: action.targetPlannedMin,
        generatedFrom: 'manual',
      });
      const weeks = [...state.weeks.filter((w) => w.startDate !== action.weekStart), generated.week];
      // Auto-generated tasks for the same week are replaced; anything the user
      // created or already acted on is preserved.
      const keep = state.tasks.filter(
        (t) => !(t.origin === 'auto' && t.status === 'planned' && t.weekStart === action.weekStart),
      );
      return {
        ...state,
        weeks,
        tasks: [...keep, ...generated.tasks],
        decisions: generated.decisions.reduce((acc, d) => pushDecision({ ...state, decisions: acc }, d), state.decisions),
      };
    }

    case 'week/rebalance': {
      const result = rebalanceWeek(state, action.weekStart, action.today);
      let decisions = state.decisions;
      for (const d of result.decisions) decisions = pushDecision({ ...state, decisions }, d);
      const week = state.weeks.find((w) => w.startDate === action.weekStart);
      return {
        ...state,
        tasks: result.tasks,
        decisions,
        weeks: week
          ? state.weeks.map((w) => (w.id === week.id ? touch(w, { plannedMin: result.after.plannedMin, generatedFrom: 'rebalance' }) : w))
          : state.weeks,
      };
    }

    case 'week/update':
      return { ...state, weeks: state.weeks.map((w) => (w.id === action.id ? touch(w, action.patch) : w)) };

    /* --- Weekly review ------------------------------------------------ */
    case 'review/save': {
      const output = generateWeeklyReview(state, action.weekStart, action.today, action.answers);
      const reality = assessCapacityReality(state, action.weekStart, action.today);
      const stamp = nowISO();
      const review = {
        id: uid('review'),
        createdAt: stamp,
        updatedAt: stamp,
        weekStart: action.weekStart,
        answers: action.answers,
        output,
        appliedAt: stamp,
      };

      const weekEnd = endOfWeek(action.weekStart, state.settings.weekStartsOn);
      const capacity = calculateWeekCapacity(state, action.weekStart, action.weekStart);
      const record = {
        id: uid('cap'),
        createdAt: stamp,
        updatedAt: stamp,
        weekStart: action.weekStart,
        plannedMin: output.planVsReality.plannedMin,
        capacityMin: capacity.plannedMin,
        actualMin: output.planVsReality.actualMin,
      };

      const withRecord: AppState = {
        ...state,
        reviews: [...state.reviews, review],
        capacityRecords: [...state.capacityRecords.filter((r) => r.weekStart !== action.weekStart), record],
      };

      // The review feeds the planner directly: next week is generated here.
      const nextStart = addDays(weekEnd, 1);
      const generated = generateWeek(withRecord, nextStart, action.today, {
        targetPlannedMin: reality.targetPlannedMin,
        generatedFrom: 'review',
        reviewId: review.id,
      });

      let decisions = withRecord.decisions;
      for (const d of generated.decisions) decisions = pushDecision({ ...withRecord, decisions }, d);
      decisions = pushDecision(
        { ...withRecord, decisions },
        {
          date: action.today,
          subject: `Week of ${nextStart}`,
          kind: 'CAPACITY',
          reason: reality.explanation,
          auto: true,
        },
      );

      const keep = withRecord.tasks.filter(
        (t) => !(t.origin === 'auto' && t.status === 'planned' && t.weekStart === nextStart),
      );
      return {
        ...withRecord,
        weeks: [...withRecord.weeks.filter((w) => w.startDate !== nextStart), generated.week],
        tasks: [...keep, ...generated.tasks],
        decisions,
      };
    }

    case 'decision/add':
      return { ...state, decisions: pushDecision(state, action.decision) };

    case 'insight/dismiss':
      return { ...state, dismissedInsights: [...state.dismissedInsights, action.id] };

    /* --- Day rollover -------------------------------------------------- */
    case 'rollover': {
      // Past-dated planned work becomes "missed and awaiting a decision".
      // It is deliberately NOT moved to today: automatic carry-forward is the
      // behaviour this app exists to avoid.
      const tasks = state.tasks.map((t) =>
        t.status === 'planned' && t.date !== null && t.date < action.today
          ? { ...t, status: 'missed' as const, needsDecision: true, updatedAt: nowISO() }
          : t,
      );
      return tasks === state.tasks ? state : { ...state, tasks };
    }

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

interface StoreValue {
  state: AppState;
  dispatch: (action: Action) => void;
  loading: boolean;
  today: ISODate;
  weekStart: ISODate;
  exportData: () => Promise<string>;
  importData: (json: string) => Promise<void>;
  resetData: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState());
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<ISODate>(() => todayISO());
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    repository
      .load()
      .then((loaded) => {
        if (cancelled) return;
        dispatch({ type: 'hydrate', state: loaded });
        dispatch({ type: 'rollover', today: todayISO() });
      })
      .catch((err) => console.error('Failed to load saved data', err))
      .finally(() => {
        if (!cancelled) {
          hydrated.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence. The UI never awaits a write.
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      repository.save(state).catch((err) => console.error('Failed to save', err));
    }, 300);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state]);

  // Daily automatic backup, so a bad import or reset is recoverable.
  useEffect(() => {
    if (loading || !state.settings.autoBackup) return;
    const key = `cat-monitor:last-backup`;
    const last = (() => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    })();
    if (last === today) return;
    repository
      .createBackup(state, `Daily snapshot ${today}`)
      .then(() => {
        try {
          localStorage.setItem(key, today);
        } catch {
          /* ignore */
        }
      })
      .catch((err) => console.warn('Backup failed', err));
    // Intentionally runs once per calendar day, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, today, state.settings.autoBackup]);

  // Keep "today" correct across midnight without a reload.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = todayISO();
      setToday((prev) => {
        if (prev !== now) dispatch({ type: 'rollover', today: now });
        return now;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const exportData = useCallback(() => repository.export(), []);

  const importData = useCallback(async (json: string) => {
    const imported = await repository.import(json);
    dispatch({ type: 'replace', state: imported });
  }, []);

  const resetData = useCallback(async () => {
    await repository.createBackup(state, 'Before reset');
    await repository.clear();
    dispatch({ type: 'reset' });
  }, [state]);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      dispatch,
      loading,
      today,
      weekStart: startOfWeek(today, state.settings.weekStartsOn),
      exportData,
      importData,
      resetData,
    }),
    [state, loading, today, exportData, importData, resetData],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
