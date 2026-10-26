import { useMemo, useRef, useState } from 'react';
import { computeStats, MATURE_DAYS, type Rate } from '../../flashcards/stats';
import { dayStart, studyDay } from '../../flashcards/scheduler';
import { useStore } from '../../state/store';
import { HBarList } from '../charts';
import { Card, Empty, Stat, StatGrid } from '../components';

interface Segment {
  key: string;
  label: string;
  colour: string;
}

/** Bars by day, optionally stacked, with the same hover behaviour as the other charts. */
function BarChart({
  labels,
  series,
  segments,
  height = 170,
  unit = '',
  ariaLabel,
}: {
  labels: string[];
  series: Record<string, number>[];
  segments: Segment[];
  height?: number;
  unit?: string;
  ariaLabel: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const h = height;
  const padL = 34;
  const padB = 24;
  const padT = 10;
  const totals = series.map((row) => segments.reduce((a, s) => a + (row[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = (w - padL - 8) / Math.max(1, labels.length);
  const barW = Math.max(2, Math.min(18, slot - 3));
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);
  const every = Math.ceil(labels.length / 8);

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="chart"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const i = Math.floor((((e.clientX - rect.left) / rect.width) * w - padL) / slot);
          setHover(i >= 0 && i < labels.length ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={padL} x2={w - 8} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={padL - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
          {Math.round(max)}
          {unit}
        </text>
        {series.map((row, i) => {
          let base = 0;
          const x = padL + i * slot + (slot - barW) / 2;
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>
              {segments.map((s) => {
                const v = row[s.key] ?? 0;
                if (v <= 0) return null;
                const top = y(base + v);
                const rect = <rect key={s.key} x={x} y={top} width={barW} height={y(base) - top} rx={2} fill={s.colour} />;
                base += v;
                return rect;
              })}
              {i % every === 0 && (
                <text x={x + barW / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" role="status" style={{ left: `${Math.min(88, Math.max(12, ((padL + hover * slot + slot / 2) / w) * 100))}%` }}>
          <div className="chart-tip-label">{labels[hover]}</div>
          {segments.map((s) => (
            <div key={s.key} className="chart-tip-row">
              <span className="chart-tip-swatch" style={{ background: s.colour }} />
              <span className="chart-tip-name">{s.label}</span>
              <span className="chart-tip-value">{series[hover][s.key] ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const pct = (r: Rate) => (r.rate === null ? '—' : `${Math.round(r.rate * 100)}%`);

/** Last 20 weeks of study, a square per day, darker for more reviews. */
function Heatmap({ counts }: { counts: Map<number, number> }) {
  const today = studyDay(Date.now());
  const weeks = 20;
  const start = today - (weeks * 7 - 1);
  const max = Math.max(1, ...[...counts.entries()].filter(([d]) => d >= start).map(([, c]) => c));
  const cells = Array.from({ length: weeks * 7 }, (_, i) => start + i);
  return (
    <div className="heatmap" role="img" aria-label="Reviews per day over the last 20 weeks">
      {cells.map((d) => {
        const c = counts.get(d) ?? 0;
        const level = c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4));
        return (
          <span
            key={d}
            className={`heat heat-${level}${d === today ? ' today' : ''}`}
            title={`${new Date(dayStart(d)).toLocaleDateString()}: ${c} review${c === 1 ? '' : 's'}`}
          />
        );
      })}
    </div>
  );
}

export function FlashcardStats({ deckId }: { deckId?: string }) {
  const { state } = useStore();
  const [scope, setScope] = useState(deckId ?? '');
  const stats = useMemo(
    () =>
      computeStats(state.flashcards, state.cardReviews, Date.now(), {
        deckIds: scope ? new Set([scope]) : undefined,
      }),
    [scope, state.cardReviews, state.flashcards],
  );

  const shortDate = (d: Date) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  const segmentsActivity: Segment[] = [
    { key: 'learn', label: 'Learning', colour: 'var(--warn)' },
    { key: 'review', label: 'Review', colour: 'var(--ok)' },
  ];

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <select className="fit-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Deck">
          <option value="">All decks</option>
          {state.decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <Card title="Today">
        {stats.today.studied === 0 ? (
          <Empty>No cards studied today yet.</Empty>
        ) : (
          <p className="small">
            Studied <strong>{stats.today.studied}</strong> card{stats.today.studied === 1 ? '' : 's'} in{' '}
            <strong>{Math.round(stats.today.timeMs / 60_000)} min</strong> today. Again count: <strong>{stats.today.again}</strong>.
            Learn {stats.today.learn} · Review {stats.today.review} · Relearn {stats.today.relearn}. Correct on reviews:{' '}
            <strong>{pct(stats.today.correct)}</strong>.
          </p>
        )}
      </Card>

      <Card title="Retention" subtitle={`True retention over the last ${stats.retention.windowDays} days: review answers that were not Again.`}>
        <StatGrid>
          <Stat label="Young" value={pct(stats.retention.young)} sub={`${stats.retention.young.total} reviews · interval under ${MATURE_DAYS}d`} />
          <Stat label="Mature" value={pct(stats.retention.mature)} sub={`${stats.retention.mature.total} reviews · ${MATURE_DAYS}d and over`} />
          <Stat label="All reviews" value={pct(stats.retention.total)} sub={`${stats.retention.total.passed} of ${stats.retention.total.total}`} />
          <Stat
            label="Streak"
            value={`${stats.streak.current}d`}
            sub={`best ${stats.streak.best}d · ${stats.streak.daysStudied} day${stats.streak.daysStudied === 1 ? '' : 's'} studied`}
          />
        </StatGrid>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Spaced repetition aims to hold retention steady, usually around 85-90%. Much lower means intervals are growing faster than
          memory; much higher means you could study less.
        </p>
      </Card>

      <Card title="Card counts">
        {stats.counts.total === 0 ? (
          <Empty>No cards yet.</Empty>
        ) : (
          <>
            <div className="count-bar" role="img" aria-label="Cards by state">
              {(
                [
                  ['new', stats.counts.new, 'var(--accent)'],
                  ['learning', stats.counts.learning, 'var(--warn)'],
                  ['young', stats.counts.young, 'var(--ok)'],
                  ['mature', stats.counts.mature, 'color-mix(in srgb, var(--ok) 60%, var(--text))'],
                  ['suspended', stats.counts.suspended, 'var(--border-strong)'],
                ] as [string, number, string][]
              )
                .filter(([, v]) => v > 0)
                .map(([k, v, c]) => (
                  <span key={k} style={{ flexGrow: v, background: c }} title={`${k}: ${v}`} />
                ))}
            </div>
            <div className="count-legend tiny">
              <span>
                <i style={{ background: 'var(--accent)' }} />
                New {stats.counts.new}
              </span>
              <span>
                <i style={{ background: 'var(--warn)' }} />
                Learning {stats.counts.learning}
              </span>
              <span>
                <i style={{ background: 'var(--ok)' }} />
                Young {stats.counts.young}
              </span>
              <span>
                <i style={{ background: 'color-mix(in srgb, var(--ok) 60%, var(--text))' }} />
                Mature {stats.counts.mature}
              </span>
              <span>
                <i style={{ background: 'var(--border-strong)' }} />
                Suspended {stats.counts.suspended}
              </span>
            </div>
          </>
        )}
      </Card>

      <Card title="Reviews" subtitle="Last 30 days">
        <BarChart
          labels={stats.activity.map((a) => shortDate(a.date))}
          series={stats.activity.map((a) => ({ learn: a.learn, review: a.review }))}
          segments={segmentsActivity}
          ariaLabel="Reviews per day for the last 30 days"
        />
        <p className="tiny muted">
          {stats.totalReviews} reviews in total
          {stats.averageSecondsPerCard !== null ? ` · ${stats.averageSecondsPerCard.toFixed(1)} seconds per card on average` : ''}.
        </p>
      </Card>

      <Card title="Future due" subtitle="Cards coming due over the next 30 days">
        <BarChart
          labels={stats.forecast.map((f) => (f.offset === 0 ? 'Today' : `+${f.offset}d`))}
          series={stats.forecast.map((f) => ({ due: f.count }))}
          segments={[{ key: 'due', label: 'Due', colour: 'var(--accent)' }]}
          ariaLabel="Cards due per day for the next 30 days"
        />
      </Card>

      <Card title="Calendar" subtitle="Last 20 weeks">
        <Heatmap counts={stats.heatmap} />
      </Card>

      <div className="grid grid-2">
        <Card title="Intervals" subtitle={stats.averageIntervalDays !== null ? `Average ${Math.round(stats.averageIntervalDays)} days` : undefined}>
          {stats.intervals.every((b) => b.count === 0) ? (
            <Empty>No review cards yet.</Empty>
          ) : (
            <HBarList items={stats.intervals.map((b) => ({ label: b.label, value: b.count, tone: 'accent' as const }))} />
          )}
        </Card>
        <Card title="Answer buttons" subtitle="Last 30 days">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th className="num">Again</th>
                  <th className="num">Hard</th>
                  <th className="num">Good</th>
                  <th className="num">Easy</th>
                </tr>
              </thead>
              <tbody>
                {(['learning', 'young', 'mature'] as const).map((k) => (
                  <tr key={k}>
                    <td className="small">{k[0].toUpperCase() + k.slice(1)}</td>
                    {stats.buttons[k].map((v, i) => (
                      <td key={i} className="num mono">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {stats.averageEase !== null && (
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Average ease {Math.round(stats.averageEase * 100)}%.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
