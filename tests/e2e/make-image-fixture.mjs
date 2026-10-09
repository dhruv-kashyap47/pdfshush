/**
 * Builds `tests/e2e/fixtures/imaged.pdf` -- the fixture whose absence let a
 * production rendering bug ship.
 *
 * Every other PDF in this repo is pure text and vector. That is precisely why
 * pdf.js's scratch-canvas path was never exercised: it is only reached when a
 * page *paints a raster image*, and nothing here had one. A PDF with images was
 * therefore an unknown, and the editor came up blank on real-world files with no
 * test ever turning red.
 *
 * So the pages are built to force the paths that reach pdf.js's canvas factory:
 *
 *   page 1  text only            no scratch canvas -> must keep rendering
 *   page 2  large opaque image    -> image downscaling  (`_scaleImage`)
 *   page 3  large image + alpha   -> soft mask (`smaskFor`) *and* downscaling
 *
 * The images are deliberately far larger than the box they are painted into.
 * pdf.js only allocates a scratch canvas when it has to *downscale*; an image
 * painted at or below its natural size is drawn straight through. Scaling the
 * source up instead of the box down means the downscale holds at every zoom the
 * editor can reach, so the test cannot pass by accident at an unusual zoom.
 *
 * Deterministic: same inputs, same bytes, so the committed PDF stays valid and
 * regenerating it produces no spurious diff.
 *
 *   node tests/e2e/make-image-fixture.mjs
 */

import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pdf-lib is a workspace dependency of the engine, not of the root, so resolve it
// from there rather than duplicating it in a root `node_modules`.
const require = createRequire(new URL('../../packages/pdf-core/package.json', import.meta.url));
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'fixtures', 'imaged.pdf');

/** Source image size, in pixels. Large on purpose -- see the file header. */
const IMAGE_W = 1600;
const IMAGE_H = 1200;
/** Box the image is painted into, in points. Small on purpose -- ditto. */
const BOX_W = 180;
const BOX_H = 135;

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 8-bit RGBA PNG. Written by hand so the fixture needs no image asset and no
 * encoder dependency -- and so the pixels are exactly what is claimed above.
 */
function encodePng(width, height, pixelAt) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Opaque checkerboard: high-frequency, so a real downscale is obvious. */
const opaqueSwatch = (x, y) => {
  const on = ((x >> 5) + (y >> 5)) & 1;
  return on ? [214, 38, 38, 255] : [250, 204, 21, 255];
};

/** Same, with a soft radial alpha ramp: forces a soft mask as well. */
const alphaSwatch = (x, y) => {
  const on = ((x >> 5) + (y >> 5)) & 1;
  const dx = (x - IMAGE_W / 2) / (IMAGE_W / 2);
  const dy = (y - IMAGE_H / 2) / (IMAGE_H / 2);
  const alpha = Math.round(255 * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)));
  return on ? [22, 119, 190, alpha] : [255, 255, 255, alpha];
};

/* ------------------------------------------------------------------ PDF ---- */

const A4 = [595, 842];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const caption = (page, text, y) => {
  page.drawText(text, { x: 48, y, size: 14, font: bold, color: rgb(0.05, 0.05, 0.05) });
  page.drawText('PDFShush image fixture', { x: 48, y: y - 20, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
};

// Page 1: text and vector only. This is the page that rendered fine before the
// fix, and it must keep doing so -- a regression here would mean the fix broke
// the common case rather than the rare one.
const p1 = doc.addPage(A4);
caption(p1, 'Page 1 - text and vector only', 760);
p1.drawRectangle({ x: 48, y: 600, width: 300, height: 80, color: rgb(0.1, 0.45, 0.35) });
for (let i = 0; i < 12; i += 1) {
  p1.drawText(`Line ${i + 1} of vector-and-text content.`, {
    x: 48,
    y: 560 - i * 22,
    size: 12,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
}

// Page 2: opaque image, downscaled -> pdf.js `_scaleImage` -> canvas factory.
const p2 = doc.addPage(A4);
caption(p2, 'Page 2 - opaque image, downscaled', 760);
p2.drawImage(await doc.embedPng(encodePng(IMAGE_W, IMAGE_H, opaqueSwatch)), {
  x: 48,
  y: 560,
  width: BOX_W,
  height: BOX_H,
});
p2.drawText(`Source image ${IMAGE_W}x${IMAGE_H} painted into ${BOX_W}x${BOX_H} pt`, {
  x: 48,
  y: 520,
  size: 11,
  font,
  color: rgb(0.3, 0.3, 0.3),
});

// Page 3: alpha channel -> soft mask, plus the same downscale.
const p3 = doc.addPage(A4);
caption(p3, 'Page 3 - image with alpha (soft mask) + downscale', 760);
p3.drawImage(await doc.embedPng(encodePng(IMAGE_W, IMAGE_H, alphaSwatch)), {
  x: 48,
  y: 560,
  width: BOX_W,
  height: BOX_H,
});
p3.drawText('Radial alpha ramp over a checkerboard.', {
  x: 48,
  y: 520,
  size: 11,
  font,
  color: rgb(0.3, 0.3, 0.3),
});

const bytes = await doc.save();
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${bytes.length} bytes, ${doc.getPageCount()} pages)`);
