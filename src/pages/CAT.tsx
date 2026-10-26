import { SECTIONS, SECTION_FULL_NAMES, SECTION_LABELS } from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { Mock, SectionKey, TrackStatus } from '../domain/types';
import { encouragement, formatBand, TREND_WORDS, type SectionCard } from '../engine/forecast';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { ChartLegend, TrendChart } from '../ui/charts';
import { Callout, Card, Empty, Stat, StatGrid, StatusPill } from '../ui/components';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${r1(n)}`;
const chance = (p: number) => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `${Math.round(p * 100)}%`);

/** Encouraging tones only: green when on course, the accent colour otherwise. */
const toneFor = (status: TrackStatus): 'ok' | 'neutral' => (status === 'ON_TRACK' || status === 'STRETCH' ? 'ok' : 'neutral');

export function CAT() {
  const { state } = useStore();
  const { forecast: f, cadence } = useEngine();
  const p = f.forecast?.percentile;
  const marked = f.history.filter((h) => h.marks !== undefined);
  const focus = f.constraint.established ? f.constraint.top : [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CAT readiness</h1>
          <div className="sub">
            {f.n} full mock{f.n === 1 ? '' : 's'} · {f.daysRemaining} days to go
          </div>
        </div>
        <StatusPill status={f.status} />
      </div>

      {/* 1. Headline */}
      <Card title="Where you stand">
        <StatGrid>
          <Stat
            label="Current level"
            value={f.level ? (f.level.percentile !== undefined ? r1(f.level.percentile) : `${r0(f.level.marks)} marks`) : '—'}
            sub={f.level ? (f.level.percentile !== undefined ? `about ${r0(f.level.marks)} marks` : 'percentile not recorded') : 'take a mock'}
          />
          <Stat
            label="Likely on exam day"
            value={p ? r1(p.p50) : f.forecast ? `${r0(f.forecast.marks.p50)} marks` : '—'}
            sub={p ? `${r1(p.p10)} to ${r1(p.p90)}` : 'needs marks and percentile'}
          />
          <Stat
            label={`Chance of ${f.target}`}
            value={f.forecast?.probability !== undefined ? chance(f.forecast.probability) : '—'}
            sub={f.curve?.targetMarks !== undefined ? `${f.target} needs about ${r0(f.curve.targetMarks)} marks` : undefined}
          />
          <Stat
            label="Trend"
            value={TREND_WORDS[f.trend.label]}
            sub={f.trend.slopePerWeek !== undefined ? `${signed(f.trend.slopePerWeek)} marks a week` : undefined}
          />
        </StatGrid>

        <Callout tone={toneFor(f.status)}>
          <div className="small">
            <strong>{encouragement(f.status, f.target, p?.p50)}</strong>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            <strong>Next:</strong> {f.recommendedAction}
          </div>
        </Callout>
      </Card>

      {/* 2. Exam-day scenarios */}
      {f.scenarios.length > 0 && (
        <Card title="Exam-day forecast">
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
        </Card>
      )}

      {/* 3. What changed */}
      {f.whatChanged.length > 1 && (
        <Card title="Since your last mock">
          <ul className="bullets small">
            {f.whatChanged.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* 4. Trend */}
      <Card title="Marks over time">
        {marked.length > 0 ? (
          <TrendChart
            labels={marked.map((h) => formatDate(h.date))}
            target={f.curve?.targetMarks !== undefined ? r0(f.curve.targetMarks) : undefined}
            series={[{ name: 'Overall marks', values: marked.map((h) => h.marks ?? null), tone: 'accent' }]}
            ariaLabel="Overall marks over time"
          />
        ) : (
          <Empty>No full mocks with marks yet.</Empty>
        )}
      </Card>

      {/* 5. Where the next marks are */}
      {(focus.length > 0 || f.cleanPaper?.combinedBestMarks !== undefined) && (
        <Card title="Where your next marks are">
          {focus.length > 0 && (
            <ul className="bullets small">
              {focus.map((d) => (
                <li key={d.section}>
                  <strong>{SECTION_LABELS[d.section]}</strong>:{' '}
                  {d.kind === 'CONSISTENCY'
                    ? `you have scored ${r0(d.best)} here; steadier papers bring that level back more often.`
                    : `room to grow from ${r0(d.mean)} towards ${r0(d.best)} marks and beyond.`}
                </li>
              ))}
            </ul>
          )}
          {f.cleanPaper?.combinedBestMarks !== undefined && (
            <p className="small muted" style={{ marginTop: focus.length > 0 ? 8 : 0 }}>
              Your section bests together already make {r0(f.cleanPaper.combinedBestMarks)} marks.
            </p>
          )}
        </Card>
      )}

      {/* 6. Sections */}
      {f.sections.map((card) => (
        <SectionReadinessCard key={card.section} card={card} target={f.target} />
      ))}

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
        <Card title="Recorded percentiles">
          <TrendChart
            labels={f.history.map((h) => formatDate(h.date))}
            target={state.profile.targetPercentile}
            series={[
              { name: 'Overall', values: f.history.map((h) => h.percentile ?? null), tone: 'accent' },
              ...SECTIONS.map((s) => ({
                name: s,
                values: alignSection(state.mocks, f.history.map((h) => h.date), s),
                tone: SECTION_TONES[s],
                dashed: true,
              })),
            ]}
            ariaLabel="Recorded percentiles over time, overall and by section"
          />
          <ChartLegend
            items={[
              { label: 'Overall', tone: 'accent' },
              ...SECTIONS.map((s) => ({ label: SECTION_LABELS[s], tone: SECTION_TONES[s] })),
            ]}
          />
        </Card>
      )}
    </>
  );
}

const SECTION_TONES: Record<SectionKey, 'ok' | 'warn' | 'neutral'> = { VARC: 'ok', DILR: 'warn', QA: 'neutral' };

/** A section's recorded percentile on each full-mock date; blanks become gaps, not zeros. */
function alignSection(mocks: Mock[], dates: string[], s: SectionKey): (number | null)[] {
  return dates.map((d) => {
    const pct = mocks.find((m) => m.kind === 'full' && m.date === d)?.sections[s]?.percentile;
    return pct && pct > 0 ? pct : null;
  });
}

function SectionReadinessCard({ card, target }: { card: SectionCard; target: number }) {
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
          sub={level ? `about ${r0(level.marks)} marks` : 'no marks recorded'}
        />
        <Stat label="Latest percentile" value={card.latestPercentile ?? '—'} sub={`target ${target}`} />
        <Stat
          label="Average (last 5)"
          value={card.recentAveragePercentile ?? '—'}
          sub={card.recentCount > 0 ? `of ${card.recentCount} recorded` : 'no percentiles yet'}
        />
        <Stat
          label="Trend"
          value={TREND_WORDS[card.trend.label]}
          sub={card.trend.slopePerWeek !== undefined ? `${signed(card.trend.slopePerWeek)} marks a week` : undefined}
        />
        <Stat label="Exam day" value={fc ? r1(fc.p50) : '—'} sub={fc ? `${r1(fc.p10)} to ${r1(fc.p90)}` : 'needs section percentiles'} />
      </StatGrid>

      {(card.attempts.band || card.attempts.accuracyFloor !== undefined || card.dilr) && (
        <div className="section-rules">
          {card.attempts.band && (
            <div>
              <div className="section-label">Target attempts</div>
              <div className="mono">{formatBand(card.attempts.band)}</div>
              <div className="tiny muted">what your best papers attempted</div>
            </div>
          )}
          {card.attempts.accuracyFloor !== undefined && (
            <div>
              <div className="section-label">Accuracy to hold</div>
              <div className="mono">{card.attempts.accuracyFloor}%</div>
              <div className="tiny muted">in those papers</div>
            </div>
          )}
          {card.dilr && (
            <div>
              <div className="section-label">Sets</div>
              <div className="mono">{Math.round(card.dilr.conversion * 100)}% solved</div>
              <div className="tiny muted">of the sets you attempt</div>
            </div>
          )}
        </div>
      )}

      <Callout tone={toneFor(card.status)}>
        <strong>Next:</strong> {card.action}
      </Callout>
    </Card>
  );
}
