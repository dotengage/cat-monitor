/**
 * Report tests.
 *
 * A PDF that opens in the browser but is subtly malformed is worse than no
 * PDF, so these assert the byte structure as well as the contents: header,
 * object table, cross-reference offsets that actually point at their objects,
 * and a trailer.
 */
import { describe, expect, it } from 'vitest';
import { makeError, makeMock, makePractice, makeState, makeTask, TODAY } from '../../engine/__tests__/fixtures';
import { PdfDoc, textWidth, toAscii } from '../pdf';
import { buildAnalyticsReport, buildMockReport, reportFilename } from '../reports';

async function bytesOf(doc: PdfDoc): Promise<string> {
  const buffer = await doc.toBlob().arrayBuffer();
  return String.fromCharCode(...new Uint8Array(buffer));
}

function assertValidPdf(pdf: string) {
  expect(pdf.startsWith('%PDF-1.4')).toBe(true);
  expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdf).toContain('/Type /Catalog');
  expect(pdf).toContain('/Type /Pages');
  expect(pdf).toContain('/BaseFont /Helvetica');

  // The cross-reference offsets must land exactly on their object headers.
  const startxref = Number(pdf.slice(pdf.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
  expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

  const xref = pdf.slice(startxref);
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  expect(offsets.length).toBeGreaterThan(2);
  offsets.forEach((offset, i) => {
    if (offset === 0) return;
    expect(pdf.slice(offset, offset + 24)).toMatch(new RegExp(`^${i + 1} 0 obj`));
  });
}

describe('toAscii', () => {
  it('folds typography the base-14 fonts cannot represent', () => {
    expect(toAscii('96th — “on track” · 12…')).toBe('96th - "on track" - 12...');
    expect(toAscii('arrow → here')).toBe('arrow -> here');
  });

  it('strips anything still outside printable ASCII', () => {
    expect(toAscii('emoji 🏁 gone')).toBe('emoji  gone');
  });
});

describe('textWidth', () => {
  it('measures wider strings as wider', () => {
    expect(textWidth('mmmm', 10)).toBeGreaterThan(textWidth('iiii', 10));
  });

  it('scales linearly with font size', () => {
    expect(textWidth('hello', 20)).toBeCloseTo(textWidth('hello', 10) * 2, 5);
  });
});

describe('PdfDoc', () => {
  it('produces a structurally valid PDF', async () => {
    const doc = new PdfDoc('Test');
    doc.title('Title', 'subtitle');
    doc.heading('Section');
    doc.paragraph('Some prose that should wrap across the page width. '.repeat(6));
    doc.keyValues([['Key', 'Value']]);
    doc.stats([{ label: 'One', value: '1' }]);
    doc.table([{ header: 'A', width: 50 }, { header: 'B', width: 50, align: 'right' }], [['x', 'y']]);
    doc.bars([{ label: 'Bar', value: 3 }]);
    doc.lineChart([{ label: 'Jan', value: 70 }, { label: 'Feb', value: 80 }], 96);
    doc.bullets(['first', 'second']);
    assertValidPdf(await bytesOf(doc));
  });

  it('paginates long documents', async () => {
    const doc = new PdfDoc('Test');
    doc.title('Long');
    for (let i = 0; i < 120; i += 1) doc.paragraph(`Line ${i} of a deliberately long report body.`);
    const pdf = await bytesOf(doc);
    assertValidPdf(pdf);
    const pageCount = (pdf.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect(pdf).toContain('page 1 of');
  });

  it('escapes characters that would corrupt a content stream', async () => {
    const doc = new PdfDoc('Test');
    doc.paragraph('Brackets ( ) and a backslash \\ must not break the stream');
    const pdf = await bytesOf(doc);
    assertValidPdf(pdf);
    expect(pdf).toContain('\\(');
    expect(pdf).toContain('\\)');
  });
});

describe('buildMockReport', () => {
  function populated() {
    return makeState({
      mocks: [
        makeMock({ name: 'SimCAT 1', date: '2026-08-20', overallPercentile: 78, analysed: true, lessons: ['Start with VARC'] }),
        makeMock({ name: 'SimCAT 2', date: '2026-08-27', overallPercentile: 84, analysed: false }),
      ],
      practice: [makePractice({ section: 'QA', attempted: 40, correct: 28 })],
    });
  }

  it('builds a valid PDF from real data', async () => {
    assertValidPdf(await bytesOf(buildMockReport(populated(), TODAY)));
  });

  it('includes every mock and flags unanalysed ones', async () => {
    const pdf = await bytesOf(buildMockReport(populated(), TODAY));
    expect(pdf).toContain('SimCAT 1');
    expect(pdf).toContain('SimCAT 2');
    expect(pdf).toContain('INCOMPLETE');
    expect(pdf).toContain('Start with VARC');
  });

  it('works with no data at all rather than throwing', async () => {
    const pdf = await bytesOf(buildMockReport(makeState(), TODAY));
    assertValidPdf(pdf);
    expect(pdf).toContain('No mocks have been recorded yet');
  });
});

describe('buildAnalyticsReport', () => {
  it('builds a valid PDF and covers the main sections', async () => {
    const state = makeState({
      mocks: [makeMock({ date: '2026-08-20', overallPercentile: 80, analysed: true })],
      practice: [makePractice({ section: 'DILR', attempted: 20, correct: 9, setsAttempted: 4, setsSolved: 2 })],
      errors: [makeError({ errorType: 'calculation' }), makeError({ errorType: 'calculation' })],
      tasks: [makeTask({ status: 'done', actualMin: 60 })],
    });
    const pdf = await bytesOf(buildAnalyticsReport(state, TODAY));

    assertValidPdf(pdf);
    expect(pdf).toContain('Analytics report');
    expect(pdf).toContain('Remaining workload');
    expect(pdf).toContain('Consistency');
    expect(pdf).toContain('Error categories');
  });

  it('survives a completely empty state', async () => {
    assertValidPdf(await bytesOf(buildAnalyticsReport(makeState(), TODAY)));
  });
});

describe('reportFilename', () => {
  it('names files so they sort by date', () => {
    expect(reportFilename('mock', TODAY)).toBe('cat-monitor-mock-report-2026-09-03.pdf');
    expect(reportFilename('analytics', TODAY)).toBe('cat-monitor-analytics-report-2026-09-03.pdf');
  });
});
