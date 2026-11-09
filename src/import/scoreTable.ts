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
 * Portals lay their results out differently, and this reads all of the
 * layouts they actually use:
 *
 * - sections down the side and measures across the top, the usual table;
 * - the same table turned round, sections across the top;
 * - headings that wrap onto two lines ("No. of / Correct"), and row labels
 *   that wrap onto three;
 * - stand-alone figures outside any table, like "Percentile 92.4" on a card.
 *
 * Pure. Tokens in, a draft out - no canvas, no DOM.
 */

export type ColumnKind =
  | 'attempts'
  | 'correct'
  | 'incorrect'
  | 'skipped'
  | 'score'
  | 'percentile'
  | 'time'
  | 'questions'
  | 'accuracy'
  | 'rank';
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
  /** Measures that were recognised, in the order they appear. */
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
  attempts: ['attempted', 'attempt', 'attempts', 'answered', 'questionsattempted', 'noofattempts', 'totalattempts'],
  correct: ['correct', 'right', 'noofcorrect', 'correctanswers', 'correctquestions'],
  incorrect: ['incorrect', 'wrong', 'noofincorrect', 'incorrectanswers', 'wronganswers'],
  skipped: ['skipped', 'unattempted', 'notattempted', 'left', 'omitted', 'notanswered'],
  score: ['score', 'marks', 'scoreobtained', 'marksobtained', 'netscore', 'total', 'yourscore', 'netmarks', 'net'],
  percentile: ['percentile', 'ptile', 'percentiles', 'pctile', 'ile', 'yourpercentile'],
  // Recognised only so their numbers cannot be mistaken for a neighbour's.
  time: ['time', 'timetaken', 'duration', 'timespent'],
  questions: ['questions', 'totalquestions', 'noofquestions'],
  accuracy: ['accuracy'],
  rank: ['rank', 'overallrank'],
};

const ROW_WORDS: Record<RowKind, string[]> = {
  VARC: ['verbal', 'varc', 'reading', 'comprehension', 'verbalability', 'va', 'vrc'],
  DILR: ['data', 'interpretation', 'dilr', 'lrdi', 'logical', 'reasoning', 'di', 'lr'],
  QA: ['quantitative', 'quant', 'qa', 'quants', 'quantitativeability'],
  OVERALL: ['overall', 'total', 'aggregate', 'grandtotal'],
};

/** Columns read for a number we keep; the rest only stop numbers drifting. */
const KEPT: ColumnKind[] = ['attempts', 'correct', 'incorrect', 'skipped', 'score', 'percentile'];
type Kept = 'attempts' | 'correct' | 'incorrect' | 'skipped' | 'score' | 'percentile';
const isKept = (kind: ColumnKind): kind is Kept => (KEPT as string[]).includes(kind);

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
 * A heading is compared whole, and a row label - a phrase whose words we only
 * partly know - also word by word, with the best result winning. The whole
 * text wins a tie, which is what keeps "Not Attempted" on skipped rather than
 * on attempts, and "Total Questions" off the score column.
 */
function bestMatch<K extends string>(text: string, vocabulary: Record<K, string[]>, floor: number): { key: K; score: number } | null {
  const whole = normalise(text);
  if (whole.length < 2) return null;
  const words = text.split(/\s+/).map(normalise).filter((w) => w.length >= 2);

  let best: { key: K; score: number } | null = null;
  for (const key of Object.keys(vocabulary) as K[]) {
    for (const candidate of vocabulary[key]) {
      const score = Math.max(similarity(whole, candidate) + 0.02, ...words.map((w) => similarity(w, candidate)));
      if (score > floor && (!best || score > best.score)) best = { key, score };
    }
  }
  return best;
}

/*
 * Headings tolerate more damage than row labels do.
 *
 * They look nothing like each other, so a loose threshold cannot confuse one
 * for another - whereas "Score" really does come back as "ROre" from a bold
 * screenshot, and at a stricter floor the whole score column would be
 * silently dropped.
 */
/**
 * The heading over the row labels - "Section", "Subject" - is matched too, so
 * that it can be recognised for what it is. Left out, "Section" is near enough
 * to "Questions" to be taken for a column of figures.
 */
const LABEL_WORDS = ['section', 'sections', 'subject', 'subjects', 'sectionname', 'groupsection', 'area'];

