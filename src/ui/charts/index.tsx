/**
 * Charts are hand-rolled SVG. No charting library: every chart here answers a
 * specific question, and none of them justify a 200KB dependency on a phone.
 *
 * They are interactive where interaction earns its place - a trend line is
 * worth interrogating point by point; a three-bar comparison is not.
 */
import { useId, useRef, useState } from 'react';

export interface Series {
  name: string;
  values: (number | null)[];
  tone?: 'accent' | 'ok' | 'warn' | 'risk' | 'neutral';
  dashed?: boolean;
}

const TONE_VAR: Record<string, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  risk: 'var(--risk)',
  neutral: 'var(--neutral)',
};

function niceDomain(values: number[], pad = 6): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 100];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return [Math.max(0, min - pad), max + pad];
  return [Math.max(0, min - pad), max + pad];
}

/** Catmull-Rom to cubic Bezier: a gentle curve, never a wild overshoot. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    // 1/6 tension keeps the curve close to the data.
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function TrendChart({
  labels,
  series,
  target,
  height = 200,
  yMin,
  yMax,
  ariaLabel,
  unit = '',
}: {
  labels: string[];
  series: Series[];
  target?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  ariaLabel?: string;
  unit?: string;
}) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (target !== undefined) all.push(target);
  const [d0, d1] = niceDomain(all);
  const lo = yMin ?? d0;
  const hi = yMax ?? d1;

  const w = 720;
  const h = height;
  const padL = 38;
  const padR = 14;
  const padT = 16;
  const padB = 30;
  const n = Math.max(labels.length, 1);
  const plotW = w - padL - padR;

  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => padT + (1 - (v - lo) / Math.max(0.001, hi - lo)) * (h - padT - padB);

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);
  const single = series.length === 1;

  /** Map a pointer position onto the nearest data index. */
  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((clientX - rect.left) / rect.width) * w;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      const distance = Math.abs(x(i) - svgX);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    }
    setHover(nearest);
  };

  const hoveredValues = hover === null ? [] : series.map((s) => ({ name: s.name, value: s.values[hover], tone: s.tone }));
  const hasHoverData = hoveredValues.some((v) => v.value !== null);

  // Keep the tooltip inside the chart rather than letting it hang off an edge.
  const tooltipLeft = hover === null ? 0 : Math.min(Math.max((x(hover) / w) * 100, 12), 88);

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={ariaLabel ?? `${series.map((s) => s.name).join(', ')} over time`}
        className="chart"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE_VAR[series[0]?.tone ?? 'accent']} stopOpacity="0.22" />
            <stop offset="100%" stopColor={TONE_VAR[series[0]?.tone ?? 'accent']} stopOpacity="0" />
          </linearGradient>
        </defs>

        {tickValues.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-faint)">
              {Math.round(t)}
            </text>
          </g>
        ))}

        {target !== undefined && (
          <g>
            <line
              x1={padL}
              x2={w - padR}
              y1={y(target)}
              y2={y(target)}
              stroke="var(--ok)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <text x={w - padR} y={y(target) - 6} textAnchor="end" fontSize="10" fill="var(--ok)" fontWeight="600">
              target {target}
            </text>
          </g>
        )}

        {series.map((s) => {
          const stroke = TONE_VAR[s.tone ?? 'accent'];
          const pts = s.values
            .map((v, i) => (v === null ? null : ([x(i), y(v)] as [number, number])))
            .filter((p): p is [number, number] => p !== null);
          if (pts.length === 0) return null;
          const path = smoothPath(pts);

          return (
            <g key={s.name}>
              {single && pts.length > 1 && (
                <path
                  d={`${path} L${pts[pts.length - 1][0]},${h - padB} L${pts[0][0]},${h - padB} Z`}
                  fill={`url(#${gradientId})`}
                />
              )}
              {pts.length > 1 && (
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '4 4' : undefined}
                />
              )}
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(v)}
                    r={hover === i ? 5 : pts.length > 14 ? 0 : 3.2}
                    fill="var(--surface)"
                    stroke={stroke}
                    strokeWidth="2"
                    className="chart-dot"
                  />
                ),
              )}
            </g>
          );
        })}

        {hover !== null && hasHoverData && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT}
            y2={h - padB}
            stroke="var(--border-strong)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {labels.map((label, i) =>
          n <= 9 || i % Math.ceil(n / 9) === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={h - 9}
              textAnchor="middle"
              fontSize="10"
              fill={hover === i ? 'var(--text)' : 'var(--text-faint)'}
              fontWeight={hover === i ? 600 : 400}
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && hasHoverData && (
        <div className="chart-tip" style={{ left: `${tooltipLeft}%` }} role="status">
          <div className="chart-tip-label">{labels[hover]}</div>
          {hoveredValues
            .filter((v) => v.value !== null)
            .map((v) => (
              <div key={v.name} className="chart-tip-row">
                <span className="chart-tip-swatch" style={{ background: TONE_VAR[v.tone ?? 'accent'] }} />
                <span className="chart-tip-name">{v.name}</span>
                <span className="chart-tip-value">
                  {v.value}
                  {unit}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function BarPairChart({
  labels,
  a,
  b,
  aLabel,
  bLabel,
  height = 200,
  unit = '',
}: {
  labels: string[];
  a: number[];
  b: number[];
  aLabel: string;
  bLabel: string;
  height?: number;
  unit?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const w = 720;
  const h = height;
  const padL = 38;
  const padB = 30;
  const padT = 14;
  const max = Math.max(1, ...a, ...b);
  const groupW = (w - padL - 14) / Math.max(1, labels.length);
  const barW = Math.min(20, (groupW - 10) / 2);
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);

  const onMove = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((clientX - rect.left) / rect.width) * w;
    const index = Math.floor((svgX - padL) / groupW);
    setHover(index >= 0 && index < labels.length ? index : null);
  };

  const tooltipLeft =
    hover === null ? 0 : Math.min(Math.max(((padL + hover * groupW + groupW / 2) / w) * 100, 12), 88);

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        role="img"
        aria-label={`${aLabel} against ${bLabel} by week`}
        className="chart"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={padL} x2={w - 14} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={padL - 8} y={y(max) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
          {Math.round(max)}
          {unit}
        </text>

        {labels.map((label, i) => {
          const gx = padL + i * groupW + groupW / 2;
          const active = hover === i;
          return (
            <g key={i} opacity={hover === null || active ? 1 : 0.45} className="chart-bar-group">
              <rect
                x={gx - barW - 2}
                y={y(a[i] ?? 0)}
                width={barW}
                height={Math.max(0, y(0) - y(a[i] ?? 0))}
                fill="var(--surface-3)"
                stroke="var(--border-strong)"
                strokeWidth="1"
                rx="4"
              />
              <rect
                x={gx + 2}
                y={y(b[i] ?? 0)}
                width={barW}
                height={Math.max(0, y(0) - y(b[i] ?? 0))}
                fill="var(--accent)"
                rx="4"
              />
              <text
                x={gx}
                y={h - 9}
                textAnchor="middle"
                fontSize="10"
                fill={active ? 'var(--text)' : 'var(--text-faint)'}
                fontWeight={active ? 600 : 400}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div className="chart-tip" style={{ left: `${tooltipLeft}%` }} role="status">
          <div className="chart-tip-label">{labels[hover]}</div>
          <div className="chart-tip-row">
            <span className="chart-tip-swatch" style={{ background: 'var(--surface-3)', borderColor: 'var(--border-strong)' }} />
            <span className="chart-tip-name">{aLabel}</span>
            <span className="chart-tip-value">
              {a[hover]}
              {unit}
            </span>
          </div>
          <div className="chart-tip-row">
            <span className="chart-tip-swatch" style={{ background: 'var(--accent)' }} />
            <span className="chart-tip-name">{bLabel}</span>
            <span className="chart-tip-value">
              {b[hover]}
              {unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; tone: string }[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span key={i.label} className="chart-legend-item">
          <span aria-hidden="true" className="chart-legend-swatch" style={{ background: TONE_VAR[i.tone] ?? i.tone }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function HBarList({
  items,
  max,
  suffix = '',
}: {
  items: { label: string; value: number; caption?: string; tone?: 'accent' | 'ok' | 'warn' | 'risk' }[];
  max?: number;
  suffix?: string;
}) {
  const peak = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stack">
      {items.map((item) => (
        <div key={item.label} className="hbar">
          <div className="row-between tiny">
            <span>{item.label}</span>
            <span className="mono">
              {item.value}
              {suffix}
              {item.caption ? ` · ${item.caption}` : ''}
            </span>
          </div>
          <div className="meter" style={{ marginTop: 4 }} role="img" aria-label={`${item.label}: ${item.value}${suffix}`}>
            <span
              style={{
                width: `${Math.min(100, (item.value / peak) * 100)}%`,
                background: TONE_VAR[item.tone ?? 'accent'],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
