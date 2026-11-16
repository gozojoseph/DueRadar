/**
 * Generates the PWA icon set from the DueRadar radar mark.
 *
 * Everything is drawn analytically and supersampled, then encoded as PNG with
 * Node's zlib. No native image dependencies, and the output is reproducible.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [11, 59, 54];
const LIGHT = [246, 245, 241];
const ACCENT = [143, 211, 199];

const SS = 4;

function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

function insideRounded(x, y, cx, cy, width, height, radius) {
  const dx = Math.abs(x - cx) - (width / 2 - radius);
  const dy = Math.abs(y - cy) - (height / 2 - radius);
  const outside = hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius <= 0;
}

function over(dst, src, alpha) {
  const outA = alpha + dst[3] * (1 - alpha);
  if (outA <= 0.0001) return;
  for (let i = 0; i < 3; i += 1) {
    dst[i] = (src[i] * alpha + dst[i] * dst[3] * (1 - alpha)) / outA;
  }
  dst[3] = outA;
}

function sample(u, v, options) {
  const color = [0, 0, 0, 0];
  if (options.square || insideRounded(u, v, 20, 20, 40, 40, 12)) {
    over(color, BG, 1);
  }

  // Shrink the mark for maskable/apple icons so platform masks never clip it.
  const scale = options.contentScale ?? 1;
  const x = 20 + (u - 20) / scale;
  const y = 20 + (v - 20) / scale;
  const dist = hypot(x - 20, y - 20);

  if (Math.abs(dist - 11.5) <= 0.7) over(color, LIGHT, 0.28);
  if (Math.abs(dist - 7) <= 0.7) over(color, LIGHT, 0.5);

  // Radar sweep arm, (20,20) -> (28.2,11.8), round caps.
  const ax = 28.2 - 20;
  const ay = 11.8 - 20;
  const px = x - 20;
  const py = y - 20;
  const t = Math.max(0, Math.min(1, (px * ax + py * ay) / (ax * ax + ay * ay)));
  const lineDist = hypot(px - ax * t, py - ay * t);
  if (lineDist <= 0.9) over(color, LIGHT, 1);

  // Wide accent arc around the top-right quadrant.
  const angle = (Math.atan2(y - 20, x - 20) * 180) / Math.PI;
  if (Math.abs(dist - 10.8) <= 1 && angle >= -90 && angle <= 0) over(color, ACCENT, 1);

  if (dist <= 2.5) over(color, LIGHT, 1);
  if (hypot(x - 27.4, y - 27.4) <= 1.6) over(color, ACCENT, 1);

  return color;
}

function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = SS * SS;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = ((px + (sx + 0.5) / SS) / size) * 40;
          const v = ((py + (sy + 0.5) / SS) / size) * 40;
          const [sr, sg, sb, sa] = sample(u, v, options);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }

      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
        pixels[offset + 3] = Math.round((a / samples) * 255);
      }
    }
  }

  return encodePng(size, size, pixels);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outputs = [
  ["icon-192.png", 192, { square: false }],
  ["icon-512.png", 512, { square: false }],
  ["maskable-512.png", 512, { square: true, contentScale: 0.8 }],
  ["apple-touch-icon.png", 180, { square: true, contentScale: 0.84 }],
];

for (const [name, size, options] of outputs) {
  writeFileSync(join(outDir, name), render(size, options));
  console.log(`wrote icons/${name} (${size}x${size})`);
}

// Notification badge: transparent background, white mark for Android's mask.
const badgeSize = 96;
const badge = Buffer.alloc(badgeSize * badgeSize * 4);
for (let py = 0; py < badgeSize; py += 1) {
  for (let px = 0; px < badgeSize; px += 1) {
    const u = (px / badgeSize) * 40;
    const v = (py / badgeSize) * 40;
    const dist = hypot(u - 20, v - 20);
    let alpha = 0;
    if (Math.abs(dist - 11) <= 0.7) alpha = 0.55;
    if (Math.abs(dist - 6.8) <= 0.7) alpha = 0.8;
    const angle = (Math.atan2(v - 20, u - 20) * 180) / Math.PI;
    if (Math.abs(dist - 10.5) <= 1 && angle >= -90 && angle <= 0) alpha = 1;
    if (dist <= 2.4) alpha = 1;
    if (hypot(u - 27, v - 27) <= 1.5) alpha = 1;

    const offset = (py * badgeSize + px) * 4;
    badge[offset] = 255;
    badge[offset + 1] = 255;
    badge[offset + 2] = 255;
    badge[offset + 3] = Math.round(alpha * 255);
  }
}
writeFileSync(join(outDir, "badge-96.png"), encodePng(badgeSize, badgeSize, badge));

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="64" height="64">
  <rect width="40" height="40" rx="12" fill="#0b3b36"/>
  <circle cx="20" cy="20" r="11.5" stroke="#f6f5f1" stroke-opacity="0.28" stroke-width="1.4" fill="none"/>
  <circle cx="20" cy="20" r="7" stroke="#f6f5f1" stroke-opacity="0.5" stroke-width="1.4" fill="none"/>
  <path d="M20 20 L28.2 11.8" stroke="#f6f5f1" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M20 9.2 A10.8 10.8 0 0 1 30.8 20" stroke="#8fd3c7" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="20" cy="20" r="2.5" fill="#f6f5f1"/>
  <circle cx="27.4" cy="27.4" r="1.6" fill="#8fd3c7"/>
</svg>
`;
writeFileSync(join(here, "..", "public", "favicon.svg"), favicon);
console.log("wrote favicon.svg");
