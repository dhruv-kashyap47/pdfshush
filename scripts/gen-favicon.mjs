/**
 * Generates `apps/web/public/favicon.ico` from the brand SVG.
 *
 * Why this exists: Google Search only accepts BMP, GIF, ICO, PNG, JPEG, PPM and
 * TIFF favicons. The SVG is fine for browsers, but a site that declares only
 * `/favicon.svg` (and whose `/favicon.ico` falls through to the SPA shell)
 * shows the generic globe next to its search result. The ICO is the one file
 * every crawler asks for unprompted, so it has to be a real image.
 *
 * The ICO embeds PNG payloads (Vista+ and every current browser and crawler
 * read that form), at the four sizes an icon is actually used at: 16 and 32 in
 * a tab, 48 on a desktop shortcut, 64 for search and bookmark surfaces.
 *
 * Run once when the mark changes and commit the output; the build never
 * depends on a native canvas module.
 *
 *   node scripts/gen-favicon.mjs
 */

import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPdfCore = createRequire(path.join(ROOT, 'packages/pdf-core/package.json'));
const { createCanvas, loadImage } = requireFromPdfCore('@napi-rs/canvas');

const SOURCE = path.join(ROOT, 'apps/web/public/favicon.svg');
const OUT = path.join(ROOT, 'apps/web/public/favicon.ico');
const SIZES = [16, 32, 48, 64];

const svg = await readFile(SOURCE);
const image = await loadImage(svg);

const frames = [];
for (const size of SIZES) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  frames.push(await canvas.encode('png'));
}

// ICONDIR: reserved(2) + type(2, 1 = icon) + image count(2).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);

// One ICONDIRENTRY per frame: width, height, palette, reserved, planes, bpp,
// payload length, payload offset. A stored size of 0 means 256px.
const directory = Buffer.alloc(16 * frames.length);
let offset = header.length + directory.length;
frames.forEach((png, index) => {
  const size = SIZES[index];
  const at = index * 16;
  directory.writeUInt8(size >= 256 ? 0 : size, at);
  directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
  directory.writeUInt8(0, at + 2);
  directory.writeUInt8(0, at + 3);
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(png.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += png.length;
});

await writeFile(OUT, Buffer.concat([header, directory, ...frames]));
console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZES.join(', ')}px)`);
