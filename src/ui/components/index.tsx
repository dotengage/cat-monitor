import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TrackStatus, WorkloadHealth } from '../../domain/types';

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  action,
  children,
  flush,
  id,
  span,
  onOpen,
  openLabel = 'Open',
  accent,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  id?: string;
  /** Columns to occupy inside a `.dash-grid`. Ignored elsewhere. */
  span?: 2 | 3;
  /** Makes the whole card a shortcut to somewhere else. */
  onOpen?: () => void;
  openLabel?: string;
  accent?: boolean;
}) {
  /*
   * A card that opens something is clickable anywhere, but it also contains
   * real controls - task buttons, menus, disclosure triangles. Clicking those
   * must not also navigate, so anything that is already interactive claims
   * the click first. Keyboard users get the explicit Open button instead,
   * which is why the card itself is not focusable.
   */
  const handleClick = onOpen
    ? (e: ReactMouseEvent<HTMLElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, select, textarea, label, summary, [role="menu"]')) return;
        if (window.getSelection()?.toString()) return;
        onOpen();
      }
    : undefined;

  const classes = ['card'];
  if (flush) classes.push('flush');
  if (span) classes.push(`span-${span}`);
  if (accent) classes.push('accent');
  if (onOpen) classes.push('is-openable');

  return (
    <section className={classes.join(' ')} id={id} onClick={handleClick}>
      {(title || action || onOpen) && (
        <div className="card-head">
          <div>
            {typeof title === 'string' ? <h2>{title}</h2> : title}
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          {action ??
            (onOpen && (
              <button type="button" className="card-open" onClick={onOpen}>
                {openLabel}
                <span aria-hidden="true">›</span>
              </button>
            ))}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<TrackStatus, { label: string; cls: string; shape: string }> = {
  ON_TRACK: { label: 'On track', cls: 'status-ok', shape: '' },
  AT_RISK: { label: 'At risk', cls: 'status-warn', shape: 'square' },
  BEHIND: { label: 'Behind', cls: 'status-risk', shape: 'triangle' },
  UNCONFIRMED: { label: 'Insufficient data', cls: 'status-neutral', shape: 'square' },
};

/** Colour is never the only signal: every pill carries a text label and shape. */
export function StatusPill({ status, label }: { status: TrackStatus; label?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status-pill ${meta.cls} ${meta.shape}`}>
      <span className="dot" aria-hidden="true" />
      {label ?? meta.label}
    </span>
  );
}

const HEALTH_META: Record<WorkloadHealth, { label: string; cls: string; shape: string }> = {
  COMFORTABLE: { label: 'Comfortable', cls: 'status-ok', shape: '' },
  TIGHT: { label: 'Tight', cls: 'status-warn', shape: 'square' },
  AT_RISK: { label: 'At risk', cls: 'status-warn', shape: 'square' },
  UNSUSTAINABLE: { label: 'Unsustainable', cls: 'status-risk', shape: 'triangle' },
};

export function HealthPill({ health }: { health: WorkloadHealth }) {
  const meta = HEALTH_META[health];
  return (
    <span className={`status-pill ${meta.cls} ${meta.shape}`}>
      <span className="dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'risk' }) {
  const cls = tone === 'neutral' ? 'status-neutral' : `status-${tone}`;
  return <span className={`status-pill ${cls}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

/** Capacity meter: allocated / buffer / overflow, with an accessible label. */
export function CapacityMeter({
  allocatedMin,
  plannedMin,
  bufferMin,
}: {
  allocatedMin: number;
  plannedMin: number;
  bufferMin: number;
}) {
  const total = Math.max(1, plannedMin + bufferMin);
  const used = Math.min(allocatedMin, plannedMin);
  const over = Math.max(0, allocatedMin - plannedMin);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;
  return (
    <div
      className="meter"
      role="img"
      aria-label={`${Math.round(allocatedMin)} minutes allocated of ${Math.round(plannedMin)} planned, with ${Math.round(bufferMin)} minutes of buffer`}
    >
      <span className="used" style={{ width: pct(used) }} />
      {over > 0 && <span className="over" style={{ width: pct(over) }} />}
      <span className="buffer" style={{ width: pct(bufferMin) }} />
    </div>
  );
}

/** A single-value progress bar for "how far along this goal is". */
export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'ok' | 'warn' | 'risk' }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className={`progress ${tone}`} role="img" aria-label={`${Math.round(pct)} percent of the way there`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function ChoiceGroup<T extends string | number>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className="choice-row">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            className="choice"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    // Stop the page scrolling underneath the sheet.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  /*
   * Rendered into <body> rather than in place.
   *
   * Modals are opened from inside cards, and those cards carry the page's
   * entrance animation. A transformed ancestor becomes the containing block
   * for `position: fixed` descendants, so an in-place modal gets sized and
   * stacked against its card instead of the viewport - which put it behind
   * the following cards. A portal sidesteps ancestor transforms entirely.
   */
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn small subtle" onClick={onClose} aria-label="Close dialog">
            Close
          </button>
        </div>
        {children}
        {footer && <div className="btn-group" style={{ marginTop: 14 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function Callout({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'risk';
  children: ReactNode;
}) {
  return <div className={`callout${tone === 'neutral' ? '' : ` ${tone}`}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Collapse({ title, children, open }: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="collapse" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Overflow menu                                                       */
/* ------------------------------------------------------------------ */

/**
 * Secondary actions, tucked away.
 *
 * A task has six things you can do to it. Showing all six on every card is
 * what made the plan feel like a control panel rather than a plan, so the two
 * you actually use stay visible and the rest live behind this.
 */
export function ActionMenu({
  label = 'More actions',
  items,
}: {
  label?: string;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="btn small subtle menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
