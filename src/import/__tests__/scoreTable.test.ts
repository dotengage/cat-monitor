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
  cellNumber,
  combineTables,
  editDistance,
  looksNumeric,
  matchColumn,
  matchRow,
  normalise,
  parseNumber,
  similarity,
  type ScoreTable,
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

/* ------------------------------------------------------------------ */
/* Layouts beyond the IMS table                                        */
/* ------------------------------------------------------------------ */

/** A token centred at `cx`. */
const at = (text: string, cx: number, y: number, w = 40) => token(text, cx - w / 2, y, w);

/**
 * The geometry of a real screenshot that the first version could not read:
 * "No. of / Correct" wraps over two lines, a Questions column sits between
 * the ones we want, and every section label wraps onto two or three lines.
 */
function wrappedTable(): Token[][] {
  return [
    [at('.', 541, 78, 4), at('No. of', 808, 78, 56)],
    [at('Marks', 391, 95, 54), at('Questions', 530, 95, 90), at('Attempts', 668, 95, 80)],
    [at('Correct', 807, 112, 66)],
    [at('Overall', 157, 228, 70), at('22', 406, 229, 22), at('66', 544, 229, 22), at('33', 682, 229, 22), at('11', 822, 229, 22)],
    [at('Verbal Ability &', 204, 322, 150), at('14', 406, 323, 22), at('24', 545, 323, 22), at('17', 683, 323, 22), at('7', 821, 323, 12)],
    [at('Reading', 164, 356, 70)],
    [at('Comprehension', 205, 390, 140)],
    [at('Data Interpretation', 226, 474, 180), at('-2', 405, 474, 22), at('20', 544, 474, 22), at('8', 683, 474, 12), at('0', 821, 474, 12)],
    [at('& Logical', 168, 507, 90)],
    [at('Reasoning', 176, 542, 90)],
    [at('Quantitative Ability', 225, 624, 180), at('10', 406, 625, 22), at('22', 544, 625, 22), at('8', 683, 625, 12), at('4', 821, 625, 12)],
  ];
}

describe('more layouts', () => {
  it('reads a heading that wraps onto two lines, and ignores a Questions column', () => {
    const lines = wrappedTable();
    const table = buildScoreTable(lines, lines)!;
    expect(table.sections.VARC).toEqual({ score: 14, attempts: 17, correct: 7 });
    expect(table.sections.DILR).toEqual({ score: -2, attempts: 8, correct: 0 });
    expect(table.sections.QA).toEqual({ score: 10, attempts: 8, correct: 4 });
    expect(table.overall).toEqual({ score: 22, attempts: 33, correct: 11 });
    expect(table.columns).toEqual(['score', 'questions', 'attempts', 'correct']);
    expect(table.warnings).toEqual([]);
  });

  it('places a section whose label wraps, from the label lines around its figures', () => {
    const lines = wrappedTable();
    // Only the last word of "Verbal Ability &" survives on the figures line.
    lines[4][0].text = '&';
    const table = buildScoreTable(lines, lines)!;
    expect(table.sections.VARC?.attempts).toBe(17);
  });

  it('reads the table turned round, sections across the top', () => {
    const lines = [
      [at('VARC', 380, 20), at('DILR', 520, 20), at('QA', 660, 20), at('Total', 800, 20)],
      [at('Score', 60, 60, 60), at('36', 380, 60), at('16', 520, 60), at('25', 660, 60), at('77', 800, 60)],
      [at('Percentile', 60, 100, 90), at('91.23', 380, 100), at('78.5', 520, 100), at('85.04', 660, 100), at('93.67', 800, 100)],
    ];
    const table = buildScoreTable(lines, lines)!;
    expect(table.sections.VARC).toEqual({ score: 36, percentile: 91.23 });
    expect(table.sections.DILR).toEqual({ score: 16, percentile: 78.5 });
    expect(table.overall).toEqual({ score: 77, percentile: 93.67 });
  });

  it('finds an overall percentile shown on a card outside the table', () => {
    const lines = [
      [at('Your Score', 60, 40, 100), at('77', 160, 40, 22), at('Your Percentile', 300, 40, 140), at('94.36', 420, 40, 50)],
      [at('Section', 60, 120, 70), at('Score', 400, 120, 56), at('Attempts', 560, 120, 80)],
      [at('VARC', 60, 160), at('36', 400, 160), at('20', 560, 160)],
      [at('DILR', 60, 200), at('16', 400, 200), at('12', 560, 200)],
    ];
    const table = buildScoreTable(lines, lines)!;
    expect(table.overall).toEqual({ score: 77, percentile: 94.36 });
    expect(table.sections.VARC).toEqual({ score: 36, attempts: 20 });
  });

  it('does not take the tail of a label for its figure', () => {
    // "Your Percentile" read as "Your Percentl le": the digits-only pass reads "le" as "80".
    const full = [[token('Your Percentl le', 30, 40, 120), token('94.36', 200, 40, 50)]];
    const digits = [[token('7006 00600018 80', 30, 40, 120), token('94.36', 200, 40, 50)]];
    const table = buildScoreTable(full, digits)!;
    expect(table.overall.percentile).toBe(94.36);
  });

  it('places a section whose label could not be read, when it is the one row left', () => {
    const lines = [
      [at('Subject', 60, 20, 70), at('Score', 300, 20, 56), at('Correct', 420, 20, 66)],
      [at('VARC', 60, 60), at('36', 300, 60), at('14', 420, 60)],
      [at('DILR', 60, 100), at('16', 300, 100), at('7', 420, 100)],
      // "QA" fused into one blob.
      [at('M', 60, 140, 14), at('25', 300, 140), at('10', 420, 140)],
      [at('Total', 60, 180), at('77', 300, 180), at('31', 420, 180)],
    ];
    const table = buildScoreTable(lines, lines)!;
    expect(table.sections.QA).toEqual({ score: 25, correct: 10 });
    expect(table.overall).toEqual({ score: 77, correct: 31 });
  });

  it('drops a % sign the digits-only pass read as a digit', () => {
    expect(cellNumber('92.47%', '92.478')).toBe(92.47);
    expect(cellNumber('92.47 %ile', '92.47 8100')).toBe(92.47);
    expect(cellNumber('NA', '44')).toBeUndefined();
  });

  it('tells a number misread as letters from text that never was one', () => {
    expect(looksNumeric('2o')).toBe(true);
    expect(looksNumeric('7s.s')).toBe(true);
    expect(looksNumeric('le')).toBe(false);
    expect(looksNumeric('—')).toBe(false);
  });
});

