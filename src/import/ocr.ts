/**
 * A small optical character recogniser, built for one job.
 *
 * Reading a result table off a screenshot normally means either a cloud OCR
 * service or a multi-megabyte WASM engine. The first breaks the promise that
 * this app keeps your data on your own device; the second is a long download
 * before you can type five numbers, and useless offline.
 *
 * Neither is necessary here, because the input is not arbitrary text. It is a
 * screenshot of a results table: clean, high-contrast, screen-rendered glyphs
 * in a sans-serif font, in a grid. That is the easy end of OCR, and template
 * matching against glyphs rendered in the browser's own fonts handles it in a
 * few hundred lines with no dependency at all.
 *
 * Everything in this file is pure: pixels in, tokens out. The canvas work -
 * decoding the image and rendering the templates - lives in `glyphs.ts`, so
 * the logic worth testing can be tested without a DOM.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One connected blob of ink, with its own pixel mask. */
export interface Glyph extends Box {
  mask: Uint8Array;
}

/** A run of glyphs that belong to one cell of the table. */
export interface Token extends Box {
  text: string;
  /** Mean match score of the glyphs, 0-1. Low means "do not trust this". */
  confidence: number;
  glyphs: Box[];
}

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, as `CanvasRenderingContext2D.getImageData` gives. */
  data: Uint8ClampedArray;
}

/** Normalised glyph feature vector: ink coverage on a fixed grid. */
export const GRID = 16;
export type Features = Float32Array;

/* ------------------------------------------------------------------ */
/* Binarisation                                                        */
/* ------------------------------------------------------------------ */

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Otsu's method: the threshold that best separates the luminance histogram
 * into two groups. Chosen over a fixed cutoff because the numbers in these
 * tables are often a mid-tone accent colour rather than black, and a fixed
 * cutoff either loses them or swallows the row shading behind them.
 */
export function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t += 1) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * Pixels to an ink mask, 1 byte per pixel.
 *
 * Also handles a screenshot taken in dark mode: whichever side of the
 * threshold holds the bulk of the image is the background, and the other side
 * is ink. Assuming "dark means ink" would invert a dark-theme capture into a
 * solid block.
 */
export function binarise(bitmap: Bitmap): Uint8Array {
  const { width, height, data } = bitmap;
  const total = width * height;
  const grey = new Uint8Array(total);
  const histogram = new Uint32Array(256);

  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    const alpha = data[p + 3] / 255;
    // Composite onto white: a transparent screenshot is still a white one.
    const v = Math.round(
      luminance(data[p], data[p + 1], data[p + 2]) * alpha + 255 * (1 - alpha),
    );
    grey[i] = v;
    histogram[v] += 1;
  }

  const threshold = otsuThreshold(histogram, total);
  let below = 0;
  for (let t = 0; t <= threshold; t += 1) below += histogram[t];

  const inkIsDark = below <= total - below;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const dark = grey[i] <= threshold;
    mask[i] = (inkIsDark ? dark : !dark) ? 1 : 0;
  }
  return mask;
}

/* ------------------------------------------------------------------ */
/* Connected components                                                */
/* ------------------------------------------------------------------ */

/**
 * Eight-connected flood fill, iterative rather than recursive so a large
 * region cannot blow the stack.
 *
 * Rules and table borders come back as components too; they are discarded by
 * size and aspect, not by cleverness, because a glyph is never a quarter of
 * the image wide nor thirty times longer than it is tall.
 */
export function findGlyphs(mask: Uint8Array, width: number, height: number): Glyph[] {
  const seen = new Uint8Array(mask.length);
  const blobs: Glyph[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      pixels.push(index);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (mask[n] === 1 && seen[n] === 0) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const blobMask = new Uint8Array(w * h);
    for (const index of pixels) {
      const x = index % width;
      const y = (index - x) / width;
      blobMask[(y - minY) * w + (x - minX)] = 1;
    }
    blobs.push({ x: minX, y: minY, w, h, mask: blobMask });
  }

  return blobs.filter((b) => isGlyphShaped(b, width, height));
}

