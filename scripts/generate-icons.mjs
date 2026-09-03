/**
 * Generates the PWA icons as real PNG files.
 *
 * No image dependencies: the pixels are drawn by hand and encoded with Node's
 * built-in zlib. Run with `npm run icons` after changing the mark.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [11, 18, 32, 255];
const BARS = [
  { x: 0.14, w: 0.15, h: 0.24, color: [60, 106, 224, 255] },
  { x: 0.33, w: 0.15, h: 0.38, color: [79, 125, 243, 255] },
  { x: 0.52, w: 0.15, h: 0.52, color: [109, 151, 255, 255] },
  { x: 0.71, w: 0.15, h: 0.68, color: [52, 211, 153, 255] },
];
const BASELINE = 0.83;

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded-rect coverage test, used for anti-aliasing-free but tidy corners. */
function insideRounded(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function drawIcon(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4, 0);
  const contentScale = maskable ? 0.68 : 1;
  const offset = (size * (1 - contentScale)) / 2;
  const bgRadius = maskable ? 0 : size * 0.22;

  const set = (x, y, color) => {
    const i = (y * size + x) * 4;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = color[3];
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (maskable || insideRounded(x + 0.5, y + 0.5, 0, 0, size, size, bgRadius)) set(x, y, BG);
    }
  }

  const baseline = offset + BASELINE * size * contentScale;
  for (const bar of BARS) {
    const bx0 = offset + bar.x * size * contentScale;
    const bx1 = bx0 + bar.w * size * contentScale;
    const by0 = baseline - bar.h * size * contentScale;
    const radius = (bx1 - bx0) / 3;
    for (let y = Math.floor(by0); y < Math.ceil(baseline); y += 1) {
      for (let x = Math.floor(bx0); x < Math.ceil(bx1); x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if (insideRounded(x + 0.5, y + 0.5, bx0, by0, bx1, baseline, radius)) set(x, y, bar.color);
      }
    }
  }

  return encodePNG(size, size, px);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT_DIR, name), drawIcon(size, opts));
  console.log(`wrote public/${name} (${size}x${size})`);
}
