import { useState } from 'react';
import {
  SECTIONS,
  SECTION_FULL_NAMES,
  SECTION_LABELS,
  SET_MISS_REASON_LABELS,
  VARC_TYPE_LABELS,
} from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { PracticeSession, SectionKey, SetMissReason, Topic } from '../domain/types';
import { sectionPercentileHistory, sectionStats, topicStats } from '../engine/derive';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { ChartLegend, HBarList, TrendChart } from '../ui/charts';
import { Callout, Card, Collapse, Empty, Field, Modal, Stat, StatGrid, StatusPill, Tag } from '../ui/components';

export function CAT() {
  const { state, today } = useStore();
  const { readiness, trajectory, cadence } = useEngine();
  const [logging, setLogging] = useState<SectionKey | null>(null);

  const history = trajectory.history;
  const labels = history.map((h) => formatDate(h.date));
  const stats = sectionStats(state);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CAT readiness</h1>
          <div className="sub">
            Overall readiness {readiness.overall}/100 · {readiness.mocksCompleted} mocks ({readiness.mocksAnalysed}{' '}
            analysed)
          </div>
        </div>
        <StatusPill status={readiness.status} />
      </div>

      <Card title="Trajectory">
        <StatGrid>
          <Stat label="Current" value={trajectory.current ?? '—'} sub="latest mock percentile" />
          <Stat label="Target" value={trajectory.target} sub="official goal" />
          <Stat
            label="Projected"
            value={trajectory.projected ?? '—'}
            sub={trajectory.slopePerWeek !== undefined ? `${trajectory.slopePerWeek >= 0 ? '+' : ''}${trajectory.slopePerWeek}/week` : 'needs 2+ mocks'}
          />
          <Stat label="Days left" value={trajectory.daysRemaining} sub={`trend: ${trajectory.trend.toLowerCase()}`} />
        </StatGrid>
        <Callout tone={trajectory.status === 'BEHIND' ? 'risk' : trajectory.status === 'AT_RISK' ? 'warn' : trajectory.status === 'ON_TRACK' ? 'ok' : 'neutral'}>
          <div className="small">{trajectory.reason}</div>
          <div className="small" style={{ marginTop: 6 }}>
            <strong>Recommended:</strong> {trajectory.recommendedAction}
          </div>
        </Callout>
        <p className="tiny faint" style={{ marginTop: 8 }}>
          Evidence confidence: {trajectory.confidence}. For safety, aim for mock performance above the minimum target -
          exam-day performance is variable. The official goal stays {trajectory.target}.
        </p>
      </Card>

      {history.length >= 1 && (
        <Card title="Mock percentile over time" subtitle="Overall and by section">
          <TrendChart
            labels={labels}
            target={state.profile.targetPercentile}
            series={[
              { name: 'Overall', values: history.map((h) => h.percentile), tone: 'accent' },
              ...SECTIONS.map((s) => ({
                name: s,
                values: alignSeries(history.map((h) => h.date), sectionPercentileHistory(state, s)),
                tone: (s === 'VARC' ? 'ok' : s === 'DILR' ? 'warn' : 'risk') as 'ok' | 'warn' | 'risk',
                dashed: true,
              })),
            ]}
            ariaLabel="Mock percentile over time, overall and by section"
          />
          <ChartLegend
            items={[
              { label: 'Overall', tone: 'accent' },
              { label: 'VARC', tone: 'ok' },
              { label: 'DILR', tone: 'warn' },
              { label: 'QA', tone: 'risk' },
            ]}
          />
        </Card>
      )}

      <Card title="Mock cadence">
        <p className="small">{cadence.reason}</p>
        <div className="row small muted" style={{ marginTop: 6 }}>
          <span>
            Recommended: <strong>{cadence.perWeek}</strong> full mock(s)/week
          </span>
          <span>
            Sectionals: <strong>{cadence.sectionalsPerWeek}</strong>/week
          </span>
          <span>
            Next mock: <strong>{formatDate(cadence.nextRecommendedDate, { withYear: true })}</strong>
          </span>
        </div>
        {cadence.analysisBacklog > 0 && (
          <Callout tone="warn">
            {cadence.analysisBacklog} mock(s) unanalysed. Cadence is throttled until the backlog clears.
          </Callout>
        )}
      </Card>

      {readiness.sections.map((s) => {
        const stat = stats[s.section];
        return (
          <Card
            key={s.section}
            title={
              <div className="card-title-row">
                <h2>{SECTION_LABELS[s.section]}</h2>
                <span className="tiny muted">{SECTION_FULL_NAMES[s.section]}</span>
              </div>
            }
            action={<StatusPill status={s.status} />}
          >
            <StatGrid>
              <Stat label="Readiness" value={`${s.readiness}/100`} sub={`trend ${s.trend.toLowerCase()}`} />
              <Stat
                label="Latest percentile"
                value={s.latestPercentile ?? '—'}
                sub={s.latestPercentile ? `target ${state.profile.targetPercentile}` : 'no sectional data'}
              />
              <Stat
                label="Practice accuracy"
                value={s.accuracy === undefined ? '—' : `${Math.round(s.accuracy * 100)}%`}
                sub={`${stat.attempted} questions logged`}
              />
              <Stat label="Topic coverage" value={`${Math.round(s.coverage * 100)}%`} sub="weighted by exam value" />
              {s.section === 'DILR' && (
                <Stat
                  label="Sets solved"
                  value={`${stat.setsSolved}/${stat.setsAttempted}`}
                  sub={stat.avgSetMin ? `${Math.round(stat.avgSetMin)} min per set` : 'no set data'}
                />
              )}
              <Stat label="Error recurrence" value={`${Math.round(s.errorRecurrence * 100)}%`} sub="repeat error types" />
            </StatGrid>

            <p className="small muted" style={{ marginTop: 10 }}>
              {s.reason}
            </p>

            {s.weakTopics.length > 0 && (
              <>
                <div className="section-label">Weak areas</div>
                <HBarList
                  items={s.weakTopics.map((t) => ({
                    label: t.name,
                    value: Math.round(t.accuracy * 100),
                    tone: t.accuracy < 0.5 ? 'risk' : 'warn',
                  }))}
                  max={100}
                  suffix="%"
                />
              </>
            )}

            <Callout tone="neutral">
              <strong>Next action:</strong> {s.nextAction}
            </Callout>

            <button type="button" className="btn small" style={{ marginTop: 10 }} onClick={() => setLogging(s.section)}>
              Log a {SECTION_LABELS[s.section]} practice session
            </button>
          </Card>
        );
      })}

      <TopicManager />

      {logging && <PracticeModal section={logging} onClose={() => setLogging(null)} today={today} />}
    </>
  );
}

