/**
 * Deskew end-to-end test (2026-11-05).
 *
 * The page is hand-built with rotated text matrices, so the raster the tool sees
 * is genuinely skewed. The test then does the only assertion that matters: after
 * one pass, feeding the output back through auto-detection must find a nearly
 * straight page. A wrong sign, a no-op or a blank raster all fail that check.
 *
 * Run with the dev server up:
 *   pnpm dev
 *   pnpm test:e2e:deskew
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');

/* ---------------------------------------------------------------- fixture */

/**
 * One page, ten text lines rotated by +4° using a text matrix. In the rendered
 * raster the rows are visibly crooked, which is what the estimator has to undo.
 */
function buildSkewedPdf(angleDeg = 4) {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians).toFixed(6);
  const sin = Math.sin(radians).toFixed(6);
  const lines = [];
  for (let index = 0; index < 10; index += 1) {
    const y = 700 - index * 58;
    lines.push(`${cos} ${sin} -${sin} ${cos} 72 ${y} Tm (Skewed scan line ${index + 1}) Tj`);
  }
  const stream = `BT /F1 24 Tf ${lines.join(' ')} ET`;
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let n = 1; n <= 5; n += 1) {
    offsets[n] = Buffer.byteLength(body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(body, 'latin1'), Buffer.from(xref, 'latin1')]);
}

/* ------------------------------------------------------------- tiny asserts */

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(fn, timeoutMs = 45_000, label = 'condition') {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function parseAngles(text) {
  return [...text.matchAll(/([-+]?\d+(?:\.\d+)?)°/g)].map((match) => Number(match[1]));
}

async function download(page) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  const bytes = await readFile(await event.path());
  return { bytes, name: event.suggestedFilename(), path: await event.path() };
}

/** Uploads, runs auto-detect, and returns the angles the tool reports. */
async function straighten(page, filePath, label) {
  await page.goto(`${BASE}/tools/deskew`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([filePath]);
  const run = page.getByRole('button', { name: 'Straighten pages' });
  await waitFor(async () => run.isEnabled(), 60_000, `${label}: run button`);
  await run.click();
  const summary = page.locator('[data-testid="deskew-angles"]');
  await summary.waitFor({ timeout: 120_000 });
  const text = (await summary.textContent()) ?? '';
  const angles = parseAngles(text);
  console.log(`  ${label}: ${text.trim()}`);
  return { text, angles };
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });
  const skewedPath = path.join(FIXTURES, 'deskew-skewed.pdf');
  await writeFile(skewedPath, buildSkewedPdf(4));

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    console.log('\n1. Deskew a +4° scan');
    const first = await straighten(page, skewedPath, 'first pass');
    check('the tool reports one detected angle', first.angles.length === 1, `${first.angles.length} angle(s)`);
    check(
      'it detects the 4° skew',
      first.angles.length === 1 && Math.abs(Math.abs(first.angles[0]) - 4) <= 1,
      `${first.angles[0]}°`,
    );

    const output = await download(page);
    check('output is a valid PDF', output.bytes.subarray(0, 5).toString('latin1') === '%PDF-', `${output.name} ${output.bytes.length}B`);
    check('output is the rasterized rebuild (JPEG inside)', output.bytes.includes('DCTDecode'));
    check('output name ends in -deskewed.pdf', output.name.endsWith('-deskewed.pdf'), output.name);
    await page.screenshot({ path: path.join(ARTIFACTS, 'deskew-result.png') });

    // The download's temp path has no `.pdf` extension, and the dropzone rejects
    // files by extension. Re-materialise it under a real PDF name for pass two.
    const roundTripPath = path.join(FIXTURES, 'deskew-roundtrip.pdf');
    await writeFile(roundTripPath, output.bytes);

    console.log('\n2. Re-open the output: it must now be straight');
    const second = await straighten(page, roundTripPath, 'second pass');
    const residual = second.angles[0] ?? 99;
    check(
      'auto-detection finds no remaining skew (≤ 1.5°)',
      second.angles.length === 1 && Math.abs(residual) <= 1.5,
      `${residual}°`,
    );

    console.log('\n3. Manual override is honoured');
    await page.goto(`${BASE}/tools/deskew`, { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles([skewedPath]);
    const run = page.getByRole('button', { name: 'Straighten pages' });
    await waitFor(async () => run.isEnabled(), 60_000, 'override: run button');
    await page.locator('[data-testid="deskew-override"]').fill('-3.5');
    await run.click();
    const summary = page.locator('[data-testid="deskew-angles"]');
    await summary.waitFor({ timeout: 120_000 });
    const text = (await summary.textContent()) ?? '';
    check('the manual angle is the one applied', /-3\.5°/.test(text), text.trim());
  } finally {
    const errors = consoleErrors.filter((text) => !text.includes('favicon'));
    if (errors.length > 0) {
      console.log('\nBrowser console errors:');
      for (const text of errors) console.log(`  ${text}`);
      failures += errors.length;
    }
    await browser.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\n=== deskew e2e: all checks passed ===');
}

await main();
