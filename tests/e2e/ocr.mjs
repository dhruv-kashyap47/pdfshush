/**
 * OCR end-to-end test (2026-11-08).
 *
 * The fixture is a genuine scan: a JPEG of rendered text, wrapped in a PDF with
 * no text operators at all. That means the tool cannot pass by copying a text
 * layer -- it has to download the recognizer, read the raster, and emit an
 * invisible layer.
 *
 * The test then verifies the only claim that matters: PDF to Text, a separate
 * tool, can read the words back out of the downloaded file. It also checks the
 * privacy claim by recording every network destination, because the failure
 * this test is most valuable for is not a bad recognition -- it is a hidden
 * CDN request for a model.
 *
 * Run with the dev server up:
 *   pnpm dev
 *   pnpm test:e2e:ocr
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');
const require = createRequire(path.join(ROOT, 'packages', 'pdf-core', 'package.json'));

/* ---------------------------------------------------------------- fixture */

/** Wraps one DCTDecode image in a one-page PDF. No text layer by construction. */
function buildScannedPdf(jpeg, width, height) {
  const imageDict =
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`;
  const objects = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3:
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ` +
      `/Resources << /XObject << /Im1 5 0 R >> >> >>`,
  };

  const content = `q 595 0 0 842 0 0 cm /Im1 Do Q`;
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let num = 1; num <= 4; num += 1) {
    offsets[num] = Buffer.byteLength(body, 'latin1');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  offsets[5] = Buffer.byteLength(body, 'latin1');
  body += `5 0 obj\n${imageDict}\nstream\n`;
  body = Buffer.concat([
    Buffer.from(body, 'latin1'),
    jpeg,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);

  const xrefStart = body.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let num = 1; num <= 5; num += 1) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(xref, 'latin1')]);
}

/** A real JPEG scan: black text on white, rendered at ~200 dpi. */
function buildScanImage() {
  const { createCanvas } = require('@napi-rs/canvas');
  const width = 1700;
  const height = 2404;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';

  ctx.font = 'bold 84px Arial';
  ctx.fillText('INVOICE 2026', 150, 220);
  ctx.font = '52px Arial';
  ctx.fillText('ACME SUPPLIES LTD', 150, 350);
  ctx.fillText('PAID IN FULL', 150, 430);
  ctx.font = 'bold 64px Arial';
  ctx.fillText('TOTAL 42', 150, 560);

  return { jpeg: canvas.toBuffer('image/jpeg', 92), width, height };
}

/** A plain text PDF, used to prove already-searchable pages are not re-OCR'd. */
function buildTextPdf() {
  const stream = `BT /F1 24 Tf 72 700 Td (Already searchable document) Tj ET`;
  const objects = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  };

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let num = 1; num <= 5; num += 1) {
    offsets[num] = Buffer.byteLength(body, 'latin1');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let num = 1; num <= 5; num += 1) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

/**
 * Vite optimizes newly discovered dependencies on first load and then reloads
 * the page. That reload would discard a file uploaded a moment earlier, so let
 * the optimizer settle before the test starts driving the tool.
 */
async function open(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2_500);
  await page.waitForLoadState('networkidle');
}

