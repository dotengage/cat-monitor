import { SECTIONS } from '../config/catConfig';
import type { SectionKey } from '../domain/types';
import type { Token } from './ocr';

/**
 * Turning recognised text into a result table.
 *
 * The recogniser is allowed to be wrong about individual characters, because
 * nothing here compares its output to an exact string. Headings and row labels
 * are matched against a short list of words they could possibly be, so
 * "Attemptod" still lands on "attempted"; numbers are read by a digits-only
 * pass that cannot produce a letter at all. What remains is geometry: which
 * column a number sits under, and which row it sits in.
 *
 * Pure. Tokens in, a draft out - no canvas, no DOM.
 */

export type ColumnKind = 'attempts' | 'correct' | 'incorrect' | 'skipped' | 'score' | 'percentile' | 'time';
export type RowKind = SectionKey | 'OVERALL';

export interface SectionReading {
  attempts?: number;
  correct?: number;
  incorrect?: number;
  skipped?: number;
  score?: number;
  percentile?: number;
}

export interface ScoreTable {
  sections: Partial<Record<SectionKey, SectionReading>>;
  overall: SectionReading;
  /** Columns that were recognised, in the order they appear. */
  columns: ColumnKind[];
  /** Rows that were recognised. */
  rows: RowKind[];
  /** Mean confidence of the glyphs that produced the numbers, 0-1. */
  confidence: number;
  /** Arithmetic that did not hold - a number worth looking at twice. */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Fuzzy vocabulary matching                                           */
/* ------------------------------------------------------------------ */

const COLUMN_WORDS: Record<ColumnKind, string[]> = {
  attempts: ['attempted', 'attempt', 'attempts', 'answered', 'questionsattempted'],
  correct: ['correct', 'right'],
  incorrect: ['incorrect', 'wrong', 'negative'],
  skipped: ['skipped', 'unattempted', 'notattempted', 'left', 'omitted'],
  score: ['score', 'marks', 'scoreobtained', 'marksobtained', 'netscore', 'total'],
  percentile: ['percentile', 'ptile', 'percentiles'],
  time: ['time', 'timetaken', 'duration'],
};

const ROW_WORDS: Record<RowKind, string[]> = {
  VARC: ['verbal', 'varc', 'reading', 'comprehension', 'verbalability', 'va', 'vrc'],
  DILR: ['data', 'interpretation', 'dilr', 'lrdi', 'logical', 'reasoning', 'di', 'lr'],
  QA: ['quantitative', 'quant', 'qa', 'quants', 'quantitativeability'],
  OVERALL: ['overall', 'total', 'aggregate', 'grandtotal'],
};

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, '');
}

/** Levenshtein distance, iterative with a single row of state. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 for identical, falling to 0 as the strings diverge. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Best vocabulary entry for a piece of text.
 *
 * A heading is one word, so it is compared whole. A row label is a phrase
 * whose words we only partly know - "Data Interpretation & Logical Reasoning"
 * against the keyword "logical" - so each word is also tried on its own and
 * the best result wins.
 */
