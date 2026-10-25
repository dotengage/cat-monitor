/**
 * Pixel-layer tests.
 *
 * Synthetic images rather than a real screenshot, because what is being
 * checked here is not whether a glyph is read correctly - that depends on
 * fonts the test runner does not have - but whether ink is separated from
 * paper, blobs from each other, and blobs into lines and cells.
 */
import { describe, expect, it } from 'vitest';
import {
  binarise,
  classify,
  cosine,
  features,
  findGlyphs,
  groupLines,
  mergeAccents,
  otsuThreshold,
  splitCells,
  type Bitmap,
  type Glyph,
} from '../ocr';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function canvas(width: number, height: number, rects: Rect[], invert = false): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  const paper = invert ? 10 : 245;
  const ink = invert ? 250 : 20;

  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = paper;
    data[i * 4 + 1] = paper;
    data[i * 4 + 2] = paper;
    data[i * 4 + 3] = 255;
  }
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        const p = (y * width + x) * 4;
        data[p] = ink;
        data[p + 1] = ink;
        data[p + 2] = ink;
      }
    }
  }
  return { width, height, data };
}

function glyph(x: number, y: number, w: number, h: number): Glyph {
  return { x, y, w, h, mask: new Uint8Array(w * h).fill(1) };
}

describe('otsuThreshold', () => {
  it('lands between two separated peaks', () => {
    const histogram = new Uint32Array(256);
    histogram[30] = 100;
    histogram[220] = 900;
    // The returned level is the last one belonging to the darker class, which
    // is why `binarise` compares with `<=`.
    const threshold = otsuThreshold(histogram, 1000);
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThan(220);
  });
});

describe('binarise', () => {
  it('marks dark ink on light paper', () => {
    const mask = binarise(canvas(20, 10, [{ x: 4, y: 3, w: 3, h: 4 }]));
    expect(mask[3 * 20 + 4]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  it('reads a dark-mode screenshot without inverting it into a solid block', () => {
    const mask = binarise(canvas(20, 10, [{ x: 4, y: 3, w: 3, h: 4 }], true));
    expect(mask[3 * 20 + 4]).toBe(1);
    expect(mask[0]).toBe(0);
    // Ink is the minority either way round.
    expect(mask.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('treats transparent pixels as paper rather than ink', () => {
    const bitmap = canvas(10, 10, [{ x: 2, y: 2, w: 2, h: 2 }]);
    for (let i = 0; i < 10; i += 1) bitmap.data[i * 4 + 3] = 0; // a clear top-left strip
    const mask = binarise(bitmap);
    expect(mask[0]).toBe(0);
  });
});

describe('findGlyphs', () => {
  it('separates shapes that do not touch', () => {
    const bitmap = canvas(40, 20, [
      { x: 3, y: 5, w: 4, h: 9 },
      { x: 12, y: 5, w: 4, h: 9 },
    ]);
    const glyphs = findGlyphs(binarise(bitmap), 40, 20);
    expect(glyphs).toHaveLength(2);
    expect(glyphs.map((g) => g.x).sort((a, b) => a - b)).toEqual([3, 12]);
    expect(glyphs[0].h).toBe(9);
  });

  it('joins shapes that touch only at a corner, as eight-connectivity should', () => {
    const bitmap = canvas(20, 20, [
      { x: 4, y: 4, w: 3, h: 3 },
      { x: 7, y: 7, w: 3, h: 3 },
    ]);
    expect(findGlyphs(binarise(bitmap), 20, 20)).toHaveLength(1);
  });

  it('discards rules, borders and specks', () => {
    const bitmap = canvas(100, 40, [
      { x: 0, y: 2, w: 100, h: 1 }, // a full-width rule
      { x: 50, y: 20, w: 1, h: 1 }, // a speck
      { x: 10, y: 10, w: 6, h: 12 }, // a glyph
    ]);
    const glyphs = findGlyphs(binarise(bitmap), 100, 40);
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].x).toBe(10);
  });
});

describe('groupLines', () => {
  it('puts glyphs that share a band on one line', () => {
    const lines = groupLines([glyph(0, 10, 6, 12), glyph(10, 11, 6, 10), glyph(20, 40, 6, 12)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(2);
  });

  it('keeps a line in reading order whatever order it was found in', () => {
    const lines = groupLines([glyph(30, 10, 6, 12), glyph(0, 10, 6, 12), glyph(15, 10, 6, 12)]);
    expect(lines[0].map((g) => g.x)).toEqual([0, 15, 30]);
  });

  it('groups a tall bold label with the short digits beside it', () => {
    // Centres differ by 3px; overlap is what matters, not centre distance.
    const lines = groupLines([glyph(0, 8, 40, 16), glyph(60, 11, 8, 10)]);
    expect(lines).toHaveLength(1);
  });
});

describe('mergeAccents', () => {
  it('reattaches the dot of an i to its stem', () => {
    const merged = mergeAccents([glyph(5, 2, 2, 2), glyph(5, 7, 2, 10)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].h).toBe(15);
  });

  it('leaves neighbouring letters alone', () => {
    expect(mergeAccents([glyph(0, 5, 6, 10), glyph(8, 5, 6, 10)])).toHaveLength(2);
  });
});

describe('splitCells', () => {
  it('splits on table gaps but not on letter spacing', () => {
    const line = [glyph(0, 0, 6, 12), glyph(7, 0, 6, 12), glyph(80, 0, 6, 12)];
    const cells = splitCells(line);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveLength(2);
  });

  it('returns nothing for an empty line', () => {
    expect(splitCells([])).toEqual([]);
  });
});

describe('features and matching', () => {
  it('describes a glyph on a fixed grid whatever its size', () => {
    const small = features(glyph(0, 0, 8, 10));
    const large = features(glyph(0, 0, 40, 50));
    expect(small).toHaveLength(256);
    expect(cosine(small, large)).toBeCloseTo(1, 5);
  });

  it('scores a solid block against a hollow one as different', () => {
    const solid = glyph(0, 0, 10, 10);
    const hollow = glyph(0, 0, 10, 10);
    for (let y = 2; y < 8; y += 1) for (let x = 2; x < 8; x += 1) hollow.mask[y * 10 + x] = 0;
    expect(cosine(features(solid), features(hollow))).toBeLessThan(0.95);
  });

  it('picks the template that matches, and penalises wrong proportions', () => {
    const square = glyph(0, 0, 10, 10);
    const templates = [
      { char: 'A', features: features(square), aspect: 1 },
      { char: 'B', features: features(square), aspect: 0.2 },
    ];
    expect(classify(square, templates).char).toBe('A');
  });

  it('returns no character when there is nothing to match against', () => {
    expect(classify(glyph(0, 0, 4, 4), []).char).toBe('');
  });
});