async function download(page) {
  const [event] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  return { bytes: await readFile(await event.path()), name: event.suggestedFilename() };
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').toUpperCase();
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const scan = buildScanImage();
  const scanPath = path.join(FIXTURES, 'ocr-scan.pdf');
  await writeFile(scanPath, buildScannedPdf(scan.jpeg, scan.width, scan.height));
  const textPath = path.join(FIXTURES, 'ocr-text.pdf');
  await writeFile(textPath, buildTextPdf());

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const externalRequests = [];
  const modelRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== new URL(BASE).origin) externalRequests.push(request.url());
    if (url.pathname.includes('/tessdata/')) modelRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().includes('/tessdata/') && response.status() !== 200) {
      consoleErrors.push(`model fetch ${response.status()}: ${response.url()}`);
    }
  });

  try {
    console.log('\n1. Recognize a real scanned page');
    await open(page, '/tools/ocr-pdf');
    await page.locator('input[type="file"]').setInputFiles([scanPath]);

    const run = page.getByRole('button', { name: 'Make searchable' });
    await waitFor(async () => run.isEnabled(), 60_000, 'OCR run button');
    // Recognition downloads ~15 MB on a cold profile and runs WebAssembly.
    await run.click();

    const summary = page.locator('[data-testid="ocr-summary"]');
    await summary.waitFor({ timeout: 300_000 });
    const summaryText = (await summary.textContent()) ?? '';
    console.log(`  ${summaryText.replace(/\s+/g, ' ').trim()}`);
    check('the scanned page was recognized', /Recognized 1 page/i.test(summaryText), summaryText);
    check('words were found', !/^0 words/.test(summaryText.trim()), summaryText);

    const confidence = Number(summaryText.match(/average confidence (\d+)%/)?.[1] ?? '0');
    check('recognition confidence is plausible', confidence >= 60 && confidence <= 100, `${confidence}%`);

    check('the model came from this origin', modelRequests.length > 0, modelRequests[0] ?? 'none');
    check(
      'no request left this origin (including the OCR model)',
      externalRequests.length === 0,
      externalRequests.slice(0, 3).join(', ') || '0 external',
    );

    const output = await download(page);
    check('output is a valid PDF', output.bytes.subarray(0, 5).toString('latin1') === '%PDF-');
    check('output keeps the scan as a JPEG', output.bytes.includes('DCTDecode'));
    check('output name ends in -ocr.pdf', output.name.endsWith('-ocr.pdf'), output.name);
    await page.screenshot({ path: path.join(ARTIFACTS, 'ocr-result.png') });

    console.log('\n2. A separate tool must read the hidden text back out');
    const roundTripPath = path.join(FIXTURES, 'ocr-roundtrip.pdf');
    await writeFile(roundTripPath, output.bytes);

    await open(page, '/tools/pdf-to-text');
    await page.locator('input[type="file"]').setInputFiles([roundTripPath]);
    await page.getByRole('button', { name: 'Extract text' }).click();
    const pre = page.locator('pre');
    await pre.waitFor({ timeout: 120_000 });
    const extracted = normalize((await pre.textContent()) ?? '');
    console.log(`  extracted: ${extracted.slice(0, 160)}`);
    check('the text layer holds the invoice number', extracted.includes('INVOICE 2026'), extracted.slice(0, 80));
    check('the text layer holds the total', extracted.includes('TOTAL 42'));
    check('words stay separated', extracted.includes('PAID IN FULL'));

    console.log('\n3. A page that is already searchable is kept, not re-recognized');
    await open(page, '/tools/ocr-pdf');
    await page.locator('input[type="file"]').setInputFiles([textPath]);
    const secondRun = page.getByRole('button', { name: 'Make searchable' });
    await waitFor(async () => secondRun.isEnabled(), 60_000, 'second OCR run button');
    await secondRun.click();
    const secondSummary = page.locator('[data-testid="ocr-summary"]');
    await secondSummary.waitFor({ timeout: 120_000 });
    const keptText = (await secondSummary.textContent()) ?? '';
    console.log(`  ${keptText.replace(/\s+/g, ' ').trim()}`);
    check('the text page was not recognized again', /No page needed recognition/i.test(keptText));
    check('it is reported as kept', /kept 1 page/i.test(keptText));

    const keptDownload = await download(page);
    check('the kept page keeps its original text objects', !keptDownload.bytes.includes('DCTDecode'));

    check(
      'still no request left this origin after the whole flow',
      externalRequests.length === 0,
      externalRequests.slice(0, 3).join(', ') || '0 external',
    );
  } finally {
    const errors = consoleErrors.filter(
      (text) => !text.includes('favicon') && !text.includes('Failed to load resource'),
    );
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
  console.log('\n=== OCR e2e: all checks passed ===');
}

await main();
