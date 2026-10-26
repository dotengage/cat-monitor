import { useState } from 'react';
import { SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { Mock, SectionKey, SectionScore } from '../domain/types';
import { sortedMocks } from '../engine/derive';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import type { ScoreTable } from '../import/scoreTable';
import { Callout, Card, Empty, Field, Modal, Stat, StatGrid, Tag } from '../ui/components';
import { ScreenshotImport } from '../ui/components/ScreenshotImport';
import { buildMockReport, reportFilename } from '../export/reports';

const emptyScore: SectionScore = { score: 0, percentile: 0, attempts: 0, correct: 0, incorrect: 0 };

export function Mocks() {
  const { state, dispatch, today } = useStore();
  const { cadence, forecast } = useEngine();
  const [adding, setAdding] = useState<'full' | 'sectional' | null>(null);
  const [editingMock, setEditingMock] = useState<Mock | null>(null);
  const [analysing, setAnalysing] = useState<Mock | null>(null);

  const mocks = sortedMocks(state).reverse();
  const full = mocks.filter((m) => m.kind === 'full');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Mock Centre</h1>
          <div className="sub">A mock is only complete once it has been analysed.</div>
        </div>
        <div className="btn-group">
          <button
            type="button"
            className="btn small"
            onClick={() => buildMockReport(state, today).save(reportFilename('mock', today))}
            disabled={state.mocks.length === 0}
            title={state.mocks.length === 0 ? 'Record a mock first' : 'Download the full mock report as a PDF'}
          >
            Export PDF
          </button>
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
          <Stat
            label="Average (last 5)"
            value={forecast.recentAveragePercentile ?? '—'}
            sub={forecast.recentAverageCount > 0 ? `of ${forecast.recentAverageCount} recorded percentiles` : 'no percentiles yet'}
          />
          <Stat label="Best percentile" value={forecast.bestPercentile ?? '—'} />
          <Stat label="Latest percentile" value={forecast.latestPercentile ?? '—'} />
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
                      <td className="num mono">{mock.overallPercentile ? mock.overallPercentile : '—'}</td>
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
                        {/* A blank field is saved as 0; show it as missing, never as a score. */}
                        <td className="num mono">{sec.percentile > 0 ? sec.percentile : '—'}</td>
                        <td className="num mono">{sec.attempts > 0 ? sec.attempts : '—'}</td>
                        <td className="num mono">{sec.attempts > 0 ? sec.correct : '—'}</td>
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
              <button type="button" className="btn small" onClick={() => setEditingMock(mock)}>
                Edit scores
              </button>
              <button type="button" className="btn small danger" onClick={() => dispatch({ type: 'mock/delete', id: mock.id })}>
                Delete
              </button>
            </div>
          </Card>
        ))
      )}

      {adding && <MockModal kind={adding} today={today} onClose={() => setAdding(null)} />}
      {editingMock && (
        <MockModal
          kind={editingMock.kind}
          today={today}
          mock={editingMock}
          onClose={() => setEditingMock(null)}
        />
      )}
      {analysing && <AnalysisModal mock={analysing} onClose={() => setAnalysing(null)} />}
    </>
  );
}

function MockModal({
  kind,
  today,
  mock,
  onClose,
}: {
  kind: 'full' | 'sectional';
  today: string;
  /** Present when correcting a mock that was already recorded. */
  mock?: Mock;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const editing = Boolean(mock);
  const [date, setDate] = useState(mock?.date ?? today);
  const [provider, setProvider] = useState(mock?.provider ?? state.settings.mockProviders[0]);
  const [name, setName] = useState(
    mock?.name ?? (kind === 'full' ? `Mock ${state.mocks.filter((m) => m.kind === 'full').length + 1}` : 'Sectional'),
  );
  const [section, setSection] = useState<SectionKey>(mock?.section ?? 'QA');
  const [overallScore, setOverallScore] = useState(mock?.overallScore?.toString() ?? '');
  const [overallPercentile, setOverallPercentile] = useState(mock?.overallPercentile?.toString() ?? '');
  const [sections, setSections] = useState<Record<SectionKey, SectionScore>>({
    VARC: { ...emptyScore, ...(mock?.sections.VARC ?? {}) },
    DILR: { ...emptyScore, ...(mock?.sections.DILR ?? {}) },
    QA: { ...emptyScore, ...(mock?.sections.QA ?? {}) },
  });
  const [setsAttempted, setSetsAttempted] = useState(mock?.dilrSetsAttempted?.toString() ?? '');
  const [setsSolved, setSetsSolved] = useState(mock?.dilrSetsSolved?.toString() ?? '');

  const relevantSections = kind === 'full' ? SECTIONS : [section];

  /**
   * Applies a table read from a screenshot, and reports how many fields it
   * actually filled.
   *
   * Only fields the table has a number for are touched. A column the portal
   * did not show, or a cell the recogniser could not read, leaves whatever was
   * already there rather than zeroing it - a blank field you still have to
   * type is a smaller problem than a confident wrong number you do not notice.
   */
  const applyScreenshot = (table: ScoreTable): number => {
    let filled = 0;

    setSections((current) => {
      const next = { ...current };
      for (const key of relevantSections) {
        const reading = table.sections[key];
        if (!reading) continue;
        const merged = { ...next[key] };
        (['score', 'percentile', 'attempts', 'correct', 'incorrect'] as (keyof SectionScore)[]).forEach((field) => {
          const value = reading[field];
          if (typeof value === 'number') {
            merged[field] = value;
            filled += 1;
          }
        });
        next[key] = merged;
      }
      return next;
    });

    if (kind === 'full') {
      if (typeof table.overall.score === 'number') {
        setOverallScore(String(table.overall.score));
        filled += 1;
      }
      if (typeof table.overall.percentile === 'number') {
        setOverallPercentile(String(table.overall.percentile));
        filled += 1;
      }
    }
    return filled;
  };

  const save = () => {
    const scores = {
      date,
      provider,
      name,
      section: kind === 'sectional' ? section : undefined,
      overallScore: numOrUndef(overallScore),
      overallPercentile: numOrUndef(overallPercentile),
      sections: Object.fromEntries(relevantSections.map((s) => [s, sections[s]])) as Mock['sections'],
      dilrSetsAttempted: numOrUndef(setsAttempted),
      dilrSetsSolved: numOrUndef(setsSolved),
    };

    if (mock) {
      // A correction to the numbers only: the analysis and its lessons stay.
      dispatch({ type: 'mock/update', id: mock.id, patch: scores });
    } else {
      dispatch({ type: 'mock/add', mock: { ...scores, kind, lessons: [], analysed: false, weakTopicIds: [] } });
    }
    onClose();
  };

  return (
    <Modal
      title={editing ? `Edit ${mock?.name || 'mock'}` : kind === 'full' ? 'Record a full mock' : 'Record a sectional'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            {editing ? 'Save changes' : 'Save'}
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

      <ScreenshotImport onRead={applyScreenshot} />

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
        {editing
          ? 'Correcting the numbers leaves the analysis, lessons and weak topics you recorded untouched.'
          : 'Recording the result is step 2 of 7. The mock is not finished until it is analysed and its errors are logged.'}
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
