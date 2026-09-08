import { useMemo, useState } from 'react';
import {
  COMMITMENT_TYPE_LABELS,
  DAY_LABELS,
  DEFAULT_MOCK_PROVIDERS,
  ENERGY_LABELS,
  TIME_WINDOWS,
} from '../config/catConfig';
import { addDays, daysBetween, formatHours, formatLongDate } from '../domain/date';
import type {
  Commitment,
  CommitmentType,
  EnergyLevel,
  Mock,
  SectionKey,
  TimeWindow,
  UserProfile,
} from '../domain/types';
import { useStore } from '../state/store';
import { Callout, Card, ChoiceGroup, Field } from '../ui/components';
import { SyncSetup } from '../ui/components/SyncSetup';

type DraftCommitment = Omit<Commitment, 'id' | 'createdAt' | 'updatedAt'>;

const STEPS = ['Goal', 'Commitments', 'Available time', 'Energy', 'Baseline', 'Confirm'];

const emptySection = { score: 0, percentile: 0, attempts: 0, correct: 0, incorrect: 0 };

export function Onboarding() {
  const { state, dispatch, today } = useStore();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<'setup' | 'restore'>('setup');

  const [profile, setProfile] = useState<Partial<UserProfile>>({
    examDate: state.profile.examDate,
    targetPercentile: state.profile.targetPercentile,
    prepMode: state.profile.prepMode,
    weekdayHours: state.profile.weekdayHours,
    weekendHours: state.profile.weekendHours,
    bufferPct: state.profile.bufferPct,
    energyByDay: state.profile.energyByDay,
    bestWindow: state.profile.bestWindow,
    worstWindow: state.profile.worstWindow,
    heavyDays: [],
    longStudyDays: [0, 6],
    startDate: today,
  });

  const [inCollege, setInCollege] = useState(false);
  const [working, setWorking] = useState(false);
  const [commitments, setCommitments] = useState<DraftCommitment[]>([]);
  const [hasMock, setHasMock] = useState<'yes' | 'no'>('no');
  const [mock, setMock] = useState({
    date: today,
    provider: DEFAULT_MOCK_PROVIDERS[0],
    name: 'Baseline mock',
    overallScore: '',
    overallPercentile: '',
    sections: {
      VARC: { ...emptySection },
      DILR: { ...emptySection },
      QA: { ...emptySection },
    } as Record<SectionKey, typeof emptySection>,
    weakTopics: '',
  });

  const daysLeft = daysBetween(today, profile.examDate ?? state.profile.examDate);

  const capacity = useMemo(() => {
    const wd = profile.weekdayHours ?? state.profile.weekdayHours;
    const we = profile.weekendHours ?? state.profile.weekendHours;
    const grossNormal = wd.normal * 5 + we.normal * 2;
    const grossMax = wd.max * 5 + we.max * 2;
    const grossMin = wd.min * 5 + we.min * 2;
    const buffer = profile.bufferPct ?? 0.25;
    const committedWeekly = commitments
      .filter((c) => c.recurrence === 'weekly' && c.reducesCapacity)
      .reduce((a, c) => a + c.hoursPerDay * Math.max(1, c.daysOfWeek.length), 0);
    const netNormal = Math.max(0, grossNormal - committedWeekly);
    return {
      grossNormal,
      grossMax,
      grossMin,
      committedWeekly,
      netNormal,
      planned: netNormal * (1 - buffer),
      buffer: netNormal * buffer,
    };
  }, [profile, commitments, state.profile]);

  const setEnergy = (day: number, value: EnergyLevel) =>
    setProfile((p) => ({ ...p, energyByDay: { ...(p.energyByDay ?? {}), [day]: value } }));

  const toggleDay = (key: 'heavyDays' | 'longStudyDays', day: number) =>
    setProfile((p) => {
      const list = p[key] ?? [];
      return { ...p, [key]: list.includes(day) ? list.filter((d) => d !== day) : [...list, day] };
    });

  const addCommitment = (c: DraftCommitment) => setCommitments((list) => [...list, c]);

  const finish = () => {
    let baselineMock: Omit<Mock, 'id' | 'createdAt' | 'updatedAt'> | undefined;
    if (hasMock === 'yes') {
      baselineMock = {
        kind: 'full',
        date: mock.date,
        provider: mock.provider,
        name: mock.name || 'Baseline mock',
        overallScore: num(mock.overallScore),
        overallPercentile: num(mock.overallPercentile),
        sections: {
          VARC: normaliseSection(mock.sections.VARC),
          DILR: normaliseSection(mock.sections.DILR),
          QA: normaliseSection(mock.sections.QA),
        },
        lessons: [],
        analysed: false,
        mainMistakes: mock.weakTopics,
        weakTopicIds: [],
      };
    }
    dispatch({
      type: 'onboarding/complete',
      profile,
      commitments,
      baselineMock,
      today,
    });
  };

  return (
    <div className="main" style={{ paddingBottom: 40 }}>
      <div className="page-header">
        <div>
          <h1>Set up your CAT system</h1>
          <div className="sub">
            {daysLeft} days to {formatLongDate(profile.examDate ?? state.profile.examDate)}
          </div>
        </div>
        <div className="small muted">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </div>
      </div>

      <div className="progress-track" style={{ marginBottom: 16 }}>
        <div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      {mode === 'restore' ? (
        <Card title="Restore from another device">
          <p className="small muted">
            If you already use this on another device, paste the same GitHub token and pick your existing data. If a
            friend shares the app, they need their own GitHub account — not your token.
          </p>
          <SyncSetup />
          <div className="btn-group" style={{ marginTop: 10 }}>
            <button type="button" className="btn subtle" onClick={() => setMode('setup')}>
              Back to setup
            </button>
          </div>
        </Card>
      ) : (
      <>
      {step === 0 && (
        <Card title="Your goal">
          <p className="small muted">
            The target is an outcome, not an hour count. Everything else in this app exists to serve it.
          </p>
          <Field label="Target percentile" htmlFor="target">
            <input
              id="target"
              type="number"
              min={50}
              max={100}
              value={profile.targetPercentile ?? 96}
              onChange={(e) => setProfile({ ...profile, targetPercentile: Number(e.target.value) })}
            />
          </Field>
          <Field label="Exam date" htmlFor="examdate">
            <input
              id="examdate"
              type="date"
              value={profile.examDate}
              onChange={(e) => setProfile({ ...profile, examDate: e.target.value })}
            />
          </Field>
          <Field label="Preparation mode" htmlFor="mode">
            <input
              id="mode"
              type="text"
              value={profile.prepMode}
              onChange={(e) => setProfile({ ...profile, prepMode: e.target.value })}
            />
          </Field>
          <Callout>
            Today is {formatLongDate(today)}. That leaves <strong>{daysLeft} days</strong>, or about{' '}
            {(daysLeft / 7).toFixed(1)} weeks.
          </Callout>
        </Card>
      )}

      {step === 1 && (
        <>
          <Card title="Current commitments">
            <p className="small muted">
              Routine college or work hours give the plan context; travel, exams and one-off events come straight out
              of planning capacity before any study time is allocated.
            </p>
            <div className="choice-row" style={{ marginBottom: 12 }}>
              <button type="button" className="choice" aria-pressed={inCollege} onClick={() => setInCollege(!inCollege)}>
                I am in college
              </button>
              <button type="button" className="choice" aria-pressed={working} onClick={() => setWorking(!working)}>
                I am working
              </button>
            </div>
            <CommitmentForm onAdd={addCommitment} today={today} />
          </Card>

          <Card title={`Added commitments (${commitments.length})`}>
            {commitments.length === 0 ? (
              <div className="empty">
                No commitments added. If your weeks are genuinely clear, that is fine - you can add travel, exams and
                events later and the plan will recalculate.
              </div>
            ) : (
              <ul className="list-reset stack">
                {commitments.map((c, i) => (
                  <li key={i} className="row-between small">
                    <span>
                      <strong>{c.title}</strong> · {COMMITMENT_TYPE_LABELS[c.type]} ·{' '}
                      {c.recurrence === 'weekly'
                        ? `weekly on ${c.daysOfWeek.map((d) => DAY_LABELS[d].slice(0, 3)).join(', ')}`
                        : `${c.startDate} to ${c.endDate}`}{' '}
                      · {c.hoursPerDay}h/day
                      {c.reducesCapacity ? '' : ' · already counted in your study hours'}
                    </span>
                    <button
                      type="button"
                      className="btn small subtle"
                      onClick={() => setCommitments(commitments.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {step === 2 && (
        <Card title="Available time">
          <p className="small muted">
            Hours genuinely available for CAT preparation, after routine college or work. The planner uses the{' '}
            <strong>normal</strong> figure and holds back buffer; the maximum is treated as emergency recovery capacity
            only, never as the default.
          </p>
          <HourBandEditor
            label="Weekdays (Mon-Fri), hours per day"
            value={profile.weekdayHours ?? state.profile.weekdayHours}
            onChange={(weekdayHours) => setProfile({ ...profile, weekdayHours })}
          />
          <HourBandEditor
            label="Weekends (Sat-Sun), hours per day"
            value={profile.weekendHours ?? state.profile.weekendHours}
            onChange={(weekendHours) => setProfile({ ...profile, weekendHours })}
          />
          <ChoiceGroup
            legend="Buffer held back for real life"
            value={String(Math.round((profile.bufferPct ?? 0.25) * 100))}
            options={[
              { value: '20', label: '20%' },
              { value: '25', label: '25% (recommended)' },
              { value: '30', label: '30%' },
            ]}
            onChange={(v) => setProfile({ ...profile, bufferPct: Number(v) / 100 })}
          />
          <Callout tone="ok">
            <div>
              Gross weekly capacity: <strong>{capacity.grossNormal.toFixed(1)}h</strong> (min{' '}
              {capacity.grossMin.toFixed(1)}h, max {capacity.grossMax.toFixed(1)}h)
            </div>
            {capacity.committedWeekly > 0 && (
              <div>Recurring commitments take {capacity.committedWeekly.toFixed(1)}h.</div>
            )}
            <div>
              Planned weekly capacity: <strong>{capacity.planned.toFixed(1)}h</strong> · buffer{' '}
              {capacity.buffer.toFixed(1)}h
            </div>
          </Callout>
        </Card>
      )}

      {step === 3 && (
        <Card title="Energy profile">
          <p className="small muted">
            Rate a typical day. This is a starting point only - the planner replaces it with observed behaviour once you
            have logged real days.
          </p>
          <div className="stack">
            {DAY_LABELS.map((label, day) => (
              <div key={day} className="row-between">
                <span className="small" style={{ minWidth: 92 }}>
                  {label}
                </span>
                <div className="choice-row">
                  {([1, 2, 3, 4, 5] as EnergyLevel[]).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className="choice"
                      aria-pressed={(profile.energyByDay ?? {})[day] === level}
                      aria-label={`${label}: ${ENERGY_LABELS[level]}`}
                      onClick={() => setEnergy(day, level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <ChoiceGroup
              legend="Best study window"
              value={profile.bestWindow ?? 'morning'}
              options={TIME_WINDOWS.map((w) => ({ value: w.key as TimeWindow, label: w.label }))}
              onChange={(bestWindow) => setProfile({ ...profile, bestWindow })}
            />
            <ChoiceGroup
              legend="Worst study window"
              value={profile.worstWindow ?? 'afternoon'}
              options={TIME_WINDOWS.map((w) => ({ value: w.key as TimeWindow, label: w.label }))}
              onChange={(worstWindow) => setProfile({ ...profile, worstWindow })}
            />
            <fieldset className="field">
              <legend>Days usually taken by college or work</legend>
              <div className="choice-row">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    className="choice"
                    aria-pressed={(profile.heavyDays ?? []).includes(day)}
                    onClick={() => toggleDay('heavyDays', day)}
                  >
                    {label.slice(0, 3)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="field">
              <legend>Days available for longer study</legend>
              <div className="choice-row">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    className="choice"
                    aria-pressed={(profile.longStudyDays ?? []).includes(day)}
                    onClick={() => toggleDay('longStudyDays', day)}
                  >
                    {label.slice(0, 3)}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Baseline assessment">
          <p className="small muted">
            The system will not assume a skill level. If you have mock data, enter it now; if not, the first week
            becomes a measurement week and feasibility stays <strong>unconfirmed</strong> until a baseline exists.
          </p>
          <ChoiceGroup
            legend="Have you already taken a full CAT mock?"
            value={hasMock}
            options={[
              { value: 'no' as const, label: 'Not yet' },
              { value: 'yes' as const, label: 'Yes, I have data' },
            ]}
            onChange={setHasMock}
          />

          {hasMock === 'yes' ? (
            <>
              <div className="inline-fields-2">
                <Field label="Mock date" htmlFor="mockdate">
                  <input
                    id="mockdate"
                    type="date"
                    value={mock.date}
                    onChange={(e) => setMock({ ...mock, date: e.target.value })}
                  />
                </Field>
                <Field label="Provider" htmlFor="provider">
                  <select id="provider" value={mock.provider} onChange={(e) => setMock({ ...mock, provider: e.target.value })}>
                    {DEFAULT_MOCK_PROVIDERS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="inline-fields-2">
                <Field label="Overall score" htmlFor="oscore">
                  <input
                    id="oscore"
                    type="number"
                    value={mock.overallScore}
                    onChange={(e) => setMock({ ...mock, overallScore: e.target.value })}
                  />
                </Field>
                <Field label="Overall percentile" htmlFor="opct">
                  <input
                    id="opct"
                    type="number"
                    value={mock.overallPercentile}
                    onChange={(e) => setMock({ ...mock, overallPercentile: e.target.value })}
                  />
                </Field>
              </div>

              {(['VARC', 'DILR', 'QA'] as SectionKey[]).map((section) => (
                <fieldset key={section} className="field">
                  <legend>{section}</legend>
                  <div className="inline-fields">
                    <input
                      type="number"
                      aria-label={`${section} score`}
                      placeholder="Score"
                      value={mock.sections[section].score || ''}
                      onChange={(e) =>
                        setMock({
                          ...mock,
                          sections: { ...mock.sections, [section]: { ...mock.sections[section], score: Number(e.target.value) } },
                        })
                      }
                    />
                    <input
                      type="number"
                      aria-label={`${section} percentile`}
                      placeholder="Percentile"
                      value={mock.sections[section].percentile || ''}
                      onChange={(e) =>
                        setMock({
                          ...mock,
                          sections: {
                            ...mock.sections,
                            [section]: { ...mock.sections[section], percentile: Number(e.target.value) },
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      aria-label={`${section} attempts`}
                      placeholder="Attempts"
                      value={mock.sections[section].attempts || ''}
                      onChange={(e) =>
                        setMock({
                          ...mock,
                          sections: {
                            ...mock.sections,
                            [section]: { ...mock.sections[section], attempts: Number(e.target.value) },
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      aria-label={`${section} correct`}
                      placeholder="Correct"
                      value={mock.sections[section].correct || ''}
                      onChange={(e) =>
                        setMock({
                          ...mock,
                          sections: {
                            ...mock.sections,
                            [section]: { ...mock.sections[section], correct: Number(e.target.value) },
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      aria-label={`${section} incorrect`}
                      placeholder="Incorrect"
                      value={mock.sections[section].incorrect || ''}
                      onChange={(e) =>
                        setMock({
                          ...mock,
                          sections: {
                            ...mock.sections,
                            [section]: { ...mock.sections[section], incorrect: Number(e.target.value) },
                          },
                        })
                      }
                    />
                  </div>
                </fieldset>
              ))}
              <Field label="Known weak topics (free text)" htmlFor="weak">
                <textarea id="weak" value={mock.weakTopics} onChange={(e) => setMock({ ...mock, weakTopics: e.target.value })} />
              </Field>
            </>
          ) : (
            <Callout tone="warn">
              No baseline yet. Your first week will prioritise taking one full mock under exam conditions. Until that
              exists, the app will report <strong>Target feasibility: UNCONFIRMED</strong> rather than pretending{' '}
              {profile.targetPercentile ?? 96} percentile is definitely achievable.
            </Callout>
          )}
        </Card>
      )}

      {step === 5 && (
        <Card title="Ready to build your first week">
          <div className="stack">
            <div className="row-between">
              <span className="muted small">Target</span>
              <strong>{profile.targetPercentile} percentile+</strong>
            </div>
            <div className="row-between">
              <span className="muted small">Exam</span>
              <strong>
                {formatLongDate(profile.examDate ?? state.profile.examDate)} · {daysLeft} days
              </strong>
            </div>
            <div className="row-between">
              <span className="muted small">Planned weekly capacity</span>
              <strong>{capacity.planned.toFixed(1)}h</strong>
            </div>
            <div className="row-between">
              <span className="muted small">Buffer</span>
              <strong>{capacity.buffer.toFixed(1)}h</strong>
            </div>
            <div className="row-between">
              <span className="muted small">Commitments recorded</span>
              <strong>{commitments.length}</strong>
            </div>
            <div className="row-between">
              <span className="muted small">Baseline mock</span>
              <strong>{hasMock === 'yes' ? `${mock.overallPercentile || '?'} percentile` : 'Not yet taken'}</strong>
            </div>
          </div>
          <Callout tone="ok">
            The first week is generated at roughly 75% of your realistic capacity, with 3-5 outcomes rather than a full
            timetable. You will not be shown the entire {daysLeft}-day schedule, because it would be fiction.
          </Callout>
        </Card>
      )}

      {step === 0 && (
        <Card title="Already using this on another device?">
          <p className="small muted">
            Don't set up twice - pull your existing data across instead. Setting up separately on two devices creates
            two of everything.
          </p>
          <button type="button" className="btn" onClick={() => setMode('restore')}>
            Restore from another device
          </button>
        </Card>
      )}
      </>
      )}

      {mode === 'setup' && (
      <div className="btn-group" style={{ marginTop: 8 }}>
        {step > 0 && (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={finish}>
            Build my first week
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function HourBandEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { min: number; normal: number; max: number };
  onChange: (v: { min: number; normal: number; max: number }) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="inline-fields">
        <label className="tiny muted">
          Minimum realistic
          <input
            type="number"
            min={0}
            max={16}
            step={0.5}
            value={value.min}
            onChange={(e) => onChange({ ...value, min: Number(e.target.value) })}
          />
        </label>
        <label className="tiny muted">
          Normal
          <input
            type="number"
            min={0}
            max={16}
            step={0.5}
            value={value.normal}
            onChange={(e) => onChange({ ...value, normal: Number(e.target.value) })}
          />
        </label>
        <label className="tiny muted">
          Maximum
          <input
            type="number"
            min={0}
            max={18}
            step={0.5}
            value={value.max}
            onChange={(e) => onChange({ ...value, max: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="hint">
        Weekly at normal: {formatHours(value.normal * 60 * (label.startsWith('Weekday') ? 5 : 2), 1)}
      </div>
    </fieldset>
  );
}

function CommitmentForm({ onAdd, today }: { onAdd: (c: DraftCommitment) => void; today: string }) {
  const [draft, setDraft] = useState<DraftCommitment>({
    title: '',
    type: 'college',
    startDate: today,
    endDate: addDays(today, 84),
    recurrence: 'weekly',
    daysOfWeek: [1, 2, 3, 4, 5],
    hoursPerDay: 6,
    reducesCapacity: false,
    flexible: false,
  });

  return (
    <div>
      <Field label="Commitment title" htmlFor="ctitle">
        <input
          id="ctitle"
          type="text"
          placeholder="e.g. College lectures, Family wedding, Office"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </Field>
      <div className="inline-fields-2">
        <Field label="Type" htmlFor="ctype">
          <select
            id="ctype"
            value={draft.type}
            onChange={(e) => {
              const type = e.target.value as CommitmentType;
              setDraft({ ...draft, type, reducesCapacity: !isRoutine(type, draft.recurrence) });
            }}
          >
            {Object.entries(COMMITMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pattern" htmlFor="crec">
          <select
            id="crec"
            value={draft.recurrence}
            onChange={(e) => {
              const recurrence = e.target.value as 'once' | 'weekly';
              setDraft({ ...draft, recurrence, reducesCapacity: !isRoutine(draft.type, recurrence) });
            }}
          >
            <option value="weekly">Recurring weekly</option>
            <option value="once">One-time / date range</option>
          </select>
        </Field>
      </div>
      {draft.recurrence === 'weekly' && (
        <fieldset className="field">
          <legend>Days</legend>
          <div className="choice-row">
            {DAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                className="choice"
                aria-pressed={draft.daysOfWeek.includes(day)}
                onClick={() =>
                  setDraft({
                    ...draft,
                    daysOfWeek: draft.daysOfWeek.includes(day)
                      ? draft.daysOfWeek.filter((d) => d !== day)
                      : [...draft.daysOfWeek, day],
                  })
                }
              >
                {label.slice(0, 3)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="inline-fields">
        <Field label="From" htmlFor="cfrom">
          <input id="cfrom" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="cto">
          <input id="cto" type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
        </Field>
        <Field label="Hours per day" htmlFor="chours">
          <input
            id="chours"
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={draft.hoursPerDay}
            onChange={(e) => setDraft({ ...draft, hoursPerDay: Number(e.target.value) })}
          />
        </Field>
      </div>
      <label className="row small" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={!draft.reducesCapacity}
          onChange={(e) => setDraft({ ...draft, reducesCapacity: !e.target.checked })}
        />
        Already accounted for in the study hours I will state next
      </label>
      <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        Leave this ticked for routine college or work hours - your "3 hours on a weekday" figure is already what is
        left after them. Untick it for travel, exams and one-off events, which genuinely take time you were counting
        on.
      </p>
      <button
        type="button"
        className="btn"
        disabled={!draft.title.trim()}
        onClick={() => {
          onAdd(draft);
          setDraft({ ...draft, title: '' });
        }}
      >
        Add commitment
      </button>
    </div>
  );
}

/** Routine recurring college/work hours are already netted out of stated availability. */
function isRoutine(type: CommitmentType, recurrence: 'once' | 'weekly'): boolean {
  return recurrence === 'weekly' && (type === 'college' || type === 'work');
}

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

function normaliseSection(s: { score: number; percentile: number; attempts: number; correct: number; incorrect: number }) {
  return { ...s };
}
