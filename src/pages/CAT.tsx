import { useState } from 'react';
import {
  SECTIONS,
  SECTION_FULL_NAMES,
  SECTION_LABELS,
  SET_MISS_REASON_LABELS,
  VARC_TYPE_LABELS,
} from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { Mock, PracticeSession, SectionKey, SetMissReason, TrackStatus } from '../domain/types';
import { describeContradiction, formatBand, PATTERN_LABELS, type SectionCard } from '../engine/forecast';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { ChartLegend, TrendChart } from '../ui/charts';
import { Callout, Card, Collapse, Empty, Field, Modal, Stat, StatGrid, StatusPill, Tag } from '../ui/components';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${r1(n)}`;
const chance = (p: number) => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);

function toneFor(status: TrackStatus): 'ok' | 'warn' | 'risk' | 'neutral' {
  if (status === 'ON_TRACK') return 'ok';
  if (status === 'STRETCH' || status === 'AT_RISK') return 'warn';
  if (status === 'OFF_TRACK' || status === 'BEHIND') return 'risk';
  return 'neutral';
}

export function CAT() {
  const { state, today } = useStore();
  const { forecast: f, cadence } = useEngine();
  const [logging, setLogging] = useState<SectionKey | null>(null);
  const p = f.forecast?.percentile;
  const marked = f.history.filter((h) => h.marks !== undefined);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CAT readiness</h1>
          <div className="sub">
            {f.n} full mock{f.n === 1 ? '' : 's'} with marks · {f.analysedMocks} analysed · evidence {f.confidence}
          </div>
        </div>
        <div className="row">
          {f.highVariance && <Tag tone="warn">High variance</Tag>}
          <StatusPill status={f.status} />
        </div>
      </div>

      {/* 1. Headline */}
      <Card title="Where you stand" subtitle="Worked in marks, weighted towards recent mocks, converted to percentile at the end.">
        <StatGrid>
          <Stat
            label="Current level"
            value={f.level ? (f.level.percentile !== undefined ? r1(f.level.percentile) : `${r0(f.level.marks)} marks`) : '—'}
            sub={
              f.level
                ? f.level.percentileLow !== undefined
                  ? `${r0(f.level.low)}–${r0(f.level.high)} marks · pctl ${r1(f.level.percentileLow)}–${r1(f.level.percentileHigh ?? 0)}`
                  : `${r0(f.level.low)}–${r0(f.level.high)} marks`
                : 'no marks recorded'
            }
          />
          <Stat
            label="Likely on exam day"
            value={p ? r1(p.p50) : f.forecast ? `${r0(f.forecast.marks.p50)} marks` : '—'}
            sub={
              p
                ? `range ${r1(p.p10)}–${r1(p.p90)}${f.forecast?.indicative ? ' · indicative' : ''}`
                : f.forecast
                  ? `range ${r0(f.forecast.marks.p10)}–${r0(f.forecast.marks.p90)} marks`
                  : 'needs a mock'
            }
          />
          <Stat
            label={`Chance of ${f.target}`}
            value={f.forecast?.probability !== undefined ? chance(f.forecast.probability) : '—'}
            sub={f.forecast?.probability !== undefined ? 'share of 10,000 simulated papers' : 'needs marks and percentile'}
          />
          <Stat
            label="Trend"
            value={f.trend.label === 'INSUFFICIENT' ? 'Too early' : f.trend.label.toLowerCase()}
            sub={
              f.trend.slopePerWeek !== undefined
                ? `${signed(f.trend.slopePerWeek)} marks/week · ${f.trend.n} mocks`
                : `${f.trend.n} mock${f.trend.n === 1 ? '' : 's'}`
            }
          />
        </StatGrid>

        <Callout tone={toneFor(f.status)}>
          <div className="small">
            <strong>Rule:</strong> {f.statusRule}
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            <strong>Next:</strong> {f.recommendedAction}
          </div>
        </Callout>

        {f.curve && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            At your level, one more percentile point near {f.target} costs about{' '}
            <strong>{r1(f.curve.marksPerPointAtTarget ?? 0)} marks</strong>
            {f.curve.targetMarks !== undefined ? `, and ${f.target} percentile needs roughly ${r0(f.curve.targetMarks)} marks` : ''}.
            {f.curve.provisional
              ? ` Mapping is provisional: interpolated from ${f.curve.pairs} marks-and-percentile pairs; a fitted curve needs 5.`
              : ''}
          </p>
        )}
      </Card>

      {/* 2. What changed */}
      {f.whatChanged.length > 0 && (
        <Card title="What changed">
          <ul className="bullets small">
            {f.whatChanged.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* 6. Forecast table */}
      {f.scenarios.length > 0 && (
        <Card title="Exam-day forecast" subtitle="10,000 papers resampled from your recent full mocks.">
          <div className="scenario-grid">
            {f.scenarios.map((sc) => (
              <div key={sc.key} className={`scenario scenario-${sc.key.toLowerCase()}`}>
                <div className="scenario-label">{sc.label}</div>
                <div className="scenario-value mono">{sc.percentile !== undefined ? r1(sc.percentile) : r0(sc.marks)}</div>
                <div className="tiny muted">{sc.percentile !== undefined ? `percentile · ${r0(sc.marks)} marks` : 'marks'}</div>
                <div className="tiny scenario-chance">{sc.chance}</div>
                <ul className="bullets tiny">
                  {sc.conditions.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {f.forecast && (
            <Collapse title="How this was produced">
              <ul className="bullets tiny">
                {f.forecast.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>
                  Whole mocks are resampled from the last {f.forecast.window}, weighted by recency with a 21-day half-life, so a
                  bad VARC day and a bad QA day stay the same day.
                </li>
                <li>Two percentile points of provider noise are added: mock percentiles are not exam percentiles.</li>
              </ul>
            </Collapse>
          )}
        </Card>
      )}

      {/* 3. Trend */}
      <Card title="Trend" subtitle={f.trend.summary}>
        {marked.length > 0 ? (
          <>
            <TrendChart
              labels={marked.map((h) => formatDate(h.date))}
              target={f.curve?.targetMarks !== undefined ? r0(f.curve.targetMarks) : undefined}
              series={[{ name: 'Overall marks', values: marked.map((h) => h.marks ?? null), tone: 'accent' }]}
              ariaLabel="Overall marks over time"
            />
            {f.trend.blocks && (
              <div className="row small muted" style={{ marginTop: 8 }}>
                <span>Block averages, oldest to newest:</span>
                {f.trend.blocks.map((b, i) => (
                  <span key={i} className="mono">
                    {r1(b)}
                  </span>
                ))}
                {f.trend.blocksRising && <Tag tone="ok">rising every block</Tag>}
              </div>
            )}
          </>
        ) : (
          <Empty>No full mocks with marks yet.</Empty>
        )}
      </Card>

      {/* 4 + 5. Binding constraint and clean paper rate */}
      <Card title="Binding constraint" subtitle={f.constraint.established ? f.constraint.note : undefined}>
        {!f.constraint.established ? (
          <Empty>{f.constraint.note}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="num">Variance share</th>
                  <th className="num">Ceiling gap</th>
                  <th className="num">Floor loss</th>
                  <th className="num">Pts per mark</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                {f.constraint.top.flatMap((d) => [
                  <tr key={d.section} className="no-rule">
                    <td>
                      <strong>{SECTION_LABELS[d.section]}</strong>
                    </td>
                    <td className="num mono">{Math.round(d.varianceShare * 100)}%</td>
                    <td className="num mono">{r1(d.ceilingGap)}</td>
                    <td className="num mono">
                      {r1(d.floorLoss)}
                      <div className="tiny faint">{Math.round(d.floorShare * 100)}% of papers</div>
                    </td>
                    <td className="num mono">{d.marginalValue !== undefined ? r1(d.marginalValue) : 'not recorded'}</td>
                    <td>
                      <Tag tone={d.kind === 'CONSISTENCY' ? 'warn' : 'neutral'}>{d.kind.toLowerCase()}</Tag>
                    </td>
                  </tr>,
                  <tr key={`${d.section}-why`}>
                    <td colSpan={6} className="tiny muted why-row">
                      {d.why}
                    </td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </div>
        )}

        {f.cleanPaper && (
          <Callout tone={f.cleanPaper.consistencyHeadline ? 'warn' : 'neutral'}>
            <div className="small">
              <strong>Clean paper rate:</strong> {f.cleanPaper.count} of {f.cleanPaper.n} full mocks (
              {Math.round(f.cleanPaper.rate * 100)}%) had every section above the floor.
              {f.cleanPaper.combinedBestMarks !== undefined &&
                ` Your section bests together make ${r0(f.cleanPaper.combinedBestMarks)} marks${
                  f.cleanPaper.combinedBestPercentile !== undefined
                    ? `, about ${r1(f.cleanPaper.combinedBestPercentile)} percentile`
                    : ''
                }.`}
              {f.cleanPaper.consistencyHeadline &&
                ' The target is already inside your demonstrated range, so the headline finding is consistency.'}
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              {f.cleanPaper.rule}
            </div>
          </Callout>
        )}
      </Card>

      {/* 7. Section cards */}
      {f.sections.map((card) => (
        <SectionReadinessCard key={card.section} card={card} target={f.target} onLog={() => setLogging(card.section)} />
      ))}

      {/* 8. Error patterns */}
      <Card
        title="Error patterns"
        subtitle={`From the analysis notes of ${f.patterns.mocksWithNotes} full mock${f.patterns.mocksWithNotes === 1 ? '' : 's'}. Keyword-tagged: evidence to read, not a diagnosis.`}
      >
        {f.patterns.patterns.length === 0 ? (
          <Empty>
            {f.patterns.mocksWithNotes === 0
              ? 'No analysis notes yet. Analyse a mock and write what went wrong; this is where patterns come from.'
              : 'No recurring behaviour patterns found in your notes.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th className="num">Mocks</th>
                  <th>Trend</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {f.patterns.patterns.map((pt) => (
                  <tr key={pt.tag}>
                    <td>{PATTERN_LABELS[pt.tag]}</td>
                    <td className="num mono">{pt.frequency}</td>
                    <td>
                      <Tag
                        tone={
                          pt.trend === 'IMPROVING' ? 'ok' : pt.trend === 'PERSISTENT' ? 'warn' : pt.trend === 'NEW' ? 'accent' : 'neutral'
                        }
                      >
                        {pt.trend.toLowerCase()}
                      </Tag>
                    </td>
                    <td className="tiny">{formatDate(pt.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {f.patterns.contradictions.map((c) => (
          <Callout key={c.first.text + c.second.text} tone="warn">
            <div className="small">
              <strong>Possible contradiction.</strong> {describeContradiction(c)}
            </div>
          </Callout>
        ))}
      </Card>

      {/* 9. Data quality, always present */}
      <Card title="Data quality">
        <ul className="bullets small">
          {f.dataQuality.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

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
      </Card>

      {f.history.some((h) => h.percentile !== undefined) && (
        <Card title="Recorded percentiles" subtitle="As entered. The forecast above works in marks, not in these.">
          <TrendChart
            labels={f.history.map((h) => formatDate(h.date))}
            target={state.profile.targetPercentile}
            series={[
              { name: 'Overall', values: f.history.map((h) => h.percentile ?? null), tone: 'accent' },
              ...SECTIONS.map((s) => ({
                name: s,
                values: alignSection(state.mocks, f.history.map((h) => h.date), s),
                tone: (s === 'VARC' ? 'ok' : s === 'DILR' ? 'warn' : 'risk') as 'ok' | 'warn' | 'risk',
                dashed: true,
              })),
            ]}
            ariaLabel="Recorded percentiles over time, overall and by section"
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

      {logging && <PracticeModal section={logging} onClose={() => setLogging(null)} today={today} />}
    </>
  );
}

/** A section's recorded percentile on each full-mock date; blanks become gaps, not zeros. */
function alignSection(mocks: Mock[], dates: string[], s: SectionKey): (number | null)[] {
  return dates.map((d) => {
    const pct = mocks.find((m) => m.kind === 'full' && m.date === d)?.sections[s]?.percentile;
    return pct && pct > 0 ? pct : null;
  });
}

function SectionReadinessCard({ card, target, onLog }: { card: SectionCard; target: number; onLog: () => void }) {
  const level = card.level;
  const fc = card.forecast?.percentile;
  return (
    <Card
      title={
        <div className="card-title-row">
          <h2>{SECTION_LABELS[card.section]}</h2>
          <span className="tiny muted">{SECTION_FULL_NAMES[card.section]}</span>
        </div>
      }
      action={<StatusPill status={card.status} />}
    >
      <StatGrid>
        <Stat
          label="Readiness"
          value={level ? (level.percentile !== undefined ? r1(level.percentile) : `${r0(level.marks)} marks`) : '—'}
          sub={
            level
              ? level.percentileLow !== undefined
                ? `band ${r1(level.percentileLow)}–${r1(level.percentileHigh ?? 0)} · ${r1(level.marks)} marks`
                : `${r0(level.low)}–${r0(level.high)} marks · percentile not recorded`
              : 'no marks recorded'
          }
        />
        <Stat label="Latest percentile" value={card.latestPercentile ?? 'not recorded'} sub={`target ${target}`} />
        <Stat
          label="Average (last 5)"
          value={card.recentAveragePercentile ?? 'not recorded'}
          sub={card.recentCount > 0 ? `of ${card.recentCount} recorded` : 'no percentiles yet'}
        />
        <Stat
          label="Trend"
          value={card.trend.label === 'INSUFFICIENT' ? 'Too early' : card.trend.label.toLowerCase()}
          sub={card.trend.slopePerWeek !== undefined ? `${signed(card.trend.slopePerWeek)} marks/week` : `${card.trend.n} mocks`}
        />
        <Stat label="Exam day" value={fc ? r1(fc.p50) : '—'} sub={fc ? `range ${r1(fc.p10)}–${r1(fc.p90)}` : 'needs section percentiles'} />
      </StatGrid>

      <div className="section-rules">
        <div>
          <div className="section-label">Target attempts</div>
          <div className="mono">{card.attempts.band ? formatBand(card.attempts.band) : 'not enough data'}</div>
          <div className="tiny muted">
            {card.attempts.band ? 'what your top-third papers attempted' : `needs 3 full mocks with attempts (have ${card.attempts.n})`}
          </div>
        </div>
        <div>
          <div className="section-label">Accuracy floor</div>
          <div className="mono">{card.attempts.accuracyFloor !== undefined ? `${card.attempts.accuracyFloor}%` : 'not enough data'}</div>
          <div className="tiny muted">lowest accuracy among those papers</div>
        </div>
        {card.dilr && (
          <div>
            <div className="section-label">Sets</div>
            <div className="mono">{Math.round(card.dilr.conversion * 100)}% converted</div>
            <div className="tiny muted">expected at 0/1/2/3 solved: {card.dilr.expected.map((e) => r0(e)).join(' / ')} marks</div>
          </div>
        )}
      </div>

      <Callout tone={toneFor(card.status)}>
        <strong>Next action:</strong> {card.action}
      </Callout>

      <p className="tiny muted" style={{ marginTop: 8 }}>
        {card.statusRule} Sectionals: {card.sectional.verdict}
        {card.sectional.latestPercentile !== undefined && ` Latest sectional percentile ${card.sectional.latestPercentile}.`}
      </p>

      <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={onLog}>
        Log a {SECTION_LABELS[card.section]} practice session
      </button>
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
