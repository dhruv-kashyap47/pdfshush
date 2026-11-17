/**
 * E-05 browser E2E: upload a signature photo instead of drawing one.
 *
 * Proves the upload tab works, that paper is removed along a luminance ramp
 * (a meaningful share of the preview is transparent), and that the placed
 * signature keeps the uploaded ink's aspect rather than the pad's.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/signature-upload.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { buildPdf, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'signature-upload');

const IMAGE_W = 600;
const IMAGE_H = 160;
const INK_X0 = 80;
const INK_X1 = 520;
const INK_Y0 = 40;
const INK_Y1 = 120;

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/* ------------------------------------------------------------ PNG encoder */

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
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
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

/** White paper with a thick black squiggle: a photo-like signature on white. */
function signaturePng() {
  const stride = IMAGE_W * 4;
  const raw = Buffer.alloc((stride + 1) * IMAGE_H);
  for (let y = 0; y < IMAGE_H; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < IMAGE_W; x += 1) {
      const centre = (INK_Y0 + INK_Y1) / 2 + Math.sin((x / IMAGE_W) * Math.PI * 3) * 28;
      const ink = x >= INK_X0 && x <= INK_X1 && Math.abs(y - centre) <= 7;
      const value = ink ? 12 : 255;
      const i = row + 1 + x * 4;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(IMAGE_W, 0);
  ihdr.writeUInt32BE(IMAGE_H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'upload-signature.pdf');
  const image = path.join(WORK, 'signature-on-paper.png');
  await writeFile(fixture, buildPdf('This document may be signed.'));
  await writeFile(image, signaturePng());

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${BASE}/tools/fill-sign`, { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').first().setInputFiles([fixture]);
    await page.getByTestId('editor').waitFor({ timeout: 30_000 });

    const pageHost = page.getByTestId('editor-page').first();
    const box = await pageHost.boundingBox();
    await page.mouse.click(box.x + 220, box.y + 140);
    await page.getByTestId('signature-pad-dialog').waitFor({ timeout: 15_000 });

    await page.getByTestId('signature-tab-upload').click();
    await page.getByTestId('signature-upload-input').setInputFiles([image]);
    await page.getByTestId('signature-upload-preview').waitFor({ timeout: 15_000 });
    check('upload tab previews the chosen image', true);

    const transparency = await page.evaluate(async () => {
      const preview = document.querySelector('[data-testid="signature-upload-preview"]');
      if (!(preview instanceof HTMLImageElement)) return -1;
      await preview.decode().catch(() => undefined);
      const canvas = document.createElement('canvas');
      canvas.width = preview.naturalWidth;
      canvas.height = preview.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return -1;
      context.drawImage(preview, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 0) clear += 1;
      return clear / (data.length / 4);
    });
    check(
      'paper becomes transparent ink',
      transparency > 0.3,
      `${Math.round(transparency * 100)}% transparent`,
    );

    check('Use signature is enabled for an upload', await page.getByTestId('signature-use').isEnabled());
    await page.getByTestId('signature-use').click();

    const placed = page.getByTestId('editor-object-image').first();
    await placed.waitFor({ timeout: 15_000 });
    const placedBox = await placed.boundingBox();
    // Expected ink bounds: squiggle extent + padding, capped at 150pt wide.
    const expectedRatio = (INK_X1 - INK_X0 + 12) / (INK_Y1 - INK_Y0 + 12);
    const actualRatio = placedBox.width / placedBox.height;
    check(
      'placed signature keeps the uploaded ink aspect (not the pad aspect)',
      Math.abs(actualRatio - expectedRatio) < expectedRatio * 0.25,
      `${actualRatio.toFixed(2)} vs ${expectedRatio.toFixed(2)}`,
    );

    check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await page.screenshot({ path: path.join(WORK, 'result.png') }).catch(() => undefined);
    await browser.close();
  }

  console.log(
    `\n=== signature-upload E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('signature-upload E2E crashed:', error);
  process.exit(1);
});
