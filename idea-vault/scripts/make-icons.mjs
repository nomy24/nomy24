/* アイデア貯蔵庫 — ホーム画面用アイコンをつくる
   icons/icon.svg と同じ絵を、外部のライブラリを使わずに PNG へ焼く。
   使い方: node idea-vault/scripts/make-icons.mjs
   （icon.svg を直したときだけ実行して、出てきた PNG も一緒にコミットする） */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

const VIOLET = [0x6d, 0x4a, 0xd0];
const AMBER = [0xf2, 0xc1, 0x4e];
const WHITE = [0xff, 0xff, 0xff];

/* ---- PNG を書き出すための最小限の道具 ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // フィルタなし
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 1色8ビット
  ihdr[9] = 2;   // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- 形（0〜1の座標で考えて、あとから拡大する） ------------------------ */

const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;

function roundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return Math.hypot(x - cx, y - cy) <= radius || (x >= left + radius && x <= right - radius) || (y >= top + radius && y <= bottom - radius);
}

function capsule(x, y, x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= r;
}

/** 電球。scale で大きさ、cy で上下の位置をずらす */
function bulbColor(x, y, scale, cy) {
  const u = (x - 0.5) / scale;
  const v = (y - cy) / scale;

  if (circle(u, v, 0, -0.10, 0.30)) return AMBER;                                  // ガラス
  if (roundedRect(u, v, -0.13, 0.16, 0.13, 0.23, 0.03)) return WHITE;              // 首
  if (roundedRect(u, v, -0.15, 0.25, 0.15, 0.40, 0.05)) return WHITE;              // 口金
  for (const [angle] of [[-Math.PI / 2], [-Math.PI / 2 - 0.75], [-Math.PI / 2 + 0.75]]) {
    const x1 = Math.cos(angle) * 0.40;
    const y1 = Math.sin(angle) * 0.40 - 0.10;
    const x2 = Math.cos(angle) * 0.52;
    const y2 = Math.sin(angle) * 0.52 - 0.10;
    if (capsule(u, v, x1, y1, x2, y2, 0.035)) return AMBER;                        // ひらめきの線
  }
  return null;
}

function render(size, { maskable }) {
  const scale = maskable ? 0.60 : 0.70;
  const cy = maskable ? 0.50 : 0.51;
  const samples = 4; // 1画素を4×4で見て、境目をなめらかにする
  const out = Buffer.alloc(size * size * 3);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          // 背景。maskable は全面、ふつうのアイコンは角丸で切り抜く
          const inside = maskable || roundedRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22);
          let color = inside ? VIOLET : [0xf7, 0xf5, 0xfb];
          const bulb = bulbColor(x, y, scale, cy);
          if (bulb && inside) color = bulb;
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const total = samples * samples;
      const at = (py * size + px) * 3;
      out[at] = Math.round(r / total);
      out[at + 1] = Math.round(g / total);
      out[at + 2] = Math.round(b / total);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-192.png", 192, true],
  ["icon-maskable-512.png", 512, true],
]) {
  writeFileSync(join(OUT_DIR, name), render(size, { maskable }));
  console.log(`書き出しました: icons/${name}`);
}
