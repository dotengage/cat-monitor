import { useState } from 'react';
import { SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { Mock, SectionKey, SectionScore } from '../domain/types';
import { sortedMocks } from '../engine/derive';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { Callout, Card, Empty, Field, Modal, Stat, StatGrid, Tag } from '../ui/components';

const emptyScore: SectionScore = { score: 0, percentile: 0, attempts: 0, correct: 0, incorrect: 0 };

export function Mocks() {
  const { state, dispatch, today } = useStore();
  const { cadence } = useEngine();
  const [adding, setAdding] = useState<'full' | 'sectional' | null>(null);
  const [analysing, setAnalysing] = useState<Mock | null>(null);

  const mocks = sortedMocks(state).reverse();
  const full = mocks.filter((m) => m.kind === 'full');
  const percentiles = full.map((m) => m.overallPercentile).filter((p): p is number => typeof p === 'number');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Mock Centre</h1>
          <div className="sub">A mock is only complete once it has been analysed.</div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn small" onClick={() => setAdding('sectional')}>
            + Sectional
          </button>
          <button type="button" className="btn small primary" onClick={() => setAdding('full')}>
            + Full mock
          </button>
        </div>
      </div>

      <Card title="Overview">
        <StatGrid>
          <Stat label="Mocks completed" value={full.length} />
          <Stat label="Analysed" value={full.filter((m) => m.analysed).length} sub={`${state.mocks.filter((m) => !m.analysed).length} pending`} />
          <Stat label="Average percentile" value={percentiles.length ? avg(percentiles).toFixed(1) : '—'} />
          <Stat label="Best percentile" value={percentiles.length ? Math.max(...percentiles) : '—'} />
          <Stat label="Latest" value={percentiles.length ? percentiles[percentiles.length - 1] : '—'} />
          <Stat label="Sectionals" value={mocks.filter((m) => m.kind === 'sectional').length} />
        </StatGrid>
        <Callout tone={cadence.analysisBacklog > 0 ? 'warn' : 'neutral'} >
          {cadence.reason}
        </Callout>
      </Card>

      {mocks.length === 0 ? (
        <Empty>
          No mocks recorded. Until a baseline exists the app will not pretend to know whether{' '}
          {state.profile.targetPercentile} percentile is achievable.
        </Empty>
      ) : (
        mocks.map((mock) => (
          <Card
            key={mock.id}
            title={
              <div className="card-title-row">
                <h2>
                  {mock.name || mock.provider} {mock.kind === 'sectional' && mock.section ? `· ${SECTION_LABELS[mock.section]}` : ''}
                </h2>
                {mock.analysed ? <Tag tone="ok">Analysed</Tag> : <Tag tone="risk">Incomplete analysis</Tag>}
              </div>
            }
            subtitle={`${mock.provider} · ${formatDate(mock.date, { withYear: true })}`}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="num">Score</th>
                    <th className="num">%ile</th>
                    <th className="num">Att.</th>
                    <th className="num">Correct</th>
                    <th className="num">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {mock.kind === 'full' && (
                    <tr>
                      <td>
                        <strong>Overall</strong>
                      </td>
                      <td className="num mono">{mock.overallScore ?? '—'}</td>
                      <td className="num mono">{mock.overallPercentile ?? '—'}</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                      <td className="num mono">—</td>
                    </tr>
                  )}
                  {SECTIONS.filter((s) => mock.sections[s]).map((s) => {
                    const sec = mock.sections[s] as SectionScore;
                    const acc = sec.attempts > 0 ? Math.round((sec.correct / sec.attempts) * 100) : null;
                    return (
                      <tr key={s}>
                        <td>{SECTION_LABELS[s]}</td>
                        <td className="num mono">{sec.score}</td>
                        <td className="num mono">{sec.percentile}</td>
                        <td className="num mono">{sec.attempts}</td>
                        <td className="num mono">{sec.correct}</td>
                        <td className="num mono">{acc === null ? '—' : `${acc}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(mock.dilrSetsAttempted ?? 0) > 0 && (
              <p className="small muted" style={{ marginTop: 8 }}>
                DILR sets: {mock.dilrSetsSolved ?? 0} solved of {mock.dilrSetsAttempted} attempted.
              </p>
            )}

            {mock.analysed ? (
              <>
                {mock.timeNotes && (
                  <p className="small">
                    <strong>Time management:</strong> {mock.timeNotes}
                  </p>
                )}
                {mock.selectionNotes && (
                  <p className="small">
                    <strong>Question selection:</strong> {mock.selectionNotes}
                  </p>
                )}
                {mock.mainMistakes && (
                  <p className="small">
                    <strong>Main mistakes:</strong> {mock.mainMistakes}
                  </p>
                )}
                {mock.lessons.filter(Boolean).length > 0 && (
                  <>
                    <div className="section-label">Top lessons</div>
                    <ol className="bullets small">
                      {mock.lessons.filter(Boolean).map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ol>
                  </>
                )}
              </>
            ) : (
              <Callout tone="warn">
                This mock has not been analysed. Until it is, it counts as incomplete: the planner throttles further
                mocks and the percentile it produced carries less weight.
              </Callout>
            )}

            <div className="btn-group" style={{ marginTop: 10 }}>
              <button type="button" className="btn small primary" onClick={() => setAnalysing(mock)}>
                {mock.analysed ? 'Edit analysis' : 'Analyse this mock'}
              </button>
              <button type="button" className="btn small danger" onClick={() => dispatch({ type: 'mock/delete', id: mock.id })}>
                Delete
              </button>
            </div>
          </Card>
        ))
      )}

      {adding && <MockModal kind={adding} today={today} onClose={() => setAdding(null)} />}
      {analysing && <AnalysisModal mock={analysing} onClose={() => setAnalysing(null)} />}
    </>
  );
}

function avg(values: number[]): number {
  return values.reduce((a, v) => a + v, 0) / values.length;
}

function MockModal({ kind, today, onClose }: { kind: 'full' | 'sectional'; today: string; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [date, setDate] = useState(today);
  const [provider, setProvider] = useState(state.settings.mockProviders[0]);
  const [name, setName] = useState(kind === 'full' ? `Mock ${state.mocks.filter((m) => m.kind === 'full').length + 1}` : 'Sectional');
  const [section, setSection] = useState<SectionKey>('QA');
  const [overallScore, setOverallScore] = useState('');
  const [overallPercentile, setOverallPercentile] = useState('');
  const [sections, setSections] = useState<Record<SectionKey, SectionScore>>({
    VARC: { ...emptyScore },
    DILR: { ...emptyScore },
    QA: { ...emptyScore },
  });
  const [setsAttempted, setSetsAttempted] = useState('');
  const [setsSolved, setSetsSolved] = useState('');

  const relevantSections = kind === 'full' ? SECTIONS : [section];

  const save = () => {
    dispatch({
      type: 'mock/add',
      mock: {
        kind,
        date,
        provider,
        name,
        section: kind === 'sectional' ? section : undefined,
        overallScore: numOrUndef(overallScore),
        overallPercentile: numOrUndef(overallPercentile),
        sections: Object.fromEntries(relevantSections.map((s) => [s, sections[s]])) as Mock['sections'],
        dilrSetsAttempted: numOrUndef(setsAttempted),
        dilrSetsSolved: numOrUndef(setsSolved),
        lessons: [],
        analysed: false,
        weakTopicIds: [],
      },
    });
    onClose();
  };

  return (
    <Modal
      title={kind === 'full' ? 'Record a full mock' : 'Record a sectional'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="inline-fields-2">
        <Field label="Date" htmlFor="mdate">
          <input id="mdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Provider" htmlFor="mprov">
          <select id="mprov" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {state.settings.mockProviders.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Name / number" htmlFor="mname">
        <input id="mname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      {kind === 'sectional' ? (
        <Field label="Section" htmlFor="msec">
          <select id="msec" value={section} onChange={(e) => setSection(e.target.value as SectionKey)}>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="inline-fields-2">
          <Field label="Overall score" htmlFor="mos">
            <input id="mos" type="number" value={overallScore} onChange={(e) => setOverallScore(e.target.value)} />
          </Field>
          <Field label="Overall percentile" htmlFor="mop">
            <input id="mop" type="number" value={overallPercentile} onChange={(e) => setOverallPercentile(e.target.value)} />
          </Field>
        </div>
      )}

      {relevantSections.map((s) => (
        <fieldset key={s} className="field">
          <legend>{SECTION_LABELS[s]}</legend>
          <div className="inline-fields">
            {(['score', 'percentile', 'attempts', 'correct', 'incorrect'] as (keyof SectionScore)[]).map((key) => (
              <label key={key} className="tiny muted">
                {key}
                <input
                  type="number"
                  value={sections[s][key] || ''}
                  onChange={(e) => setSections({ ...sections, [s]: { ...sections[s], [key]: Number(e.target.value) } })}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {(kind === 'full' || section === 'DILR') && (
        <div className="inline-fields-2">
          <Field label="DILR sets attempted" htmlFor="msa">
            <input id="msa" type="number" value={setsAttempted} onChange={(e) => setSetsAttempted(e.target.value)} />
          </Field>
          <Field label="DILR sets solved" htmlFor="mss">
            <input id="mss" type="number" value={setsSolved} onChange={(e) => setSetsSolved(e.target.value)} />
          </Field>
        </div>
      )}
      <p className="tiny faint">
        Recording the result is step 2 of 7. The mock is not finished until it is analysed and its errors are logged.
      </p>
    </Modal>
  );
}

function AnalysisModal({ mock, onClose }: { mock: Mock; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [timeNotes, setTimeNotes] = useState(mock.timeNotes ?? '');
  const [selectionNotes, setSelectionNotes] = useState(mock.selectionNotes ?? '');
  const [mainMistakes, setMainMistakes] = useState(mock.mainMistakes ?? '');
  const [lessons, setLessons] = useState<string[]>([mock.lessons[0] ?? '', mock.lessons[1] ?? '', mock.lessons[2] ?? '']);
  const [weakTopicIds, setWeakTopicIds] = useState<string[]>(mock.weakTopicIds ?? []);

  const errorsLogged = state.errors.filter((e) => e.mockId === mock.id).length;
  const canComplete = lessons.filter((l) => l.trim()).length >= 1 && weakTopicIds.length > 0;

  return (
    <Modal
      title={`Analyse ${mock.name || mock.provider}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            disabled={!canComplete}
            onClick={() => {
              dispatch({
                type: 'mock/update',
                id: mock.id,
                patch: {
                  timeNotes,
                  selectionNotes,
                  mainMistakes,
                  lessons: lessons.filter((l) => l.trim()),
                  weakTopicIds,
                  analysed: true,
                  analysedAt: new Date().toISOString(),
                },
              });
              onClose();
            }}
          >
            Mark analysis complete
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              dispatch({
                type: 'mock/update',
                id: mock.id,
                patch: { timeNotes, selectionNotes, mainMistakes, lessons, weakTopicIds },
              });
              onClose();
            }}
          >
            Save progress
          </button>
        </>
      }
    >
      <Callout tone={errorsLogged > 0 ? 'ok' : 'warn'}>
        {errorsLogged > 0
          ? `${errorsLogged} error(s) from this mock are already in the error log.`
          : 'No errors from this mock have been logged yet. Classify every incorrect and skipped question in the Errors page.'}
      </Callout>
      <Field label="Time-management notes" htmlFor="atime">
        <textarea id="atime" value={timeNotes} onChange={(e) => setTimeNotes(e.target.value)} placeholder="Where did time actually go? Which questions ate more than they were worth?" />
      </Field>
      <Field label="Question-selection notes" htmlFor="asel">
        <textarea
          id="asel"
          value={selectionNotes}
          onChange={(e) => setSelectionNotes(e.target.value)}
          placeholder="Which questions/sets should not have been attempted? Which solvable ones were skipped?"
        />
      </Field>
      <Field label="Main mistakes" htmlFor="amist">
        <textarea id="amist" value={mainMistakes} onChange={(e) => setMainMistakes(e.target.value)} />
      </Field>
      <fieldset className="field">
        <legend>Weak topics identified (required)</legend>
        <div className="choice-row">
          {state.topics.map((t) => (
            <button
              key={t.id}
              type="button"
              className="choice"
              aria-pressed={weakTopicIds.includes(t.id)}
              onClick={() =>
                setWeakTopicIds(weakTopicIds.includes(t.id) ? weakTopicIds.filter((x) => x !== t.id) : [...weakTopicIds, t.id])
              }
            >
              {t.name}
            </button>
          ))}
        </div>
      </fieldset>
      {[0, 1, 2].map((i) => (
        <Field key={i} label={`Lesson ${i + 1}`} htmlFor={`alesson${i}`}>
          <input
            id={`alesson${i}`}
            type="text"
            value={lessons[i]}
            onChange={(e) => setLessons(lessons.map((l, j) => (i === j ? e.target.value : l)))}
          />
        </Field>
      ))}
      <p className="tiny faint">
        At least one lesson and one weak topic are required before a mock can be marked analysed. That is the whole
        point of the analysis step.
      </p>
    </Modal>
  );
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}