function alignSeries(dates: string[], points: { date: string; percentile: number }[]): (number | null)[] {
  return dates.map((d) => points.find((p) => p.date === d)?.percentile ?? null);
}

function TopicManager() {
  const { state, dispatch } = useStore();
  const stats = topicStats(state);

  return (
    <Card title="Topics" subtitle="Coverage drives the remaining-workload model. Skip what is not worth your time.">
      {SECTIONS.map((section) => (
        <Collapse
          key={section}
          title={`${SECTION_LABELS[section]} · ${state.topics.filter((t) => t.section === section && (t.status === 'practised' || t.status === 'strong')).length}/${
            state.topics.filter((t) => t.section === section).length
          } covered`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className="num">Acc.</th>
                  <th className="num">Qs</th>
                  <th className="num">Wt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.topics
                  .filter((t) => t.section === section)
                  .map((topic) => {
                    const stat = stats.find((s) => s.topicId === topic.id);
                    return (
                      <tr key={topic.id}>
                        <td>
                          {topic.name}
                          <div className="tiny faint">{topic.area}</div>
                        </td>
                        <td className="num mono">
                          {stat?.accuracy === null || stat === undefined ? '—' : `${Math.round(stat.accuracy * 100)}%`}
                        </td>
                        <td className="num mono">{stat?.attempted ?? 0}</td>
                        <td className="num mono">{topic.weight}</td>
                        <td>
                          <select
                            aria-label={`Status for ${topic.name}`}
                            value={topic.status}
                            onChange={(e) =>
                              dispatch({
                                type: 'topic/update',
                                id: topic.id,
                                patch: { status: e.target.value as Topic['status'] },
                              })
                            }
                          >
                            <option value="not-started">Not started</option>
                            <option value="learning">Learning</option>
                            <option value="practised">Practised</option>
                            <option value="strong">Strong</option>
                            <option value="skipped">Skipped</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Collapse>
      ))}
    </Card>
  );
}

function PracticeModal({ section, onClose, today }: { section: SectionKey; onClose: () => void; today: string }) {
  const { state, dispatch } = useStore();
  const [label, setLabel] = useState(`${SECTION_LABELS[section]} practice`);
  const [topicId, setTopicId] = useState('');
  const [attempted, setAttempted] = useState('12');
  const [correct, setCorrect] = useState('8');
  const [timeMin, setTimeMin] = useState('30');
  const [difficulty, setDifficulty] = useState('3');
  const [confidence, setConfidence] = useState('3');
  const [setsAttempted, setSetsAttempted] = useState('2');
  const [setsSolved, setSetsSolved] = useState('1');
  const [missReasons, setMissReasons] = useState<SetMissReason[]>([]);
  const [varcType, setVarcType] = useState<PracticeSession['varcType']>('rc');
  const [passageType, setPassageType] = useState('');
  const [notes, setNotes] = useState('');

  const save = () => {
    dispatch({
      type: 'practice/add',
      session: {
        date: today,
        section,
        topicId: topicId || undefined,
        label,
        attempted: Number(attempted) || 0,
        correct: Number(correct) || 0,
        timeMin: Number(timeMin) || 0,
        difficulty: (Number(difficulty) || 3) as 1 | 2 | 3 | 4 | 5,
        confidence: (Number(confidence) || 3) as 1 | 2 | 3 | 4 | 5,
        setsAttempted: section === 'DILR' ? Number(setsAttempted) || 0 : undefined,
        setsSolved: section === 'DILR' ? Number(setsSolved) || 0 : undefined,
        setMissReasons: section === 'DILR' ? missReasons : undefined,
        varcType: section === 'VARC' ? varcType : undefined,
        passageType: section === 'VARC' ? passageType : undefined,
        notes,
      },
    });
    if (topicId) {
      const topic = state.topics.find((t) => t.id === topicId);
      if (topic && (topic.status === 'not-started' || topic.status === 'learning')) {
        dispatch({ type: 'topic/update', id: topicId, patch: { status: 'practised' } });
      }
    }
    onClose();
  };

  return (
    <Modal
      title={`Log ${SECTION_LABELS[section]} practice`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            Save session
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="Session label" htmlFor="plabel">
        <input id="plabel" type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Topic" htmlFor="ptopic">
        <select id="ptopic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
          <option value="">No specific topic</option>
          {state.topics
            .filter((t) => t.section === section)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </Field>
      <div className="inline-fields">
        <Field label="Attempted" htmlFor="patt">
          <input id="patt" type="number" min={0} value={attempted} onChange={(e) => setAttempted(e.target.value)} />
        </Field>
        <Field label="Correct" htmlFor="pcor">
          <input id="pcor" type="number" min={0} value={correct} onChange={(e) => setCorrect(e.target.value)} />
        </Field>
        <Field label="Minutes" htmlFor="ptime">
          <input id="ptime" type="number" min={0} value={timeMin} onChange={(e) => setTimeMin(e.target.value)} />
        </Field>
      </div>
      <div className="inline-fields-2">
        <Field label="Difficulty (1-5)" htmlFor="pdiff">
          <input id="pdiff" type="number" min={1} max={5} value={difficulty} onChange={(e) => setDifficulty(e.target.value)} />
        </Field>
        <Field label="Confidence (1-5)" htmlFor="pconf">
          <input id="pconf" type="number" min={1} max={5} value={confidence} onChange={(e) => setConfidence(e.target.value)} />
        </Field>
      </div>

      {section === 'DILR' && (
        <>
          <div className="inline-fields-2">
            <Field label="Sets attempted" htmlFor="psa">
              <input id="psa" type="number" min={0} value={setsAttempted} onChange={(e) => setSetsAttempted(e.target.value)} />
            </Field>
            <Field label="Sets solved" htmlFor="pss">
              <input id="pss" type="number" min={0} value={setsSolved} onChange={(e) => setSetsSolved(e.target.value)} />
            </Field>
          </div>
          <fieldset className="field">
            <legend>Why were sets missed?</legend>
            <div className="choice-row">
              {(Object.keys(SET_MISS_REASON_LABELS) as SetMissReason[]).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="choice"
                  aria-pressed={missReasons.includes(reason)}
                  onClick={() =>
                    setMissReasons(
                      missReasons.includes(reason) ? missReasons.filter((r) => r !== reason) : [...missReasons, reason],
                    )
                  }
                >
                  {SET_MISS_REASON_LABELS[reason]}
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {section === 'VARC' && (
        <div className="inline-fields-2">
          <Field label="Question type" htmlFor="pvt">
            <select id="pvt" value={varcType} onChange={(e) => setVarcType(e.target.value as PracticeSession['varcType'])}>
              {Object.entries(VARC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Passage type" htmlFor="ppt">
            <input id="ppt" type="text" value={passageType} onChange={(e) => setPassageType(e.target.value)} placeholder="Philosophy, economics..." />
          </Field>
        </div>
      )}

      <Field label="Notes on mistakes" htmlFor="pnotes">
        <textarea id="pnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="tiny faint">
        Log each incorrect question in the Error log too — error type is what the planner uses to decide what you study
        next.
      </p>
    </Modal>
  );
}

export function SectionTag({ section }: { section: SectionKey }) {
  return <Tag tone="neutral">{SECTION_LABELS[section]}</Tag>;
}

export function EmptyCat() {
  return <Empty>No CAT data yet.</Empty>;
}
