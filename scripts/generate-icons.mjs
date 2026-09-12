/**
 * Renders the app icon to PNG without a rasteriser dependency.
 *
 * The artwork is four signed-distance shapes - a rounded square, a track arc,
 * a progress arc and a cap dot - sampled with a one-pixel smoothstep for
 * antialiasing, then deflated into a PNG by hand. Keeping it in code means the
 * raster icons cannot drift from public/favicon.svg.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (d) => clamp01(0.5 - d); // coverage from a signed distance in px

function roundedRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

/** Distance to a circular arc stroke with round caps. */
function arc(px, py, cx, cy, radius, startDeg, sweepDeg, width) {
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.hypot(dx, dy);
  let t = ((Math.atan2(dy, dx) * 180) / Math.PI - startDeg) % 360;
  if (t < 0) t += 360;

  if (t <= sweepDeg) return Math.abs(dist - radius) - width / 2;

  const cap = (deg) => {
    const a = (deg * Math.PI) / 180;
    return Math.hypot(px - (cx + radius * Math.cos(a)), py - (cy + radius * Math.sin(a))) - width / 2;
  };
  return Math.min(cap(startDeg), cap(startDeg + sweepDeg));
}

function arcProgress(px, py, cx, cy, startDeg, sweepDeg) {
  let t = ((Math.atan2(py - cy, px - cx) * 180) / Math.PI - startDeg) % 360;
  if (t < 0) t += 360;
  // Inside a round cap the angle runs past the arc's own range. Wrapping it
  // would hand the start cap the far end of the gradient, so snap each cap to
  // the end it belongs to instead.
  if (t > sweepDeg) return t - sweepDeg < 360 - t ? 1 : 0;
  return t / sweepDeg;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Source-over of a straight colour onto the buffer. */
function over(buf, i, colour, alpha) {
  if (alpha <= 0) return;
  const dstA = buf[i + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  for (let c = 0; c < 3; c += 1) {
    buf[i + c] = Math.round((colour[c] * alpha + buf[i + c] * dstA * (1 - alpha)) / outA);
  }
  buf[i + 3] = Math.round(outA * 255);
}

/**
 * @param size   output pixels
 * @param inset  0 for full-bleed, 0.2 for a maskable safe zone
 */
function render(size, inset = 0) {
  const buf = new Uint8Array(size * size * 4);
  const s = size / 64; // user units -> pixels

  // The ring shrinks towards the centre for maskable icons; the plate never does.
  const k = 1 - inset;
  const cx = 32 * s;
  const cy = 32 * s;
  const radius = 18 * s * k;
  const width = 7 * s * k;
  const dotR = 5 * s * k;
  const start = 135;
  const trackSweep = 270;
  const arcSweep = 200;

  const endA = ((start + arcSweep) * Math.PI) / 180;
  const dotX = cx + radius * Math.cos(endA);
  const dotY = cy + radius * Math.sin(endA);

  const PLATE = [14, 16, 22];
  const GRAD_A = [99, 102, 241];
  const GRAD_B = [165, 180, 252];
  const WHITE = [255, 255, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      over(buf, i, PLATE, smooth(roundedRect(px, py, size, size, 13.5 * s)));
      over(buf, i, WHITE, smooth(arc(px, py, cx, cy, radius, start, trackSweep, width)) * 0.16);

      const dArc = arc(px, py, cx, cy, radius, start, arcSweep, width);
      over(buf, i, mix(GRAD_A, GRAD_B, arcProgress(px, py, cx, cy, start, arcSweep)), smooth(dArc));
      over(buf, i, WHITE, smooth(Math.hypot(px - dotX, py - dotY) - dotR));
    }
  }
  return buf;
}

/* ---------------- PNG container ---------------- */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])), 8 + data.length);
  return out;
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10-12: deflate, adaptive filtering, no interlace - all zero.

  // One filter byte (none) in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['public/icon-192.png', 192, 0],
  ['public/icon-512.png', 512, 0],
  ['public/icon-maskable-512.png', 512, 0.22],
  ['public/apple-touch-icon.png', 180, 0],
];

for (const [path, size, inset] of targets) {
  const bytes = png(render(size, inset), size);
  writeFileSync(path, bytes);
  console.log(path, size + 'px', bytes.length + ' bytes');
}