function isGlyphShaped(blob: Glyph, width: number, height: number): boolean {
  if (blob.w * blob.h < 4) return false; // specks
  if (blob.w > width * 0.4 || blob.h > height * 0.5) return false; // panels, borders
  const aspect = blob.w / blob.h;
  return aspect < 12 && aspect > 1 / 12; // rules and hairlines
}

/* ------------------------------------------------------------------ */
/* Lines, cells and words                                              */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Groups blobs into rows of text by vertical overlap.
 *
 * Overlap rather than centre distance, because a table line mixes tall bold
 * labels with short digits and their centres do not line up.
 */
export function groupLines(blobs: Glyph[]): Glyph[][] {
  if (blobs.length === 0) return [];
  const sorted = [...blobs].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const lines: Glyph[][] = [];

  for (const blob of sorted) {
    const centre = blob.y + blob.h / 2;
    const line = lines.find((candidate) => {
      const top = Math.min(...candidate.map((b) => b.y));
      const bottom = Math.max(...candidate.map((b) => b.y + b.h));
      const height = median(candidate.map((b) => b.h));
      return centre > top - height * 0.3 && centre < bottom + height * 0.3;
    });
    if (line) line.push(blob);
    else lines.push([blob]);
  }

  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

/**
 * Re-attaches the parts of a glyph that are not connected to its body: the
 * dot over an i, the bar of a percent sign. Without this each dot becomes its
 * own one-character token and the text comes apart.
 */
export function mergeAccents(line: Glyph[]): Glyph[] {
  const height = median(line.map((b) => b.h));
  const out: Glyph[] = [];

  for (const blob of line) {
    const host = out.find((candidate) => {
      const overlap =
        Math.min(candidate.x + candidate.w, blob.x + blob.w) - Math.max(candidate.x, blob.x);
      if (overlap < Math.min(candidate.w, blob.w) * 0.6) return false;
      const gap = Math.max(candidate.y - (blob.y + blob.h), blob.y - (candidate.y + candidate.h));
      return gap < height * 0.45;
    });

    if (!host) {
      out.push(blob);
      continue;
    }
    out[out.indexOf(host)] = unite(host, blob);
  }
  return out.sort((a, b) => a.x - b.x);
}

function unite(a: Glyph, b: Glyph): Glyph {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(a.x + a.w, b.x + b.w) - x;
  const h = Math.max(a.y + a.h, b.y + b.h) - y;
  const mask = new Uint8Array(w * h);
  for (const part of [a, b]) {
    for (let py = 0; py < part.h; py += 1) {
      for (let px = 0; px < part.w; px += 1) {
        if (part.mask[py * part.w + px] === 1) mask[(part.y - y + py) * w + (part.x - x + px)] = 1;
      }
    }
  }
  return { x, y, w, h, mask };
}

/**
 * Splits a line into cells.
 *
 * Two gap sizes do the work: a small one separates words, a large one
 * separates table columns. Both are measured against the line's own glyph
 * height, so the same thresholds hold whether the screenshot came from a
 * phone or a 4K monitor.
 */
export function splitCells(line: Glyph[]): Glyph[][] {
  if (line.length === 0) return [];
  const height = median(line.map((b) => b.h));
  const cells: Glyph[][] = [[line[0]]];

  for (let i = 1; i < line.length; i += 1) {
    const previous = line[i - 1];
    const gap = line[i].x - (previous.x + previous.w);
    if (gap > height * 0.9) cells.push([line[i]]);
    else cells[cells.length - 1].push(line[i]);
  }
  return cells;
}

export function wordGaps(cell: Glyph[]): number[] {
  const height = median(cell.map((b) => b.h));
  const breaks: number[] = [];
  for (let i = 1; i < cell.length; i += 1) {
    const gap = cell[i].x - (cell[i - 1].x + cell[i - 1].w);
    if (gap > height * 0.26) breaks.push(i);
  }
  return breaks;
}

/* ------------------------------------------------------------------ */
/* Glyph features and matching                                         */
/* ------------------------------------------------------------------ */

/**
 * A glyph as a fixed-size grid of ink coverage.
 *
 * Area-averaged rather than sampled, so a 9px-tall digit and a 40px-tall one
 * from the template sheet reduce to comparable vectors. Aspect ratio is kept
 * separately: on this grid an l and a 1 look much alike, and their proportions
 * are most of what tells them apart.
 */
export function features(blob: Glyph): Features {
  const out = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy += 1) {
    const y0 = (gy * blob.h) / GRID;
    const y1 = ((gy + 1) * blob.h) / GRID;
    for (let gx = 0; gx < GRID; gx += 1) {
      const x0 = (gx * blob.w) / GRID;
      const x1 = ((gx + 1) * blob.w) / GRID;
      let ink = 0;
      let count = 0;
      for (let y = Math.floor(y0); y < Math.max(Math.ceil(y1), Math.floor(y0) + 1); y += 1) {
        for (let x = Math.floor(x0); x < Math.max(Math.ceil(x1), Math.floor(x0) + 1); x += 1) {
          if (y >= blob.h || x >= blob.w) continue;
          ink += blob.mask[y * blob.w + x];
          count += 1;
        }
      }
      out[gy * GRID + gx] = count > 0 ? ink / count : 0;
    }
  }
  return out;
}

