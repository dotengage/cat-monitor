/**
 * Charts are hand-rolled SVG. No charting library: every chart here answers a
 * specific question, and none of them justify a 200KB dependency on a phone.
 */

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

export function TrendChart({
  labels,
  series,
  target,
  height = 180,
  yMin,
  yMax,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  target?: number;
  height?: number;
  yMin?: number;
  yMax?: number;
  ariaLabel?: string;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (target !== undefined) all.push(target);
  const [d0, d1] = niceDomain(all);
  const lo = yMin ?? d0;
  const hi = yMax ?? d1;
  const w = 640;
  const h = height;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const n = Math.max(labels.length, 1);

  const x = (i: number) => padL + (n === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (1 - (v - lo) / Math.max(0.001, hi - lo)) * (h - padT - padB);

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label={ariaLabel ?? `${series.map((s) => s.name).join(', ')} over time`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {tickValues.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
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
          <text x={w - padR} y={y(target) - 5} textAnchor="end" fontSize="10" fill="var(--ok)">
            target {target}
          </text>
        </g>
      )}

      {series.map((s) => {
        const stroke = TONE_VAR[s.tone ?? 'accent'];
        const pts = s.values
          .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
          .filter((p): p is string => p !== null);
        return (
          <g key={s.name}>
            {pts.length > 1 && (
              <polyline
                points={pts.join(' ')}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '4 4' : undefined}
              />
            )}
            {s.values.map((v, i) =>
              v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill={stroke} />,
            )}
          </g>
        );
      })}

      {labels.map((label, i) =>
        n <= 8 || i % Math.ceil(n / 8) === 0 ? (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarPairChart({
  labels,
  a,
  b,
  aLabel,
  bLabel,
  height = 170,
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
  const w = 640;
  const h = height;
  const padL = 34;
  const padB = 24;
  const padT = 10;
  const max = Math.max(1, ...a, ...b);
  const groupW = (w - padL - 10) / Math.max(1, labels.length);
  const barW = Math.min(18, (groupW - 8) / 2);
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      role="img"
      aria-label={`${aLabel} against ${bLabel} by week`}
      style={{ display: 'block' }}
    >
      <line x1={padL} x2={w - 10} y1={y(0)} y2={y(0)} stroke="var(--border)" />
      <text x={padL - 6} y={y(max) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
        {Math.round(max)}
        {unit}
      </text>
      {labels.map((label, i) => {
        const gx = padL + i * groupW + groupW / 2;
        return (
          <g key={i}>
            <rect x={gx - barW - 2} y={y(a[i] ?? 0)} width={barW} height={Math.max(0, y(0) - y(a[i] ?? 0))} fill="var(--neutral)" rx="2" />
            <rect x={gx + 2} y={y(b[i] ?? 0)} width={barW} height={Math.max(0, y(0) - y(b[i] ?? 0))} fill="var(--accent)" rx="2" />
            <text x={gx} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChartLegend({ items }: { items: { label: string; tone: string }[] }) {
  return (
    <div className="row small muted" style={{ marginTop: 6 }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 5 }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 2, background: TONE_VAR[i.tone] ?? i.tone, display: 'inline-block' }}
          />
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
        <div key={item.label}>
          <div className="row-between tiny">
            <span>{item.label}</span>
            <span className="mono">
              {item.value}
              {suffix}
              {item.caption ? ` · ${item.caption}` : ''}
            </span>
          </div>
          <div className="meter" style={{ marginTop: 3 }} role="img" aria-label={`${item.label}: ${item.value}${suffix}`}>
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
