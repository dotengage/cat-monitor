/**
 * Data hygiene (forecast guide, step 1). Done before any arithmetic.
 *
 * The rule that matters most: a value that was not recorded is missing, not
 * zero. The mock form stores a blank percentile as 0, and a screenshot import
 * never has percentiles at all, so without this step every one of those mocks
 * would drag the average percentile towards zero and invent a collapse that
 * never happened.
 */
import { SECTIONS } from '../../config/catConfig';
import { formatDate } from '../../domain/date';
import type { ISODate, Mock, SectionKey } from '../../domain/types';

export interface CleanSection {
  marks?: number;
  percentile?: number;
  attempts?: number;
  correct?: number;
  accuracy?: number;
}

export interface CleanMock {
  id: string;
  date: ISODate;
  name: string;
  analysed: boolean;
  kind: 'full' | 'sectional';
  /** For a sectional, the section it covered. */
  section?: SectionKey;
  marks?: number;
  percentile?: number;
  sections: Partial<Record<SectionKey, CleanSection>>;
  setsAttempted?: number;
  setsSolved?: number;
  /** Free-text analysis, for error-pattern mining. */
  notes: { field: string; text: string }[];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function cleanSection(raw: Mock['sections'][SectionKey]): CleanSection | undefined {
  if (!raw) return undefined;

  let marks = finite(raw.score) ? raw.score : undefined;
  const attempts = finite(raw.attempts) && raw.attempts > 0 ? raw.attempts : undefined;
  // A percentile of 0 is never real data; it is a blank field.
  const percentile = finite(raw.percentile) && raw.percentile > 0 && raw.percentile <= 100 ? raw.percentile : undefined;

  // A genuine 0 with attempts behind it is kept (rule 1.3). A 0 with nothing
  // else recorded is an untouched form field.
  if (marks === 0 && attempts === undefined && percentile === undefined) marks = undefined;
  if (marks === undefined && percentile === undefined) return undefined;

  const correct = attempts !== undefined && finite(raw.correct) && raw.correct >= 0 ? raw.correct : undefined;
  const accuracy = attempts !== undefined && correct !== undefined ? Math.min(1, correct / attempts) : undefined;
  return { marks, percentile, attempts, correct, accuracy };
}

export function cleanMock(mock: Mock): CleanMock {
  const sections: Partial<Record<SectionKey, CleanSection>> = {};
  for (const s of SECTIONS) {
    const clean = cleanSection(mock.sections[s]);
    if (clean) sections[s] = clean;
  }

  const sectionMarks = SECTIONS.map((s) => sections[s]?.marks);
  const percentile =
    finite(mock.overallPercentile) && mock.overallPercentile > 0 && mock.overallPercentile <= 100
      ? mock.overallPercentile
      : undefined;

  let marks = finite(mock.overallScore) ? mock.overallScore : undefined;
  if (marks === 0 && percentile === undefined && sectionMarks.every((m) => m === undefined)) marks = undefined;
  // An overall score left blank can still be recovered from the sections.
  if (marks === undefined && mock.kind === 'full' && sectionMarks.every(finite)) {
    marks = (sectionMarks as number[]).reduce((a, v) => a + v, 0);
  }

  const notes = [
    { field: 'time', text: mock.timeNotes ?? '' },
    { field: 'selection', text: mock.selectionNotes ?? '' },
    { field: 'mistakes', text: mock.mainMistakes ?? '' },
    ...mock.lessons.map((text) => ({ field: 'lesson', text })),
  ].filter((n) => n.text.trim().length > 0);

  return {
    id: mock.id,
    date: mock.date,
    name: mock.name || mock.provider,
    analysed: mock.analysed,
    kind: mock.kind,
    section: mock.section,
    marks,
    percentile,
    sections,
    setsAttempted: finite(mock.dilrSetsAttempted) && mock.dilrSetsAttempted > 0 ? mock.dilrSetsAttempted : undefined,
    setsSolved:
      finite(mock.dilrSetsAttempted) && mock.dilrSetsAttempted > 0 && finite(mock.dilrSetsSolved)
        ? mock.dilrSetsSolved
        : undefined,
    notes,
  };
}

export interface CleanData {
  /** Every full mock, oldest first. */
  full: CleanMock[];
  /** Full mocks with overall marks: the series all trend and forecast work uses. */
  marked: CleanMock[];
  sectionals: CleanMock[];
  /** Plain statements about what was excluded or missing, and why. */
  quality: string[];
}

export function cleanData(mocks: Mock[]): CleanData {
  const sorted = [...mocks].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(cleanMock);
  const full = sorted.filter((m) => m.kind === 'full');
  const sectionals = sorted.filter((m) => m.kind === 'sectional');
  const marked = full.filter((m) => m.marks !== undefined);
  const quality: string[] = [];

  const unmarked = full.filter((m) => m.marks === undefined);
  for (const m of unmarked) {
    quality.push(
      m.percentile !== undefined
        ? `${m.name} (${formatDate(m.date)}): overall marks not recorded, so it is left out of the marks-based trend and forecast.`
        : `${m.name} (${formatDate(m.date)}): neither overall marks nor percentile recorded. Excluded.`,
    );
  }

  const noPercentile = marked.filter((m) => m.percentile === undefined).length;
  if (noPercentile > 0) {
    quality.push(
      `Overall percentile not recorded for ${noPercentile} of ${marked.length} marked mock${marked.length === 1 ? '' : 's'}. Treated as missing, not zero.`,
    );
  }

  for (const s of SECTIONS) {
    const withSection = marked.filter((m) => m.sections[s]?.marks !== undefined);
    const missingPct = withSection.filter((m) => m.sections[s]?.percentile === undefined).length;
    const missingAttempts = withSection.filter((m) => m.sections[s]?.attempts === undefined).length;
    if (missingPct > 0) {
      quality.push(`${s} percentile not recorded in ${missingPct} of ${withSection.length} mocks. Treated as missing.`);
    }
    if (missingAttempts > 0) {
      quality.push(`${s} attempts not recorded in ${missingAttempts} of ${withSection.length} mocks. Treated as missing.`);
    }
  }

  return { full, marked, sectionals, quality };
}
