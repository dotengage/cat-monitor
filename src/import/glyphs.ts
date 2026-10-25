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
  for (const char of characters) {
    for (const face of FACES) {
      const glyph = renderGlyph(ctx, char, face);
      if (!glyph) continue;
      out.push({ char, features: features(glyph), aspect: glyph.w / glyph.h });
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

/** Decodes a pasted or dropped file into raw pixels. */
export async function toBitmap(file: File | Blob): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });

    /*
     * Only genuinely small screenshots are scaled up.
     *
     * Enlarging helps when glyphs are so small that a 16x16 feature grid has
     * more cells than the glyph has pixels. Past that it hurts: interpolation
     * softens the strokes, thresholding thickens them back up, and adjacent
     * letters and neighbouring lines start to run together. Measured on a real
     * table, reading at native size beat every upscale that was tried.
     */
    const scale = Math.min(3, Math.max(1, 900 / Math.max(1, image.naturalWidth)));
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('This browser would not provide a canvas to read the image with.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}
