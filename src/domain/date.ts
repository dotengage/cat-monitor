/**
 * Date helpers.
 *
 * Every date in the domain is stored as a local-calendar ISO date string
 * (`YYYY-MM-DD`). We deliberately never use `Date.toISOString()` for these,
 * because that shifts to UTC and silently moves a day for users east/west of
 * Greenwich. All arithmetic happens on local calendar components.
 */

export type ISODate = string;

export const MS_PER_DAY = 86_400_000;

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const da = fromISODate(a).getTime();
  const db = fromISODate(b).getTime();
  return Math.round((db - da) / MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
export function dayOfWeek(s: ISODate): number {
  return fromISODate(s).getDay();
}

export function isWeekend(s: ISODate): boolean {
  const d = dayOfWeek(s);
  return d === 0 || d === 6;
}

/** Start of the week containing `s`. `weekStartsOn` defaults to Monday (1). */
export function startOfWeek(s: ISODate, weekStartsOn = 1): ISODate {
  const dow = dayOfWeek(s);
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

export function endOfWeek(s: ISODate, weekStartsOn = 1): ISODate {
  return addDays(startOfWeek(s, weekStartsOn), 6);
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isBetween(s: ISODate, from: ISODate, to: ISODate): boolean {
  return s >= from && s <= to;
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthName(s: ISODate): string {
  return MONTH_NAMES[fromISODate(s).getMonth()];
}

export function dayName(s: ISODate): string {
  return DAY_NAMES[dayOfWeek(s)];
}

export function shortDayName(s: ISODate): string {
  return DAY_NAMES[dayOfWeek(s)].slice(0, 3);
}

export function formatDate(s: ISODate, opts: { withYear?: boolean } = {}): string {
  const d = fromISODate(s);
  const base = `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
  return opts.withYear ? `${base} ${d.getFullYear()}` : base;
}

export function formatLongDate(s: ISODate): string {
  const d = fromISODate(s);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Human duration from minutes: 95 -> "1h 35m". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

export function formatHours(min: number, digits = 1): string {
  return `${(min / 60).toFixed(digits)}h`;
}

export function weeksBetween(a: ISODate, b: ISODate): number {
  return daysBetween(a, b) / 7;
}
