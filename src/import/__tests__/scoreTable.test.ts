/**
 * Table-reading tests.
 *
 * The recogniser is allowed to be wrong; this layer is not. These cases use
 * the geometry of a real IMS result table, including the misreadings a
 * template matcher actually produces, to pin down that a mangled heading still
 * lands on the right field and that a cell it cannot read is left empty rather
 * than filled with a guess.
 */
import { describe, expect, it } from 'vitest';
import type { Token } from '../ocr';
import {
  buildScoreTable,
  editDistance,
  matchColumn,
  matchRow,
  normalise,
  parseNumber,
  similarity,
} from '../scoreTable';

function token(text: string, x: number, y: number, w = 60, h = 16): Token {
  return { text, x, y, w, h, confidence: 0.9, glyphs: [] };
}

/** The layout of the screenshot this feature was built for. */
function imsTable(): { lines: Token[][]; numericLines: Token[][] } {
  const columns = { attempted: 385, correct: 511, incorrect: 634, skipped: 757, score: 881 };
  const header = [
    token('Group/ Section', 36, 40, 130),
    token('Attempted', columns.attempted - 45, 40, 90),
    token('Correct', columns.correct - 35, 40, 70),
    token('Incorrect', columns.incorrect - 42, 40, 84),
    token('Skipped', columns.skipped - 36, 40, 72),
    token('Score', columns.score - 28, 40, 56),
  ];

  const body = (label: string, y: number, values: [number, number, number, number, number]) => [
    token(label, 36, y, 220),
    token(String(values[0]), columns.attempted - 8, y, 16),
    token(String(values[1]), columns.correct - 8, y, 16),
    token(String(values[2]), columns.incorrect - 5, y, 10),
    token(String(values[3]), columns.skipped - 5, y, 10),
    token(String(values[4]), columns.score - 8, y, 16),
  ];

  const lines = [
    header,
    body('Verbal Ability & Reading Comprehension', 99, [20, 12, 8, 4, 31]),
    body('Data Interpretation & Logical Reasoning', 158, [11, 6, 5, 9, 16]),
    body('Quantitative Ability', 215, [11, 7, 4, 11, 20]),
    body('Overall', 265, [42, 25, 17, 24, 67]),
  ];

  // The digits-only pass reads the same cells; the label column comes back as
  // noise, which is exactly why it is never consulted for the label.
  const numericLines = lines.map((line, i) =>
    i === 0 ? line.map((t) => ({ ...t, text: '' })) : line.map((t, j) => (j === 0 ? { ...t, text: '00' } : t)),
  );

  return { lines, numericLines };
}

describe('normalise and similarity', () => {
  it('strips everything that is not a letter', () => {
    expect(normalise('Group/ Section')).toBe('groupsection');
    expect(normalise('Attempted!')).toBe('attempted');
  });

  it('measures edit distance both ways round', () => {
    expect(editDistance('correct', 'correct')).toBe(0);
    expect(editDistance('attemptod', 'attempted')).toBe(1);
    expect(editDistance('', 'score')).toBe(5);
  });

  it('scores identical strings 1 and unrelated ones near 0', () => {
    expect(similarity('score', 'score')).toBe(1);
    expect(similarity('score', 'attempted')).toBeLessThan(0.3);
  });
});

describe('matchColumn', () => {
  it('recognises the usual headings', () => {
    expect(matchColumn('Attempted')).toBe('attempts');
    expect(matchColumn('Correct')).toBe('correct');
    expect(matchColumn('Incorrect')).toBe('incorrect');
    expect(matchColumn('Skipped')).toBe('skipped');
    expect(matchColumn('Score')).toBe('score');
  });

  it('keeps incorrect and correct apart', () => {
    expect(matchColumn('Incorrect')).toBe('incorrect');
    expect(matchColumn('Correct')).toBe('correct');
  });

  it('survives a misread character or two', () => {
    expect(matchColumn('Attemptod')).toBe('attempts');
    expect(matchColumn('Sklpped')).toBe('skipped');
    expect(matchColumn('5core')).toBe('score');
  });

  it('refuses text that is not a heading', () => {
    expect(matchColumn('Group/ Section')).toBeNull();
    expect(matchColumn('Verbal Ability')).toBeNull();
    expect(matchColumn('')).toBeNull();
  });
});

describe('matchRow', () => {
  it('maps full section names to section keys', () => {
    expect(matchRow('Verbal Ability & Reading Comprehension')).toBe('VARC');
    expect(matchRow('Data Interpretation & Logical Reasoning')).toBe('DILR');
    expect(matchRow('Quantitative Ability')).toBe('QA');
    expect(matchRow('Overall')).toBe('OVERALL');
  });

  it('maps the abbreviations other providers use', () => {
    expect(matchRow('VARC')).toBe('VARC');
    expect(matchRow('LRDI')).toBe('DILR');
    expect(matchRow('QA')).toBe('QA');
    expect(matchRow('Total')).toBe('OVERALL');
  });
});

describe('parseNumber', () => {
  it('reads plain and decimal numbers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('99.74')).toBe(99.74);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber(' 12 ')).toBe(12);
  });

  it('refuses anything that is not cleanly a number', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('12a')).toBeUndefined();
    expect(parseNumber('--')).toBeUndefined();
    expect(parseNumber('1.2.3')).toBeUndefined();
  });
});

