/**
 * Regenerates every raster icon from the brand artwork.
 *
 * Why this exists: the mark is a raster painting (soft gradients, a folded
 * "ps" monogram with its own light), so there is no vector master to draw an
 * icon from. One cropped 512px master is committed at
 * `apps/web/src/assets/brand/favicon-master.png` — the artwork's card, cut from
 * the 2752x1536 source at (821, 213)-(1931, 1324) and resampled once — and every
 * shipped icon is derived from it here, so the tab, the installed app and the
 * iOS home screen can never drift from each other or from the artwork.
 *
 * Why a real ICO: Google Search only accepts BMP, GIF, ICO, PNG, JPEG, PPM and
 * TIFF favicons, and a site whose `/favicon.ico` falls through to the SPA shell
 * shows the generic globe next to its result. The ICO embeds PNG payloads
 * (Vista+ and every current browser and crawler read that form) at the four
 * sizes an icon is actually used at: 16 and 32 in a tab, 48 on a desktop
 * shortcut, 64 for search and bookmark surfaces.
 *
 * Two shapes come out of the master:
 *  - the card: the rounded tile on transparency, which is what a browser tab or
 *    a bookmark wants, because it sits on the browser's own surface;
 *  - the padded card: the same card, scaled down and then grown back out to a
 *    full square by continuing its own edge colours, which is what a masked
 *    launcher (maskable) and iOS (which paints black behind transparency) want.
 *    That keeps the monogram inside the 80% safe zone and leaves no seam.
 *
 * Run once when the mark changes and commit the output; the build never depends
 * on a native canvas module.
 *
 *   node scripts/gen-icons.mjs
 */

import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPdfCore = createRequire(path.join(ROOT, 'packages/pdf-core/package.json'));
const { createCanvas, loadImage } = requireFromPdfCore('@napi-rs/canvas');

const MASTER = path.join(ROOT, 'apps/web/src/assets/brand/favicon-master.png');
const PUBLIC = path.join(ROOT, 'apps/web/public');
const ICONS = path.join(PUBLIC, 'icons');

/**
 * The card's corner radius as a fraction of its side, measured on the artwork
 * (193px of a 1110px card). It is a proportion rather than a pixel count so the
 * corner stays the same shape at 16px and at 512px.
 */
const CORNER_RADIUS = 193 / 1110;

/**
 * How much of the square the card covers on surfaces that crop the icon. 0.95
 * keeps the monogram (0.66 of the card, measured on the artwork) inside the 80%
 * maskable safe circle, corner to corner, with a margin.
 */
const PADDED_SCALE = 0.95;

const ICO_SIZES = [16, 32, 48, 64];

function context(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** A rounded-rect path, inset so the source's antialiased edge is trimmed off. */
function cardPath(ctx, size) {
  const inset = size * 0.004;
  const x = inset;
  const y = inset;
  const w = size - inset * 2;
  const h = size - inset * 2;
  const r = Math.min(size * CORNER_RADIUS, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The artwork as a rounded card on transparency, drawn at `size`. */
function card(image, size) {
  const canvas = createCanvas(size, size);
  const ctx = context(canvas);
  ctx.drawImage(image, 0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-in';
  cardPath(ctx, size);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Grows the card out to a full, opaque square.
 *
 * A launcher that masks the icon, and iOS, both need pixels at the very corner
 * of the square: anything transparent is cropped or painted black. Rather than
 * guess a background colour and draw a visible second tile behind the card,
 * the surrounding pixels are grown from the card's own edge, one ring at a
 * time, so the padding is literally the colour the card ends on. The result is
 * the card's light continued to the edges with no seam and no flat guess.
 */
function fillToSquare(canvas) {
  const ctx = context(canvas);
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const total = width * height;

  const red = new Float32Array(total);
  const green = new Float32Array(total);
  const blue = new Float32Array(total);
  const known = new Uint8Array(total);
  let missing = 0;
  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    if (data[at + 3] > 8) {
      known[i] = 1;
    } else {
      missing += 1;
    }
    red[i] = data[at];
    green[i] = data[at + 1];
    blue[i] = data[at + 2];
  }

  // Eight neighbours, averaged from the ring finished in the previous pass, so
  // the fill spreads evenly in every direction instead of smearing one way.
  const neighbours = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  while (missing > 0) {
    const filled = [];
    for (let i = 0; i < total; i += 1) {
      if (known[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const [dx, dy] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const at = ny * width + nx;
        if (!known[at]) continue;
        r += red[at];
        g += green[at];
        b += blue[at];
        n += 1;
      }
      if (n === 0) continue;
      red[i] = r / n;
      green[i] = g / n;
      blue[i] = b / n;
      filled.push(i);
      missing -= 1;
    }
    if (filled.length === 0) break;
    for (const i of filled) known[i] = 1;
  }

  for (let i = 0; i < total; i += 1) {
    const at = i * 4;
    data[at] = red[i];
    data[at + 1] = green[i];
    data[at + 2] = blue[i];
    data[at + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** The card centred at `scale` on an opaque square, for surfaces that crop it. */
function padded(image, size, scale) {
  const canvas = createCanvas(size, size);
  const ctx = context(canvas);
  const drawn = Math.round(size * scale);
  const offset = Math.round((size - drawn) / 2);
  const art = card(image, drawn);

  ctx.drawImage(art, offset, offset);
  fillToSquare(canvas);

  // The grown ring is a diffusion, so it carries faint diagonal banding where
  // the fills met. Blurring the field flattens that out, and redrawing the
  // card on top keeps the mark itself sharp; the seam that remains reads as the
  // soft lip every icon has at its edge anyway.
  const small = createCanvas(Math.round(size / 16), Math.round(size / 16));
  const smallCtx = context(small);
  smallCtx.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.drawImage(small, 0, 0, size, size);

  ctx.drawImage(art, offset, offset);
  return canvas;
}

/**
 * ICONDIR: reserved(2) + type(2, 1 = icon) + image count(2), then one
 * ICONDIRENTRY per frame: width, height, palette, reserved, planes, bpp,
 * payload length, payload offset. A stored size of 0 means 256px.
 */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const directory = Buffer.alloc(16 * frames.length);
  let offset = header.length + directory.length;
  frames.forEach(({ size, png }, index) => {
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

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.png)]);
}

async function write(output, bytes) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(`wrote ${path.relative(ROOT, output).split(path.sep).join('/')} (${bytes.length} bytes)`);
}

const image = await loadImage(await readFile(MASTER));

const frames = [];
for (const size of ICO_SIZES) {
  frames.push({ size, png: await card(image, size).encode('png') });
}
await write(path.join(PUBLIC, 'favicon.ico'), ico(frames));

await write(path.join(ICONS, 'icon-192.png'), await card(image, 192).encode('png'));
await write(path.join(ICONS, 'icon-512.png'), await card(image, 512).encode('png'));
await write(
  path.join(ICONS, 'icon-maskable-512.png'),
  await padded(image, 512, PADDED_SCALE).encode('png'),
);
await write(
  path.join(ICONS, 'apple-touch-icon.png'),
  await padded(image, 180, PADDED_SCALE).encode('png'),
);