export const matchColumn = (text: string): ColumnKind | null => {
  const found = bestMatch(text, { ...COLUMN_WORDS, label: LABEL_WORDS } as Record<ColumnKind | 'label', string[]>, 0.55);
  return found && found.key !== 'label' ? found.key : null;
};
export const matchRow = (text: string): RowKind | null => bestMatch(text, ROW_WORDS, 0.62)?.key ?? null;

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

/**
 * The number in a cell, read from the digits-only pass.
 *
 * The full pass is consulted for one thing: a unit stuck to the number, as in
 * "92.47%" or "92.47 %ile". The digits-only pass cannot read a % sign, so it
 * reads it as another digit; knowing from the full pass that the cell ends in
 * a unit, those trailing glyphs are dropped before the number is parsed.
 */
export function cellNumber(full: string, numeric: string | undefined): number | undefined {
  if (!looksNumeric(full.replace(/\s*(%\s*ile|%|ile|marks)$/i, ''))) return undefined;
  let digits = numeric ?? full;
  const unit = full.match(/\s*(%\s*ile|%|ile|marks)$/i);
  if (unit && digits.length === full.length) digits = digits.slice(0, digits.length - unit[0].length);
  return parseNumber(digits);
}

/** Letters the full pass reads for digits often enough not to count against a cell. */
const DIGIT_LIKE = /[0-9.,\-%oOQDlIi|!tjzZsSBgqbGTA]/;

/**
 * Whether a cell's full reading could be a number at all.
 *
 * The digits-only pass reads anything as digits: the tail of a label ("le"
 * from "Percentile" becomes "80"), "NA", a dash in an empty cell. The full
 * pass is the check. A digit is often misread as a letter that resembles it -
 * o for 0, s for 5 - but a cell at least half made of letters that resemble
 * no digit was never a number.
 */
export function looksNumeric(full: string): boolean {
  const chars = full.replace(/\s+/g, '');
  if (chars.length === 0) return false;
  const alien = [...chars].filter((c) => !DIGIT_LIKE.test(c)).length;
  return alien * 2 < chars.length;
}

/** A percentile is never above 100; anything that reads higher was misread. */
function plausible(kind: Kept, value: number): boolean {
  if (kind === 'percentile') return value >= 0 && value <= 100;
  if (kind === 'score') return value >= -100 && value <= 400;
  return value >= 0 && value <= 200;
}

const centre = (token: { x: number; w: number }) => token.x + token.w / 2;
const hasNumber = (line: Token[]) => line.some((t) => parseNumber(t.text) !== undefined);

/* ------------------------------------------------------------------ */
/* Headers, including ones that wrap                                   */
/* ------------------------------------------------------------------ */

interface HeaderCell<K> {
  kind: K;
  centre: number;
}

interface Header<K> {
  /** First and last line of the header; data starts after `end`. */
  start: number;
  end: number;
  cells: HeaderCell<K>[];
}

/**
 * Joins the pieces of headings that wrap: "No. of" on one line and "Correct"
 * under it become one heading, "No. of Correct".
 *
 * Pieces join when they sit in the same column, overlapping horizontally. A
 * piece that spans two or more pieces of another line is a title over several
 * columns, not part of any one heading, and is left out.
 */
function stackHeadings(window: Token[][]): Token[] {
  const tokens = window.flatMap((line, row) => line.map((t) => ({ t, row })));
  const overlaps = (a: Token, b: Token) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > Math.min(a.w, b.w) * 0.3;

  const spanning = new Set(
    tokens
      .filter(({ t, row }) => window.some((line, r) => r !== row && line.filter((o) => overlaps(t, o)).length >= 2))
      .map(({ t }) => t),
  );

  const parent = tokens.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  tokens.forEach((a, i) => {
    tokens.forEach((b, j) => {
      if (j <= i || a.row === b.row || spanning.has(a.t) || spanning.has(b.t)) return;
      if (overlaps(a.t, b.t)) parent[find(i)] = find(j);
    });
  });

  const groups = new Map<number, typeof tokens>();
  tokens.forEach((entry, i) => {
    if (spanning.has(entry.t)) return;
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), entry]);
  });

  return [...groups.values()].map((group) => {
    const parts = [...group].sort((a, b) => a.row - b.row || a.t.x - b.t.x).map((g) => g.t);
    const x = Math.min(...parts.map((p) => p.x));
    const y = Math.min(...parts.map((p) => p.y));
    return {
      text: parts.map((p) => p.text).join(' '),
      x,
      y,
      w: Math.max(...parts.map((p) => p.x + p.w)) - x,
      h: Math.max(...parts.map((p) => p.y + p.h)) - y,
      confidence: Math.min(...parts.map((p) => p.confidence)),
      glyphs: parts.flatMap((p) => p.glyphs),
    };
  });
}

