import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A small original code-drawn film icon; no Jianying brand assets are used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'desktop/assets');
const iconset = path.join(root, '.desktop-icon.iconset');
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(iconset, { recursive: true });
const width = 1024;
const pixels = Buffer.alloc(width * (width * 4 + 1));
function rounded(x, y, left, top, w, h, radius) {
  const cx = Math.max(left + radius, Math.min(x, left + w - radius));
  const cy = Math.max(top + radius, Math.min(y, top + h - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}
for (let y = 0; y < width; y++) {
  for (let x = 0; x < width; x++) {
    let color = [0, 0, 0, 0];
    if (rounded(x, y, 40, 40, 944, 944, 210)) color = [26, 29, 31, 255];
    if (rounded(x, y, 190, 297, 644, 430, 86)) color = [47, 209, 203, 255];
    if (rounded(x, y, 258, 371, 508, 282, 26)) color = [26, 29, 31, 255];
    if (x >= 454 && x <= 622 && Math.abs(y - 512) <= (622 - x) * 0.67) color = [247, 252, 252, 255];
    const index = y * (width * 4 + 1) + 1 + x * 4;
    pixels.set(color, index);
  }
}
const crc = data => { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); } return (value ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const label = Buffer.from(type); const header = Buffer.alloc(4); header.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([label, data]))); return Buffer.concat([header, label, data, checksum]); }
const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const source = path.join(directory, 'icon.png');
await fs.writeFile(source, png);
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
  const output = path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
  const result = spawnSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), source, '--out', output], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const result = spawnSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(directory, 'icon.icns')], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr);
await fs.rm(iconset, { recursive: true, force: true });
