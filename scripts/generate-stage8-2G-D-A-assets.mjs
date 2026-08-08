import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const root = process.cwd();
const outDir = path.join(root, 'assets/battle/sprites');
const CELL = 96;
const DIRECTIONS = 8;
const DIRECTION_ANGLES = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4];
const palettes = {
  friendly: { primary: [45, 112, 86], light: [142, 201, 155], accent: [221, 212, 151], dark: [18, 42, 34], mark: [176, 236, 190] },
  enemy: { primary: [126, 55, 51], light: [205, 105, 79], accent: [177, 143, 89], dark: [45, 27, 26], mark: [245, 139, 83] }
};
palettes.enemy = { primary: [126, 55, 51], light: [205, 105, 79], accent: [177, 143, 89], dark: [45, 27, 26], mark: [245, 139, 83] };

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const tag = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, checksum]); }
function encodePng(width, height, pixels) { const rows = Buffer.alloc((width * 4 + 1) * height); for (let y = 0; y < height; y += 1) { const row = y * (width * 4 + 1); rows[row] = 0; Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, row + 1); } const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]); }
function canvas(width, height) { return { width, height, pixels: new Uint8Array(width * height * 4) }; }
function paint(image, x, y, color, alpha = 255) { const px = Math.round(x); const py = Math.round(y); if (px < 0 || py < 0 || px >= image.width || py >= image.height) return; const offset = (py * image.width + px) * 4; image.pixels[offset] = color[0]; image.pixels[offset + 1] = color[1]; image.pixels[offset + 2] = color[2]; image.pixels[offset + 3] = alpha; }
function ellipse(image, cx, cy, rx, ry, color, rotation = 0, alpha = 255) { const cos = Math.cos(rotation); const sin = Math.sin(rotation); const radius = Math.ceil(Math.hypot(rx, ry)); for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) { const dx = x - cx; const dy = y - cy; const ux = dx * cos + dy * sin; const uy = -dx * sin + dy * cos; if ((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry) <= 1) paint(image, x, y, color, alpha); } }
function rect(image, cx, cy, width, height, color, rotation = 0, alpha = 255) { polygon(image, [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]], color, cx, cy, rotation, alpha); }
function line(image, x1, y1, x2, y2, color, width = 1, alpha = 255) { const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2)); for (let i = 0; i <= steps; i += 1) { const t = i / steps; ellipse(image, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, width / 2, color, 0, alpha); } }
function polygon(image, points, color, cx = 0, cy = 0, rotation = 0, alpha = 255) { const cos = Math.cos(rotation); const sin = Math.sin(rotation); const world = points.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]); const minX = Math.floor(Math.min(...world.map(([x]) => x))); const maxX = Math.ceil(Math.max(...world.map(([x]) => x))); const minY = Math.floor(Math.min(...world.map(([, y]) => y))); const maxY = Math.ceil(Math.max(...world.map(([, y]) => y))); for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) { let inside = false; for (let i = 0, j = world.length - 1; i < world.length; j = i++) { const [xi, yi] = world[i]; const [xj, yj] = world[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } if (inside) paint(image, x, y, color, alpha); } }
function transform(cx, cy, x, y, angle) { return { x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) }; }
function localLine(image, cx, cy, x1, y1, x2, y2, angle, color, width = 1, alpha = 255) { const a = transform(cx, cy, x1, y1, angle); const b = transform(cx, cy, x2, y2, angle); line(image, a.x, a.y, b.x, b.y, color, width, alpha); }

function infantryFrame(image, side, at, direction, frame) {
  const palette = palettes[side]; const cx = CELL / 2; const cy = CELL / 2 + 2; const angle = DIRECTION_ANGLES[direction]; const moving = frame >= 2 && frame <= 5; const firing = frame === 7; const stride = moving ? ((frame - 2) % 2 ? 3 : -3) : 0;
  ellipse(image, cx + 4, cy + 18, 18, 5, [7, 14, 12], 0, 150);
  localLine(image, cx, cy + 5, -5 + stride, 19, angle, palette.dark, 4); localLine(image, cx, cy + 5, 6 - stride, 19, angle, palette.dark, 4);
  ellipse(image, cx, cy, at ? 10 : 9, 14, palette.primary, angle, 255); ellipse(image, cx - 1, cy - 12, 6.5, 6, palette.light, 0, 255);
  rect(image, cx - 6, cy - 1, 3, 12, palette.dark, angle, 255);
  if (at) { rect(image, cx - 9, cy + 1, 9, 14, palette.dark, angle, 255); ellipse(image, cx - 12, cy - 4, 5, 7, palette.accent, angle, 255); localLine(image, cx + 2, cy - 1, 28 - (firing ? 4 : 0), -10, angle, palette.accent, 5); localLine(image, cx + 4, cy - 3, 29 - (firing ? 4 : 0), -12, angle, palette.mark, 2); }
  else { localLine(image, cx + 2, cy - 1, 22 - (firing ? 3 : 0), -5, angle, palette.accent, 3); localLine(image, cx + 3, cy - 3, 22 - (firing ? 3 : 0), -6, angle, palette.dark, 1); }
  localLine(image, cx - 5, cy - 16, 6, -16, angle, palette.mark, 2);
  if (firing) { const muzzle = transform(cx, cy, at ? 30 : 23, at ? -10 : -5, angle); ellipse(image, muzzle.x, muzzle.y, at ? 6 : 4, at ? 4 : 3, palette.accent, angle, 235); }
}