/**
 * The header is whichever line - or run of up to three lines - names the most
 * columns. Searched for rather than assumed to be the first line, because a
 * screenshot usually includes a title, a tab bar or a caption above the table.
 */
function findHeader<K extends string>(lines: Token[][], match: (text: string) => K | null): Header<K> | null {
  let best: (Header<K> & { rank: number }) | null = null;

  for (let start = 0; start < lines.length; start += 1) {
    for (let span = 1; span <= 3 && start + span <= lines.length; span += 1) {
      const window = lines.slice(start, start + span);
      // A heading that wraps never wraps onto a line of figures.
      if (span > 1 && hasNumber(window[span - 1])) break;
      if (span > 1) {
        const above = window[span - 2];
        const below = window[span - 1];
        const height = Math.max(...above.map((t) => t.h));
        const gap = Math.min(...below.map((t) => t.y)) - Math.max(...above.map((t) => t.y + t.h));
        if (gap > height * 1.6) break;
      }

      const cells: HeaderCell<K>[] = [];
      for (const token of span === 1 ? window[0] : stackHeadings(window)) {
        const kind = match(token.text);
        // One column cannot be two things; the leftmost naming wins.
        if (kind && !cells.some((c) => c.kind === kind)) cells.push({ kind, centre: centre(token) });
      }
      // A header names columns; it does not hold their figures. A line that
      // does - "Your Score 77, Your Percentile 94.36" on a card - is a
      // weaker candidate than a true header row naming as many columns.
      const rank = cells.length - (hasNumber(window[0]) ? 1 : 0);
      if (cells.length >= 2 && (!best || rank > best.rank)) best = { start, end: start + span - 1, cells, rank };
    }
  }
  if (best) best.cells.sort((a, b) => a.centre - b.centre);
  return best;
}

/** Typical distance between column centres, used as the matching tolerance. */
function spacingOf(cells: HeaderCell<string>[]): number {
  if (cells.length < 2) return 80;
  const sorted = [...cells].sort((a, b) => a.centre - b.centre);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i].centre - sorted[i - 1].centre);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** The header cell nearest this token, if any is near enough. */