describe('matchColumn on more headings', () => {
  it('knows the label column for what it is', () => {
    expect(matchColumn('Section')).toBeNull();
    expect(matchColumn('SectIon')).toBeNull();
    expect(matchColumn('Subject')).toBeNull();
  });

  it('recognises headings that only identify a column to skip', () => {
    expect(matchColumn('Questions')).toBe('questions');
    expect(matchColumn('Total Questions')).toBe('questions');
    expect(matchColumn('Accuracy')).toBe('accuracy');
  });

  it('prefers the whole heading over one of its words', () => {
    expect(matchColumn('Not Attempted')).toBe('skipped');
    expect(matchColumn('Questions Attempted')).toBe('attempts');
    expect(matchColumn('No. of Correct')).toBe('correct');
    expect(matchColumn('No. of Incorrect')).toBe('incorrect');
    expect(matchColumn('%ile')).toBe('percentile');
  });
});

describe('combineTables', () => {
  const reading = (dilrAttempts: number | undefined, overall = 33): ScoreTable =>
    buildScoreTable(
      [
        [at('Section', 60, 20, 70), at('Score', 300, 20, 56), at('Attempts', 420, 20, 80)],
        [at('VARC', 60, 60), at('14', 300, 60), at('17', 420, 60)],
        [at('DILR', 60, 100), at('-2', 300, 100), ...(dilrAttempts === undefined ? [] : [at(String(dilrAttempts), 420, 100)])],
        [at('QA', 60, 140), at('10', 300, 140), at('8', 420, 140)],
        [at('Overall', 60, 180), at('22', 300, 180), at(String(overall), 420, 180)],
      ],
      [],
    )!;

  it('takes the value most readings agree on', () => {
    expect(combineTables([reading(8), reading(0), reading(8)])!.sections.DILR?.attempts).toBe(8);
  });

  it('uses the arithmetic to choose between two readings that disagree', () => {
    // One reading saw the small 8 as a 0; only 8 makes the column add up to 33.
    const combined = combineTables([reading(0), reading(8)])!;
    expect(combined.sections.DILR?.attempts).toBe(8);
    expect(combined.warnings).toEqual([]);
  });

  it('fills a lone unread cell from a total that readings agree on', () => {
    expect(combineTables([reading(undefined), reading(undefined)])!.sections.DILR?.attempts).toBe(8);
  });

  it('does not trust a total only one reading saw', () => {
    expect(combineTables([reading(undefined), reading(undefined, 40)])!.sections.DILR?.attempts).toBeUndefined();
  });
});