function bestMatch<K extends string>(text: string, vocabulary: Record<K, string[]>, floor: number): K | null {
  const whole = normalise(text);
  if (whole.length < 2) return null;
  const words = text.split(/\s+/).map(normalise).filter((w) => w.length >= 2);

  let best: K | null = null;
  let bestScore = floor;

  for (const key of Object.keys(vocabulary) as K[]) {
    for (const candidate of vocabulary[key]) {
      const scores = [similarity(whole, candidate), ...words.map((w) => similarity(w, candidate))];
      const score = Math.max(...scores);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
  }
  return best;
}

/*
 * Headings tolerate more damage than row labels do.
 *
 * There are only seven of them and they look nothing like each other, so a
 * loose threshold cannot confuse one for another - whereas "Score" really does
 * come back as "ROre" from a bold screenshot, and at a stricter floor the
 * whole score column would be silently dropped.
 */
export const matchColumn = (text: string): ColumnKind | null => bestMatch(text, COLUMN_WORDS, 0.55);
export const matchRow = (text: string): RowKind | null => bestMatch(text, ROW_WORDS, 0.62);

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * A number, or nothing.
 *
 * Deliberately strict: a digits-only reading of a cell that was never numeric
 * still produces digits, and letting that through would silently fill a field
 * with nonsense. Anything that is not cleanly a number is dropped, and the
 * field is simply left for you to type.
 */
export function parseNumber(text: string): number | undefined {
  const cleaned = text.replace(/\s+/g, '').replace(/[,']/g, '');
  if (!/^-?\d{1,4}(\.\d{1,3})?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

const centre = (token: { x: number; w: number }) => token.x + token.w / 2;

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

interface HeaderColumn {
  kind: ColumnKind;
  centre: number;
}

/**
 * The heading row is whichever line names the most columns.
 *
 * Searching rather than assuming the first line, because a screenshot usually
 * includes a title, a tab bar or a stray caption above the table itself.
 */
function findHeader(lines: Token[][]): { index: number; columns: HeaderColumn[] } | null {
  let best: { index: number; columns: HeaderColumn[] } | null = null;

  lines.forEach((line, index) => {
    const columns: HeaderColumn[] = [];
    for (const token of line) {
      const kind = matchColumn(token.text);
      // One column cannot be two things; the leftmost naming wins.
      if (kind && !columns.some((c) => c.kind === kind)) columns.push({ kind, centre: centre(token) });
    }
    if (columns.length >= 2 && (!best || columns.length > best.columns.length)) {
      best = { index, columns };
    }
  });

  return best;
}

/** The column whose heading sits nearest this number, if any is near enough. */
function columnFor(token: Token, columns: HeaderColumn[], tolerance: number): ColumnKind | null {
  let best: ColumnKind | null = null;
  let bestDistance = tolerance;
  for (const column of columns) {
    const distance = Math.abs(centre(token) - column.centre);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = column.kind;
    }
  }
  return best;
}

interface RowReading {
  label: string;
  row: RowKind | null;
  reading: SectionReading;
}

/** The columns that hold a number we keep. `time` is recognised only so a
 * time column cannot be mistaken for a score one. */
type NumericColumn = Exclude<ColumnKind, 'time' | 'percentile'> | 'percentile';
const NUMERIC_COLUMNS: NumericColumn[] = ['attempts', 'correct', 'incorrect', 'skipped', 'score'];

/**
 * Finds the total row by arithmetic when its label cannot be read.
 *
 * "Overall" comes back from a bold screenshot as things like "-eraIl", which
 * no amount of fuzzy matching should be stretched far enough to accept - the
 * threshold that let that through would let real mistakes through too. But a
 * total row is identifiable without reading it at all: its numbers are the
 * column sums of the rows above. That test is independent of the font, the
 * language and the provider.
 */
function sumsOf(sections: Partial<Record<SectionKey, SectionReading>>): Partial<Record<NumericColumn, number>> {
  const sums: Partial<Record<NumericColumn, number>> = {};
  for (const column of NUMERIC_COLUMNS) {
    const values = SECTIONS.map((s) => sections[s]?.[column]).filter((v): v is number => typeof v === 'number');
    if (values.length === SECTIONS.length) sums[column] = values.reduce((a, b) => a + b, 0);
  }
  return sums;
}

function agreementWithSums(
  reading: SectionReading,
  sums: Partial<Record<NumericColumn, number>>,
): { comparable: number; matching: number } {
  let comparable = 0;
  let matching = 0;
  for (const column of NUMERIC_COLUMNS) {
    const expected = sums[column];
    const actual = reading[column];
    if (typeof expected !== 'number' || typeof actual !== 'number') continue;
    comparable += 1;
    if (Math.abs(expected - actual) < 0.001) matching += 1;
  }
  return { comparable, matching };
}

export function buildScoreTable(lines: Token[][], numericLines: Token[][]): ScoreTable | null {
  const header = findHeader(lines);
  if (!header) return null;

  const spacing = columnSpacing(header.columns);
  const labelLimit = Math.min(...header.columns.map((c) => c.centre)) - spacing / 2;
  const readings: RowReading[] = [];
  const scores: number[] = [];

  for (let i = header.index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const numericLine = numericLines[i] ?? [];

    const label = line
      .filter((t) => centre(t) < labelLimit)
      .map((t) => t.text)
      .join(' ')
      .trim();

    const reading: SectionReading = {};
    line.forEach((token, index) => {
      if (centre(token) < labelLimit) return;
      const column = columnFor(token, header.columns, spacing * 0.5);
      if (!column || column === 'time') return;

      // Read this cell from the digits-only pass, matched by position.
      const numeric = numericLine[index];
      const value = parseNumber(numeric?.text ?? token.text);
      if (value === undefined) return;

      reading[column] = value;
      if (numeric) scores.push(numeric.confidence);
    });

    if (Object.keys(reading).length === 0) continue;
    readings.push({ label, row: matchRow(label), reading });
  }

  const sections: Partial<Record<SectionKey, SectionReading>> = {};
  for (const entry of readings) {
    if (entry.row && entry.row !== 'OVERALL' && !sections[entry.row]) sections[entry.row] = entry.reading;
  }

  const sums = sumsOf(sections);
  const warnings: string[] = [];
  let overall: SectionReading = {};
  let overallFound = false;

  for (const entry of readings) {
    if (sections[entry.row as SectionKey] === entry.reading) continue;
    if (overallFound) continue;

    const { comparable, matching } = agreementWithSums(entry.reading, sums);
    const addsUp = comparable >= 2 && matching / comparable >= 0.6;
    if (entry.row !== 'OVERALL' && !addsUp) continue;

    overall = entry.reading;
    overallFound = true;

    for (const column of NUMERIC_COLUMNS) {
      const expected = sums[column];
      const actual = entry.reading[column];
      if (typeof expected !== 'number' || typeof actual !== 'number') continue;
      if (Math.abs(expected - actual) >= 0.001) {
        warnings.push(`The ${column} column reads ${actual} overall but the sections add up to ${expected}.`);
      }
    }
  }

  const rows: RowKind[] = [...(Object.keys(sections) as SectionKey[])];
  if (overallFound) rows.push('OVERALL');
  if (rows.length === 0) return null;

  return {
    sections,
    overall,
    columns: header.columns.map((c) => c.kind),
    rows,
    confidence: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    warnings,
  };
}

/** Typical distance between column centres, used as the matching tolerance. */
function columnSpacing(columns: HeaderColumn[]): number {
  if (columns.length < 2) return 80;
  const sorted = [...columns].sort((a, b) => a.centre - b.centre);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i].centre - sorted[i - 1].centre);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/** A plain summary of what was found, shown before anything is filled in. */
export function describeTable(table: ScoreTable): string {
  const named = table.rows
    .filter((r): r is SectionKey => (SECTIONS as string[]).includes(r))
    .length;
  const parts = [`${named} section${named === 1 ? '' : 's'}`];
  if (table.rows.includes('OVERALL')) parts.push('an overall row');
  return `Found ${parts.join(' and ')}. Check every number before saving.`;
}