function cellFor<K>(token: Token, cells: HeaderCell<K>[], tolerance: number): K | null {
  let best: K | null = null;
  let bestDistance = tolerance;
  for (const cell of cells) {
    const distance = Math.abs(centre(token) - cell.centre);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell.kind;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Sections down the side                                              */
/* ------------------------------------------------------------------ */

interface RowReading {
  row: RowKind | null;
  reading: SectionReading;
  line: number;
}

interface Reading {
  sections: Partial<Record<SectionKey, SectionReading>>;
  overall: SectionReading;
  overallFound: boolean;
  columns: ColumnKind[];
  /** The lines the table occupies, so stand-alone figures are looked for elsewhere. */
  first: number;
  last: number;
  confidences: number[];
}

/**
 * The label of a data row, including the lines a long label wraps onto.
 *
 * "Verbal Ability & / Reading / Comprehension" puts its figures beside one
 * of its three lines. The line with the figures is tried alone first, then
 * joined with the figure-less lines around it.
 */
function rowLabel(lines: Token[][], index: number, limit: number, isData: (i: number) => boolean): RowKind | null {
  const labelOf = (i: number) =>
    lines[i]
      .filter((t) => centre(t) < limit)
      .map((t) => t.text)
      .join(' ')
      .trim();

  const own = labelOf(index);
  const direct = matchRow(own);
  if (direct) return direct;

  const before: string[] = [];
  for (let i = index - 1; i >= 0 && !isData(i) && before.length < 3; i -= 1) before.unshift(labelOf(i));
  const after: string[] = [];
  for (let i = index + 1; i < lines.length && !isData(i) && after.length < 3; i += 1) after.push(labelOf(i));

  return matchRow([own, ...after].join(' ')) ?? matchRow([...before, own].join(' ')) ?? null;
}

function readSectionRows(lines: Token[][], numericLines: Token[][]): Reading | null {
  const header = findHeader(lines, matchColumn);
  if (!header) return null;

  const spacing = spacingOf(header.cells);
  const limit = Math.min(...header.cells.map((c) => c.centre)) - spacing / 2;
  const confidences: number[] = [];
  const values = new Map<number, SectionReading>();

  for (let i = header.end + 1; i < lines.length; i += 1) {
    const reading: SectionReading = {};
    lines[i].forEach((token, index) => {
      if (centre(token) < limit) return;
      const kind = cellFor(token, header.cells, spacing * 0.55);
      if (!kind || !isKept(kind) || reading[kind] !== undefined) return;
      const numeric = numericLines[i]?.[index];
      const value = cellNumber(token.text, numeric?.text);
      if (value === undefined || !plausible(kind, value)) return;
      reading[kind] = value;
      if (numeric) confidences.push(numeric.confidence);
    });
    if (Object.keys(reading).length > 0) values.set(i, reading);
  }
  if (values.size === 0) return null;

  const readings: RowReading[] = [...values.entries()].map(([line, reading]) => ({
    line,
    reading,
    row: rowLabel(lines, line, limit, (i) => values.has(i)),
  }));

  const result = settle(readings);
  return {
    ...result,
    columns: header.cells.map((c) => c.kind),
    first: header.start,
    last: Math.max(...values.keys()),
    confidences,
  };
}

/* ------------------------------------------------------------------ */
/* The total row                                                       */
/* ------------------------------------------------------------------ */

function sumsOf(sections: Partial<Record<SectionKey, SectionReading>>): Partial<Record<Kept, number>> {
  const sums: Partial<Record<Kept, number>> = {};
  for (const column of KEPT.filter(isKept)) {
    if (column === 'percentile') continue;
    const values = SECTIONS.map((s) => sections[s]?.[column]).filter((v): v is number => typeof v === 'number');
    if (values.length === SECTIONS.length) sums[column] = values.reduce((a, b) => a + b, 0);
  }
  return sums;
}

/**
 * Sorts readings into sections and a total.
 *
 * "Overall" comes back from a bold screenshot as things like "-eraIl", which
 * no amount of fuzzy matching should be stretched to accept. But a total row
 * is identifiable without reading it at all: its numbers are the column sums
 * of the rows above. That test is independent of the font and the provider.
 */
function settle(readings: RowReading[]): Pick<Reading, 'sections' | 'overall' | 'overallFound'> {
  const sections: Partial<Record<SectionKey, SectionReading>> = {};
  for (const entry of readings) {
    if (entry.row && entry.row !== 'OVERALL' && !sections[entry.row]) sections[entry.row] = entry.reading;
  }

  const sums = sumsOf(sections);
  const leftovers = readings.filter((entry) => !Object.values(sections).includes(entry.reading));

  const labelled = leftovers.find((entry) => entry.row === 'OVERALL');
  const addsUp = leftovers.find((entry) => {
    let comparable = 0;
    let matching = 0;
    for (const [column, expected] of Object.entries(sums) as [Kept, number][]) {
      const actual = entry.reading[column];
      if (typeof actual !== 'number') continue;
      comparable += 1;
      if (Math.abs(expected - actual) < 0.001) matching += 1;
    }
    return comparable >= 2 && matching / comparable >= 0.6;
  });
  // With no sections at all - a summary card with one row of figures - the
  // only row there is is the total.
  const lone = Object.keys(sections).length === 0 && leftovers.length === 1 && !leftovers[0].row ? leftovers[0] : undefined;

  const total = labelled ?? addsUp ?? lone;

  // A section whose label could not be read - "QA" fused into one blob in a
  // small font - is the one row left over once the others and the total are
  // placed. Taken only when the arithmetic agrees, or there is none to check.
  const missing = SECTIONS.filter((s) => !sections[s]);
  const unplaced = leftovers.filter((entry) => entry !== total && !entry.row);
  if (missing.length === 1 && unplaced.length === 1) {
    const candidate = { ...sections, [missing[0]]: unplaced[0].reading };
    const checks = (Object.entries(sumsOf(candidate)) as [Kept, number][]).filter(([c]) => typeof total?.reading[c] === 'number');
    const agree = checks.filter(([c, expected]) => Math.abs((total!.reading[c] as number) - expected) < 0.001).length;
    if (checks.length === 0 || agree / checks.length >= 0.6) sections[missing[0]] = unplaced[0].reading;
  }

  return { sections, overall: total?.reading ?? {}, overallFound: Boolean(total) };
}

/* ------------------------------------------------------------------ */
/* Sections across the top                                             */
/* ------------------------------------------------------------------ */

/**
 * The same table turned round: VARC, DILR, QA and Total across the top, and
 * Score, Percentile and the rest down the side.
 */
function readSectionColumns(lines: Token[][], numericLines: Token[][]): Reading | null {
  const header = findHeader(lines, matchRow);
  if (!header) return null;

  const spacing = spacingOf(header.cells);
  const limit = Math.min(...header.cells.map((c) => c.centre)) - spacing / 2;
  const sections: Partial<Record<SectionKey, SectionReading>> = {};
  const overall: SectionReading = {};
  const columns: ColumnKind[] = [];
  const confidences: number[] = [];
  let last = -1;

  for (let i = header.end + 1; i < lines.length; i += 1) {
    const label = lines[i]
      .filter((t) => centre(t) < limit)
      .map((t) => t.text)
      .join(' ');
    const kind = matchColumn(label);
    if (!kind || !isKept(kind)) continue;

    lines[i].forEach((token, index) => {
      if (centre(token) < limit) return;
      const row = cellFor(token, header.cells, spacing * 0.55);
      if (!row) return;
      const numeric = numericLines[i]?.[index];
      const value = cellNumber(token.text, numeric?.text);
      if (value === undefined || !plausible(kind, value)) return;
      const target = row === 'OVERALL' ? overall : (sections[row] ??= {});
      if (target[kind] !== undefined) return;
      target[kind] = value;
      if (!columns.includes(kind)) columns.push(kind);
      if (numeric) confidences.push(numeric.confidence);
      last = i;
    });
  }
  if (last < 0) return null;

  return { sections, overall, overallFound: Object.keys(overall).length > 0, columns, first: header.start, last, confidences };
}

/* ------------------------------------------------------------------ */
/* Stand-alone figures                                                 */
/* ------------------------------------------------------------------ */

/**
 * Figures outside any table: "Percentile 92.4" on a card, "Score: 72", or a
 * label with its figure on the line beneath. A figure on a line that also
 * names a section belongs to that section.
 */
function readLabelledFigures(lines: Token[][], numericLines: Token[][], skip: (line: number) => boolean): Reading {
  const sections: Partial<Record<SectionKey, SectionReading>> = {};
  const overall: SectionReading = {};
  const confidences: number[] = [];

  lines.forEach((line, i) => {
    if (skip(i)) return;
    const owner = line.map((t) => matchRow(t.text)).find((r): r is RowKind => r !== null) ?? 'OVERALL';

    line.forEach((token, j) => {
      const words = token.text.split(' ');
      const digits = (numericLines[i]?.[j]?.text ?? '').split(' ');

      words.forEach((word, w) => {
        const kind = matchColumn(word);
        if (kind !== 'score' && kind !== 'percentile') return;
        // The figure: later in the same cell, then the next cell along, then
        // the cell beneath the label.
        const candidates: { full: string; numeric?: string; confidence: number }[] = [];
        if (digits.length === words.length) {
          for (let k = w + 1; k < words.length; k += 1) candidates.push({ full: words[k], numeric: digits[k], confidence: token.confidence });
        }
        const next = line[j + 1];
        if (next) candidates.push({ full: next.text, numeric: numericLines[i]?.[j + 1]?.text, confidence: next.confidence });
        const belowIndex = (lines[i + 1] ?? []).findIndex((b) => Math.abs(centre(b) - centre(token)) < Math.max(token.w, b.w) * 0.6);
        if (belowIndex >= 0 && !skip(i + 1)) {
          const below = lines[i + 1][belowIndex];
          candidates.push({ full: below.text, numeric: numericLines[i + 1]?.[belowIndex]?.text, confidence: below.confidence });
        }

        const target = owner === 'OVERALL' ? overall : (sections[owner] ??= {});
        if (target[kind] !== undefined) return;
        for (const candidate of candidates) {
          const value = cellNumber(candidate.full, candidate.numeric);
          if (value === undefined || !plausible(kind, value)) continue;
          target[kind] = value;
          confidences.push(candidate.confidence);
          break;
        }
      });
    });
  });

  return { sections, overall, overallFound: Object.keys(overall).length > 0, columns: [], first: -1, last: -1, confidences };
}

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

function cellCount(reading: Reading | null): number {
  if (!reading) return 0;
  const rows = [...Object.values(reading.sections), reading.overall];
  return rows.reduce((n, r) => n + Object.keys(r ?? {}).length, 0);
}

export function buildScoreTable(lines: Token[][], numericLines: Token[][]): ScoreTable | null {
  const down = readSectionRows(lines, numericLines);
  const across = readSectionColumns(lines, numericLines);
  const table = cellCount(across) > cellCount(down) ? across : down;

  // Figures the table did not have - most often the overall percentile, shown
  // on a card above the table rather than in it.
  const loose = readLabelledFigures(lines, numericLines, (i) => Boolean(table && i >= table.first && i <= table.last));

  const sections: Partial<Record<SectionKey, SectionReading>> = { ...(table?.sections ?? {}) };
  for (const s of SECTIONS) {
    const extra = loose.sections[s];
    if (extra) sections[s] = { ...extra, ...(sections[s] ?? {}) };
  }
  const overall: SectionReading = { ...loose.overall, ...(table?.overall ?? {}) };
  const overallFound = Boolean(table?.overallFound) || loose.overallFound;

  const columns = [...(table?.columns ?? [])];
  const confidences = [...(table?.confidences ?? []), ...loose.confidences];
  const confidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return finalise(sections, overallFound ? overall : {}, columns, confidence);
}

/** Rows, warnings and the column list, from settled readings. */
function finalise(
  sections: Partial<Record<SectionKey, SectionReading>>,
  overall: SectionReading,
  known: ColumnKind[],
  confidence: number,
): ScoreTable | null {
  const rows: RowKind[] = SECTIONS.filter((s) => sections[s] && Object.keys(sections[s]!).length > 0);
  if (Object.keys(overall).length > 0) rows.push('OVERALL');
  if (rows.length === 0) return null;

  const warnings: string[] = [];
  const sums = sumsOf(sections);
  for (const [column, expected] of Object.entries(sums) as [Kept, number][]) {
    const actual = overall[column];
    if (typeof actual === 'number' && Math.abs(expected - actual) >= 0.001) {
      warnings.push(`The ${column} column reads ${actual} overall but the sections add up to ${expected}.`);
    }
  }
  for (const [key, reading] of [...Object.entries(sections), ['OVERALL', overall]] as [string, SectionReading][]) {
    const { attempts, correct, incorrect } = reading;
    if (attempts !== undefined && correct !== undefined && incorrect !== undefined && correct + incorrect !== attempts) {
      warnings.push(`${key === 'OVERALL' ? 'Overall' : key}: ${correct} correct and ${incorrect} incorrect do not make ${attempts} attempted.`);
    }
  }

  const columns = [...known];
  for (const kind of KEPT) {
    if (!columns.includes(kind) && [overall, ...Object.values(sections)].some((r) => r?.[kind as Kept] !== undefined)) columns.push(kind);
  }
  return { sections, overall, columns, rows, confidence, warnings };
}

/**
 * One table from several readings of the same image.
 *
 * Each cell takes the value most readings agree on, the best reading breaking
 * ties. Then, where a column does not add up to its total, an alternative
 * some reading saw for one of its cells is tried: if exactly one such
 * substitution makes the column add up, it is the right digit, misread in the
 * others. A small 8 that comes back as 0 at one size is read correctly at
 * another, and the arithmetic says which.
 */
export function combineTables(readings: (ScoreTable | null)[]): ScoreTable | null {
  const tables = readings.filter((t): t is ScoreTable => t !== null);
  if (tables.length === 0) return null;
  const best = tables.reduce((a, b) => (tableQuality(b) > tableQuality(a) ? b : a));
  if (tables.length === 1) return best;

  const keys: RowKind[] = [...SECTIONS, 'OVERALL'];
  const rowOf = (t: ScoreTable, key: RowKind) => (key === 'OVERALL' ? t.overall : t.sections[key]);
  const seen = (key: RowKind, field: Kept) =>
    tables.map((t) => rowOf(t, key)?.[field]).filter((v): v is number => typeof v === 'number');

  const sections: Partial<Record<SectionKey, SectionReading>> = {};
  const overall: SectionReading = {};
  for (const key of keys) {
    for (const field of KEPT.filter(isKept)) {
      const values = seen(key, field);
      if (values.length === 0) continue;
      const count = (v: number) => values.filter((x) => x === v).length;
      const top = Math.max(...values.map(count));
      const leaders = [...new Set(values.filter((v) => count(v) === top))];
      const fromBest = rowOf(best, key)?.[field];
      const value = leaders.length === 1 ? leaders[0] : fromBest !== undefined && leaders.includes(fromBest) ? fromBest : leaders[0];
      const target = key === 'OVERALL' ? overall : (sections[key] ??= {});
      target[field] = value;
    }
  }

  for (const [column, expected] of Object.entries(sumsOf(sections)) as [Kept, number][]) {
    const total = overall[column];
    if (total === undefined || Math.abs(total - expected) < 0.001) continue;
    const fixes: { key: RowKind; value: number }[] = [];
    for (const key of keys) {
      const current = rowOf({ ...best, sections, overall }, key)?.[column];
      if (current === undefined) continue;
      for (const alternative of new Set(seen(key, column))) {
        if (alternative === current) continue;
        const sum = key === 'OVERALL' ? expected : expected - current + alternative;
        const target = key === 'OVERALL' ? alternative : total;
        if (Math.abs(sum - target) < 0.001) fixes.push({ key, value: alternative });
      }
    }
    if (fixes.length === 1) {
      const { key, value } = fixes[0];
      (key === 'OVERALL' ? overall : sections[key]!)[column] = value;
    }
  }

  // A single unread cell in a column whose total and other cells are known is
  // the difference - but only when at least two readings agree on the total,
  // so that one misread total cannot quietly produce a wrong figure.
  for (const column of KEPT.filter(isKept)) {
    if (column === 'percentile') continue;
    const total = overall[column];
    if (total === undefined || seen('OVERALL', column).filter((v) => v === total).length < 2) continue;
    const blank = SECTIONS.filter((key) => sections[key] && sections[key]![column] === undefined);
    const known = SECTIONS.filter((key) => sections[key]?.[column] !== undefined);
    if (blank.length !== 1 || known.length !== SECTIONS.length - 1) continue;
    const value = total - known.reduce((sum, key) => sum + (sections[key]![column] as number), 0);
    if (plausible(column, value)) sections[blank[0]]![column] = value;
  }

  return finalise(sections, overall, best.columns, best.confidence);
}

/**
 * How good a reading is, for choosing between readings of the same image at
 * different sizes: figures found, plus arithmetic that holds, minus
 * arithmetic that does not.
 */
export function tableQuality(table: ScoreTable | null): number {
  if (!table) return -1;
  const rows = [...Object.values(table.sections), table.overall];
  const cells = rows.reduce((n, r) => n + Object.keys(r ?? {}).length, 0);
  const sums = sumsOf(table.sections);
  const agreeing = (Object.entries(sums) as [Kept, number][]).filter(
    ([column, expected]) => typeof table.overall[column] === 'number' && Math.abs(table.overall[column]! - expected) < 0.001,
  ).length;
  return cells + agreeing * 2 - table.warnings.length * 2 + table.confidence;
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/** A plain summary of what was found, shown before anything is filled in. */
export function describeTable(table: ScoreTable): string {
  const named = table.rows.filter((r): r is SectionKey => (SECTIONS as string[]).includes(r)).length;
  const parts: string[] = [];
  if (named > 0) parts.push(`${named} section${named === 1 ? '' : 's'}`);
  if (table.rows.includes('OVERALL')) parts.push(named > 0 ? 'an overall row' : 'overall figures');
  return `Found ${parts.join(' and ')}. Check every number before saving.`;
}
