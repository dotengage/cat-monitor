/**
 * A very small PDF writer.
 *
 * Dependency-free on purpose. The alternatives were a ~600KB library that
 * rasterises the page into a blurry image, or the browser's print dialog,
 * which is awkward inside an installed PWA. This emits a real PDF with
 * selectable, searchable text at a cost of a few kilobytes.
 *
 * Scope is deliberately narrow: the base-14 Helvetica faces (so no font
 * embedding), A4 pages, and the handful of primitives the reports need.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Helvetica advance widths, /1000 em, for ASCII 32-126. */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

export type Font = 'regular' | 'bold';

/**
 * PDF base-14 fonts use single-byte encodings, and the app's copy is full of
 * typographic dashes, curly quotes and the odd arrow. Fold them to ASCII so
 * the output never contains mojibake, and so byte offsets in the cross
 * reference table match string indices.
 */
export function toAscii(input: string): string {
  return (input ?? '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[·•]/g, '-')
    .replace(/→/g, '->')
    .replace(/\u00a0/g, ' ')
    .replace(/[✅✓✔]/g, 'Y')
    .replace(/[❌✕✗]/g, 'N')
    .replace(/[^\x20-\x7E\n]/g, '');
}

export function textWidth(text: string, size: number, font: Font = 'regular'): number {
  const widths = font === 'bold' ? W_BOLD : W_REGULAR;
  let total = 0;
  for (const ch of toAscii(text)) {
    const code = ch.charCodeAt(0);
    total += code >= 32 && code <= 126 ? widths[code - 32] : 500;
  }
  return (total / 1000) * size;
}

function wrap(text: string, size: number, font: Font, maxWidth: number): string[] {
  const words = toAscii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size, font) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // A single word longer than the column: hard-break it.
      if (textWidth(word, size, font) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (textWidth(chunk + ch, size, font) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      } else line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function escape(text: string): string {
  return toAscii(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

const INK: RGB = { r: 0.09, g: 0.09, b: 0.11 };
const MUTED: RGB = { r: 0.43, g: 0.43, b: 0.48 };
const ACCENT: RGB = { r: 0.39, g: 0.4, b: 0.95 };
const LINE: RGB = { r: 0.87, g: 0.87, b: 0.89 };

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

/** Builds a single-column report document, flowing top to bottom. */
export class PdfDoc {
  private pages: string[] = [];
  private current: string[] = [];
  private y = PAGE_H - MARGIN;
  private readonly footer: string;

  constructor(footer = 'CAT Monitor') {
    this.footer = toAscii(footer);
  }

  /* ---------------- primitives ---------------- */

  private op(s: string) {
    this.current.push(s);
  }

  private setFill({ r, g, b }: RGB) {
    this.op(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  private ensure(space: number) {
    if (this.y - space < MARGIN + 26) this.newPage();
  }

  private newPage() {
    if (this.current.length > 0) this.pages.push(this.current.join('\n'));
    this.current = [];
    this.y = PAGE_H - MARGIN;
  }

  private drawText(text: string, x: number, size: number, font: Font, colour: RGB) {
    this.setFill(colour);
    this.op('BT');
    this.op(`/${font === 'bold' ? 'F2' : 'F1'} ${size} Tf`);
    this.op(`1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm`);
    this.op(`(${escape(text)}) Tj`);
    this.op('ET');
  }

  /* ---------------- public layout API ---------------- */

  title(text: string, subtitle?: string) {
    this.ensure(60);
    this.y -= 18;
    this.drawText(text, MARGIN, 20, 'bold', INK);
    this.y -= 16;
    if (subtitle) {
      this.drawText(subtitle, MARGIN, 9.5, 'regular', MUTED);
      this.y -= 14;
    }
    this.rule();
    this.y -= 10;
  }

  heading(text: string) {
    this.ensure(44);
    this.y -= 20;
    this.drawText(text, MARGIN, 12.5, 'bold', INK);
    this.y -= 6;
    this.rule();
    this.y -= 12;
  }

  paragraph(text: string, opts: { muted?: boolean; size?: number } = {}) {
    const size = opts.size ?? 9.5;
    for (const line of wrap(text, size, 'regular', CONTENT_W)) {
      this.ensure(size + 5);
      this.drawText(line, MARGIN, size, 'regular', opts.muted ? MUTED : INK);
      this.y -= size + 4;
    }
    this.y -= 4;
  }

  bullets(items: string[]) {
    for (const item of items) {
      const lines = wrap(item, 9.5, 'regular', CONTENT_W - 14);
      lines.forEach((line, i) => {
        this.ensure(15);
        if (i === 0) this.drawText('-', MARGIN + 2, 9.5, 'bold', ACCENT);
        this.drawText(line, MARGIN + 14, 9.5, 'regular', INK);
        this.y -= 13.5;
      });
    }
    this.y -= 5;
  }

  keyValues(rows: [string, string][]) {
    for (const [key, value] of rows) {
      this.ensure(16);
      this.drawText(key, MARGIN, 9.5, 'regular', MUTED);
      const w = textWidth(value, 9.5, 'bold');
      this.drawText(value, PAGE_W - MARGIN - w, 9.5, 'bold', INK);
      this.y -= 15;
    }
    this.y -= 4;
  }

  /** Big headline figures, three across. */
  stats(items: { label: string; value: string }[]) {
    const perRow = 3;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      this.ensure(46);
      const colW = CONTENT_W / perRow;
      const topY = this.y;
      row.forEach((item, c) => {
        const x = MARGIN + c * colW;
        this.y = topY - 10;
        this.drawText(item.label.toUpperCase(), x, 7.5, 'bold', MUTED);
        this.y = topY - 28;
        this.drawText(item.value, x, 16, 'bold', INK);
      });
      this.y = topY - 44;
    }
    this.y -= 4;
  }

  table(columns: TableColumn[], rows: string[][]) {
    const total = columns.reduce((a, c) => a + c.width, 0);
    const scale = CONTENT_W / total;
    const xs: number[] = [];
    let cursor = MARGIN;
    for (const col of columns) {
      xs.push(cursor);
      cursor += col.width * scale;
    }

    const header = () => {
      this.ensure(28);
      columns.forEach((col, i) => {
        const w = col.width * scale;
        const label = col.header.toUpperCase();
        const x = col.align === 'right' ? xs[i] + w - textWidth(label, 7.5, 'bold') : xs[i];
        this.drawText(label, x, 7.5, 'bold', MUTED);
      });
      this.y -= 8;
      this.rule();
      this.y -= 12;
    };

    header();

    for (const row of rows) {
      // Wrap every cell, then give the row the height of its tallest cell.
      const cells = row.map((cell, i) => wrap(cell ?? '', 9, 'regular', columns[i].width * scale - 8));
      const height = Math.max(...cells.map((c) => c.length)) * 12;

      if (this.y - height < MARGIN + 26) {
        this.newPage();
        header();
      }

      const topY = this.y;
      cells.forEach((lines, i) => {
        const w = columns[i].width * scale;
        lines.forEach((line, li) => {
          this.y = topY - li * 12;
          const x = columns[i].align === 'right' ? xs[i] + w - textWidth(line, 9, 'regular') - 4 : xs[i];
          this.drawText(line, x, 9, 'regular', INK);
        });
      });
      this.y = topY - height - 3;
      this.rule(LINE);
      this.y -= 9;
    }
    this.y -= 4;
  }

  /** Horizontal bars: enough to show shape without pretending to be a chart. */
  bars(items: { label: string; value: number; caption?: string }[], unit = '') {
    const max = Math.max(1, ...items.map((i) => i.value));
    for (const item of items) {
      this.ensure(30);
      this.drawText(item.label, MARGIN, 9, 'regular', INK);
      const right = `${item.value}${unit}${item.caption ? `  ${item.caption}` : ''}`;
      this.drawText(right, PAGE_W - MARGIN - textWidth(right, 9, 'bold'), 9, 'bold', INK);
      this.y -= 11;

      const barW = (item.value / max) * CONTENT_W;
      this.setFill(LINE);
      this.op(`${MARGIN} ${this.y.toFixed(2)} ${CONTENT_W.toFixed(2)} 5 re f`);
      this.setFill(ACCENT);
      this.op(`${MARGIN} ${this.y.toFixed(2)} ${Math.max(1, barW).toFixed(2)} 5 re f`);
      this.y -= 14;
    }
    this.y -= 4;
  }

  /** A simple line chart for percentile trends. */
  lineChart(points: { label: string; value: number }[], target?: number, height = 120) {
    if (points.length === 0) return;
    this.ensure(height + 26);
    const values = points.map((p) => p.value);
    if (target !== undefined) values.push(target);
    const lo = Math.max(0, Math.min(...values) - 5);
    const hi = Math.min(100, Math.max(...values) + 5);
    const span = Math.max(1, hi - lo);

    const bottom = this.y - height;
    const px = (i: number) =>
      MARGIN + (points.length === 1 ? CONTENT_W / 2 : (i * CONTENT_W) / (points.length - 1));
    const py = (v: number) => bottom + ((v - lo) / span) * height;

    // Axis
    this.setFill(LINE);
    this.op(`${MARGIN} ${bottom.toFixed(2)} ${CONTENT_W.toFixed(2)} 0.7 re f`);

    if (target !== undefined) {
      this.op('0.09 0.64 0.41 rg');
      this.op(`${MARGIN} ${py(target).toFixed(2)} ${CONTENT_W.toFixed(2)} 0.7 re f`);
      const saveY = this.y;
      this.y = py(target) + 4;
      this.drawText(`target ${target}`, PAGE_W - MARGIN - textWidth(`target ${target}`, 7.5, 'regular'), 7.5, 'regular', {
        r: 0.09,
        g: 0.64,
        b: 0.41,
      });
      this.y = saveY;
    }

    // Trend line, drawn as a stroked path.
    this.op(`${ACCENT.r} ${ACCENT.g} ${ACCENT.b} RG`);
    this.op('1.4 w');
    points.forEach((p, i) => {
      this.op(`${px(i).toFixed(2)} ${py(p.value).toFixed(2)} ${i === 0 ? 'm' : 'l'}`);
    });
    this.op('S');

    // Points and labels
    this.setFill(ACCENT);
    points.forEach((p, i) => {
      this.op(`${(px(i) - 2).toFixed(2)} ${(py(p.value) - 2).toFixed(2)} 4 4 re f`);
    });
    const saveY = this.y;
    points.forEach((p, i) => {
      const label = toAscii(p.label);
      const w = textWidth(label, 7, 'regular');
      let x = px(i) - w / 2;
      x = Math.max(MARGIN, Math.min(x, PAGE_W - MARGIN - w));
      this.y = bottom - 11;
      this.drawText(label, x, 7, 'regular', MUTED);
      this.y = py(p.value) + 6;
      const val = String(p.value);
      this.drawText(val, px(i) - textWidth(val, 7, 'bold') / 2, 7, 'bold', INK);
    });
    this.y = saveY - height - 20;
  }

  rule(colour: RGB = LINE) {
    this.setFill(colour);
    this.op(`${MARGIN} ${this.y.toFixed(2)} ${CONTENT_W.toFixed(2)} 0.7 re f`);
  }

  spacer(amount = 10) {
    this.y -= amount;
  }

  pageBreak() {
    this.newPage();
  }

  /* ---------------- serialisation ---------------- */

  private finish(): string[] {
    if (this.current.length > 0) {
      this.pages.push(this.current.join('\n'));
      this.current = [];
    }
    // Stamp a footer on every page once the total is known.
    return this.pages.map((content, i) => {
      const label = `${this.footer}  -  page ${i + 1} of ${this.pages.length}`;
      const footer = [
        `${MUTED.r} ${MUTED.g} ${MUTED.b} rg`,
        'BT',
        '/F1 7.5 Tf',
        `1 0 0 1 ${MARGIN} ${MARGIN - 14} Tm`,
        `(${escape(label)}) Tj`,
        'ET',
      ].join('\n');
      return `${content}\n${footer}`;
    });
  }

  toBlob(): Blob {
    const contents = this.finish();
    const objects: string[] = [];
    const pageCount = contents.length;

    // 1 catalog, 2 pages, 3..(2+n) page objects, then n content streams, then 2 fonts.
    const pageIds = contents.map((_, i) => 3 + i);
    const streamIds = contents.map((_, i) => 3 + pageCount + i);
    const fontRegularId = 3 + pageCount * 2;
    const fontBoldId = fontRegularId + 1;

    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;

    contents.forEach((content, i) => {
      objects[pageIds[i]] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> ` +
        `/Contents ${streamIds[i]} 0 R >>`;
      objects[streamIds[i]] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    objects[fontRegularId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i += 1) {
      if (!objects[i]) continue;
      offsets[i] = pdf.length;
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefStart = pdf.length;
    const count = objects.length;
    pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i += 1) {
      pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    // Every byte is ASCII by construction, so string length equals byte length
    // and the offsets above stay valid.
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  save(filename: string) {
    const url = URL.createObjectURL(this.toBlob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the download a moment to start before the blob is reclaimed.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