export function cosine(a: Features, b: Features): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface Template {
  char: string;
  features: Features;
  aspect: number;
}

export interface Match {
  char: string;
  score: number;
}

/** Best template for one glyph, penalised for disagreeing about proportions. */
export function classify(blob: Glyph, templates: Template[]): Match {
  const vector = features(blob);
  const aspect = blob.w / blob.h;
  let best: Match = { char: '', score: 0 };

  for (const template of templates) {
    const shape = cosine(vector, template.features);
    const ratio = Math.min(aspect, template.aspect) / Math.max(aspect, template.aspect);
    const score = shape * (0.72 + 0.28 * ratio);
    if (score > best.score) best = { char: template.char, score };
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Reading a whole image                                               */
/* ------------------------------------------------------------------ */

export interface Recogniser {
  /** Every character the sheet knows. */
  full: Template[];
  /** Digits and signs only, for cells already known to be numeric. */
  numeric: Template[];
}

function readCell(cell: Glyph[], templates: Template[]): { text: string; confidence: number } {
  const breaks = new Set(wordGaps(cell));
  let text = '';
  let total = 0;

  cell.forEach((blob, i) => {
    if (breaks.has(i)) text += ' ';
    const match = classify(blob, templates);
    text += match.char;
    total += match.score;
  });

  return { text, confidence: cell.length > 0 ? total / cell.length : 0 };
}

function boxOf(blobs: Glyph[]): Box {
  const x = Math.min(...blobs.map((b) => b.x));
  const y = Math.min(...blobs.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...blobs.map((b) => b.x + b.w)) - x,
    h: Math.max(...blobs.map((b) => b.y + b.h)) - y,
  };
}

/**
 * The whole pipeline: pixels to lines of cells.
 *
 * Every cell is read twice, once against the full character set and once
 * against digits alone. Which reading is used is decided later, by the column
 * a cell turns out to sit in - a digit-only pass cannot mistake a zero for an
 * O, but it also cannot read a heading.
 */
export function recognise(bitmap: Bitmap, recogniser: Recogniser): { lines: Token[][]; numericLines: Token[][] } {
  const mask = binarise(bitmap);
  const blobs = findGlyphs(mask, bitmap.width, bitmap.height);
  const lines = groupLines(blobs).map(mergeAccents);

  const read = (templates: Template[]) =>
    lines
      .map((line) =>
        splitCells(line).map((cell): Token => {
          const { text, confidence } = readCell(cell, templates);
          return { ...boxOf(cell), text, confidence, glyphs: cell.map(({ x, y, w, h }) => ({ x, y, w, h })) };
        }),
      )
      .filter((line) => line.length > 0);

  return { lines: read(recogniser.full), numericLines: read(recogniser.numeric) };
}