describe('buildScoreTable', () => {
  it('reads every cell of a real result table', () => {
    const { lines, numericLines } = imsTable();
    const table = buildScoreTable(lines, numericLines);
    expect(table).not.toBeNull();

    expect(table!.sections.VARC).toEqual({ attempts: 20, correct: 12, incorrect: 8, skipped: 4, score: 31 });
    expect(table!.sections.DILR).toEqual({ attempts: 11, correct: 6, incorrect: 5, skipped: 9, score: 16 });
    expect(table!.sections.QA).toEqual({ attempts: 11, correct: 7, incorrect: 4, skipped: 11, score: 20 });
    expect(table!.overall).toEqual({ attempts: 42, correct: 25, incorrect: 17, skipped: 24, score: 67 });
    expect(table!.rows).toEqual(['VARC', 'DILR', 'QA', 'OVERALL']);
  });

  it('still reads the table when the headings are misrecognised', () => {
    const { lines, numericLines } = imsTable();
    lines[0][1].text = 'Attemptod';
    lines[0][4].text = 'Sklpped';

    const table = buildScoreTable(lines, numericLines);
    expect(table!.sections.VARC?.attempts).toBe(20);
    expect(table!.sections.VARC?.skipped).toBe(4);
  });

  it('ignores a title above the table instead of treating it as the header', () => {
    const { lines, numericLines } = imsTable();
    const title = [[token('SimCAT 14 Performance Summary', 36, 8, 300)]];
    const table = buildScoreTable([...title, ...lines], [...title, ...numericLines]);

    expect(table!.rows).toEqual(['VARC', 'DILR', 'QA', 'OVERALL']);
    expect(table!.overall.score).toBe(67);
  });

  it('leaves a cell empty rather than guessing when it cannot be read', () => {
    const { lines, numericLines } = imsTable();
    numericLines[1][3].text = '~';
    lines[1][3].text = '~';

    const table = buildScoreTable(lines, numericLines);
    expect(table!.sections.VARC?.incorrect).toBeUndefined();
    // Everything else in the row is still captured.
    expect(table!.sections.VARC?.attempts).toBe(20);
    expect(table!.sections.VARC?.score).toBe(31);
  });

  it('handles a table with only some of the columns', () => {
    const header = [token('Section', 36, 40, 70), token('Score', 300, 40, 56), token('Percentile', 460, 40, 90)];
    const row = (label: string, y: number, score: string, percentile: string) => [
      token(label, 36, y, 120),
      token(score, 318, y, 20),
      token(percentile, 486, y, 38),
    ];
    const lines = [header, row('VARC', 80, '31', '81.2'), row('QA', 120, '20', '64.5')];

    const table = buildScoreTable(lines, lines);
    expect(table!.sections.VARC).toEqual({ score: 31, percentile: 81.2 });
    expect(table!.sections.QA).toEqual({ score: 20, percentile: 64.5 });
    expect(table!.columns).toEqual(['score', 'percentile']);
  });

  it('finds the total row by arithmetic when its label is unreadable', () => {
    const { lines, numericLines } = imsTable();
    // What a bold "Overall" actually comes back as.
    lines[4][0].text = '-eraIl';
    numericLines[4][0].text = '-eraIl';

    const table = buildScoreTable(lines, numericLines);
    expect(table!.rows).toContain('OVERALL');
    expect(table!.overall).toEqual({ attempts: 42, correct: 25, incorrect: 17, skipped: 24, score: 67 });
    expect(table!.warnings).toEqual([]);
  });

  it('warns when a total does not match the sections instead of quietly accepting it', () => {
    const { lines, numericLines } = imsTable();
    // 31 + 16 + 20 is 67, not 57 - a real misread of a bold digit.
    lines[4][5].text = '57';
    numericLines[4][5].text = '57';

    const table = buildScoreTable(lines, numericLines);
    expect(table!.overall.score).toBe(57);
    expect(table!.warnings).toHaveLength(1);
    expect(table!.warnings[0]).toContain('57');
    expect(table!.warnings[0]).toContain('67');
  });

  it('does not mistake a section row for the total', () => {
    const { lines, numericLines } = imsTable();
    lines[4][0].text = '-eraIl';
    numericLines[4][0].text = '-eraIl';

    const table = buildScoreTable(lines, numericLines);
    // QA's numbers are nothing like the column sums, so it stays a section.
    expect(table!.sections.QA?.attempts).toBe(11);
    expect(table!.overall.attempts).toBe(42);
  });

  it('leaves the total empty when no row adds up and none is labelled', () => {
    const { lines, numericLines } = imsTable();
    lines[4][0].text = 'Zzz';
    numericLines[4][0].text = 'Zzz';
    lines[4][1].text = '99';
    numericLines[4][1].text = '99';
    lines[4][2].text = '98';
    numericLines[4][2].text = '98';
    lines[4][3].text = '97';
    numericLines[4][3].text = '97';
    lines[4][4].text = '96';
    numericLines[4][4].text = '96';
    lines[4][5].text = '95';
    numericLines[4][5].text = '95';

    const table = buildScoreTable(lines, numericLines);
    expect(table!.rows).not.toContain('OVERALL');
    expect(table!.overall).toEqual({});
  });

  it('returns nothing when the image is not a result table', () => {
    const lines = [[token('Your dashboard', 10, 10, 120)], [token('Welcome back', 10, 40, 110)]];
    expect(buildScoreTable(lines, lines)).toBeNull();
  });
});