function tankHullFrame(image, side, direction, frame) {
  const palette = palettes[side]; const cx = CELL / 2; const cy = CELL / 2; const angle = DIRECTION_ANGLES[direction]; const moving = frame >= 2 && frame <= 5;
  ellipse(image, cx + 4, cy + 18, 32, 7, [7, 14, 12], 0, 170);
  rect(image, cx, cy + 2, 58, 13, palette.dark, angle); rect(image, cx, cy, 48, 25, palette.primary, angle); polygon(image, [[-23, -12], [13, -12], [25, -5], [21, 11], [-22, 11], [-27, 3]], palette.light, cx, cy, angle);
  if (moving) { localLine(image, cx, cy - 8, -19, -8, angle, palette.accent, 2); localLine(image, cx, cy + 8, -19, 8, angle, palette.accent, 2); }
  localLine(image, cx, cy - 11, 21, -11, angle, palette.mark, 2); rect(image, cx - 17, cy, 5, 18, palette.accent, angle); rect(image, cx + 17, cy, 5, 18, palette.accent, angle);
}

function tankTurretFrame(image, side, direction, frame) {
  const palette = palettes[side]; const cx = CELL / 2; const cy = CELL / 2; const angle = DIRECTION_ANGLES[direction]; const firing = frame === 7;
  ellipse(image, cx, cy, 15, 12, palette.dark, 0, 255); ellipse(image, cx, cy, 12, 10, palette.light, 0, 255); localLine(image, cx, cy, 37 - (firing ? 7 : 0), -1, angle, palette.dark, 6); localLine(image, cx, cy, 35 - (firing ? 7 : 0), -1, angle, palette.accent, 2); ellipse(image, cx, cy, 4, 4, palette.mark, 0, 255);
  if (firing) { const muzzle = transform(cx, cy, 39, -1, angle); ellipse(image, muzzle.x, muzzle.y, 7, 5, palette.accent, angle, 240); }
}

function wreckFrame(image, side, direction) {
  const palette = palettes[side]; const cx = CELL / 2; const cy = CELL / 2; const angle = DIRECTION_ANGLES[direction]; ellipse(image, cx + 4, cy + 17, 30, 6, [5, 9, 8], 0, 170); rect(image, cx, cy, 54, 25, palette.dark, angle); polygon(image, [[-24, -10], [13, -11], [24, -3], [18, 10], [-22, 9]], [62, 66, 57], cx, cy, angle); rect(image, cx - 2, cy, 9, 4, palette.primary, angle); localLine(image, cx - 17, cy - 9, 16, 9, angle, palette.light, 3, 185); localLine(image, cx + 16, cy - 10, -13, 10, angle, palette.light, 2, 185); const flame = transform(cx, cy, -5, -1, angle); ellipse(image, flame.x, flame.y, 6, 4, palette.mark, angle, 180); }

function unitSheet(kind, side) { const image = canvas(CELL * 8, CELL * DIRECTIONS); for (let direction = 0; direction < DIRECTIONS; direction += 1) for (let frame = 0; frame < 8; frame += 1) { if (kind === 'infantry') infantryFrame({ ...image, pixels: image.pixels, width: image.width, height: image.height }, side, false, direction, frame); } return image; }
function drawCell(image, kind, side, direction, frame, component = null) { const cell = canvas(CELL, CELL); if (kind === 'infantry') infantryFrame(cell, side, false, direction, frame); if (kind === 'at_infantry') infantryFrame(cell, side, true, direction, frame); if (kind === 'mbt_hull') tankHullFrame(cell, side, direction, frame); if (kind === 'mbt_turret') tankTurretFrame(cell, side, direction, frame); if (kind === 'wreck') wreckFrame(cell, side, direction); return cell; }
function sheet(kind, side, columns = 8) { const image = canvas(CELL * columns, CELL * DIRECTIONS); const frameCount = kind === 'wreck' ? 1 : 8; for (let direction = 0; direction < DIRECTIONS; direction += 1) for (let frame = 0; frame < frameCount; frame += 1) { const cell = drawCell(image, kind, side, direction, frame); const x = frame * CELL; const y = direction * CELL; for (let row = 0; row < CELL; row += 1) Buffer.from(cell.pixels.buffer, row * CELL * 4, CELL * 4).copy(Buffer.from(image.pixels.buffer, (y + row) * image.width * 4 + x * 4, CELL * 4)); } return image; }
function write(name, image) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, name), encodePng(image.width, image.height, image.pixels)); }

for (const side of ['friendly', 'enemy']) {
  write(`unit-${side}-infantry.png`, sheet('infantry', side));
  write(`unit-${side}-at-infantry.png`, sheet('at_infantry', side));
  write(`unit-${side}-mbt-hull.png`, sheet('mbt_hull', side));
  write(`unit-${side}-mbt-turret.png`, sheet('mbt_turret', side));
  write(`wreck-${side}-mbt.png`, sheet('wreck', side, 1));
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A', cell: CELL, directions: DIRECTIONS, files: fs.readdirSync(outDir).sort() }));
