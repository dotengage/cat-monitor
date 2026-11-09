import { features, type Glyph, type Recogniser, type Template } from './ocr';

/**
 * The template sheet.
 *
 * Every character the recogniser knows is drawn into a canvas here, at a size
 * far larger than anything in a screenshot, then reduced to the same feature
 * vector a captured glyph is reduced to. Matching is therefore between two
 * things measured the same way, which is what makes a scale-free comparison
 * possible.
 *
 * Several faces and weights are drawn for each character, and the best of them
 * wins at match time. A screenshot carries whatever font the exam portal used,
 * which we do not have; what saves this is that sans-serif digits differ far
 * less between faces than letters do, and the letters only ever have to pick a
 * winner from a short list of known words.
 */

const DIGITS = '0123456789';
const SIGNS = '.-';
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PUNCTUATION = '/&%(),:';

/*
 * Breadth here buys accuracy directly.
 *
 * With five faces a bold 6 in the sample table read as a 5; with these it
 * reads correctly, and so do several letters that were wrong before. A face
 * the system does not have falls back to a default and simply produces a
 * duplicate template, which costs a little time and breaks nothing.
 */
const FACES = [
  '400 48px Arial, sans-serif',
  '600 48px Arial, sans-serif',
  '700 48px Arial, sans-serif',
  '400 48px "Segoe UI", system-ui, sans-serif',
  '600 48px "Segoe UI", system-ui, sans-serif',
  '700 48px "Segoe UI", system-ui, sans-serif',
  '400 48px Verdana, sans-serif',
  '700 48px Verdana, sans-serif',
  '400 48px Tahoma, sans-serif',
  '700 48px Tahoma, sans-serif',
  '400 48px "Trebuchet MS", sans-serif',
  '700 48px "Trebuchet MS", sans-serif',
  '400 48px Calibri, sans-serif',
  '700 48px Calibri, sans-serif',
  '400 48px Georgia, serif',
  '700 48px Georgia, serif',
];

const CANVAS = 96;

function renderGlyph(ctx: CanvasRenderingContext2D, char: string, face: string): Glyph | null {
  ctx.clearRect(0, 0, CANVAS, CANVAS);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = face;
  ctx.fillText(char, CANVAS / 2, CANVAS / 2);

  const { data } = ctx.getImageData(0, 0, CANVAS, CANVAS);
  let minX = CANVAS;
  let minY = CANVAS;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < CANVAS; y += 1) {
    for (let x = 0; x < CANVAS; x += 1) {
      // Anti-aliased edges count as ink above half coverage, matching how a
      // captured glyph is thresholded.
      if (data[(y * CANVAS + x) * 4 + 3] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      mask[y * w + x] = data[((y + minY) * CANVAS + (x + minX)) * 4 + 3] > 127 ? 1 : 0;
    }
  }
  return { x: minX, y: minY, w, h, mask };
}

function sheet(characters: string, ctx: CanvasRenderingContext2D): Template[] {
  const out: Template[] = [];
  for (const face of FACES) {
    // Heights are stored relative to this face's own capitals, which is how a
    // captured glyph is measured against its line.
    const cap = renderGlyph(ctx, 'H', face)?.h ?? 34;
    for (const char of characters) {
      const glyph = renderGlyph(ctx, char, face);
      if (!glyph) continue;
      out.push({ char, features: features(glyph), aspect: glyph.w / glyph.h, height: glyph.h / cap });
    }
  }
  return out;
}

let cached: Recogniser | null = null;

/** Built once per session; drawing ~1,500 glyphs takes a few hundred ms. */
export function buildRecogniser(): Recogniser {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS;
  canvas.height = CANVAS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser would not provide a canvas to read the image with.');

  const numeric = sheet(DIGITS + SIGNS, ctx);
  cached = { numeric, full: [...numeric, ...sheet(LETTERS + PUNCTUATION, ctx)] };
  return cached;
}

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** Decodes a pasted or dropped file into an image. */
export async function decodeImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An image's pixels, drawn at a given width. */
export function pixelsAt(image: HTMLImageElement, width: number): Pixels {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round((image.naturalHeight * w) / Math.max(1, image.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser would not provide a canvas to read the image with.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/**
 * The widths worth reading an image at.
 *
 * No single size suits every screenshot. Glyphs a few pixels tall need
 * enlarging before a 16x16 grid can describe them, but enlarging softens
 * strokes that were already crisp, and a 4K capture is slow to read at full
 * size for no gain. So an image is read at its own size and at one or two
 * others, and whichever reading makes the most sense is kept.
 */
export function readingWidths(natural: number): number[] {
  const widths = [Math.min(3, Math.max(1, 900 / Math.max(1, natural))) * natural];
  if (natural <= 2400) widths.push(natural);
  if (natural < 800) widths.push(natural * 2);
  if (natural < 600) widths.push(natural * 3);
  if (natural > 1800) widths.push(1400);
  return [...new Set(widths.map((w) => Math.round(w)))].slice(0, 4);
}

/** Decodes a pasted or dropped file into raw pixels, optionally at a chosen width. */
export async function toBitmap(file: File | Blob, targetWidth?: number): Promise<Pixels> {
  const image = await decodeImage(file);
  return pixelsAt(image, targetWidth ?? readingWidths(image.naturalWidth)[0]);
}
