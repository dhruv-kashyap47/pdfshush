/**
 * End-to-end test for the dark-mode batch (PLAN.md changelog, 2026-10-28).
 *
 * Drives the real app in a real browser (system Edge via Playwright) and checks
 * the thing the tool actually promises: the live preview canvas shows the
 * theme remap and the inversion math on real pixels, and the downloaded file is
 * the rasterized-rebuild PDF the engine describes. Run with the dev server up:
 *
 *   pnpm dev                        # terminal 1
 *   node tests/e2e/dark-mode.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');

/* ---------------------------------------------------------------- fixtures */

/** Hand-built spec-valid PDF (same recipe as tests/support/e2e-util.mjs). */
function buildWhitePdf() {
  const stream = `BT /F1 18 Tf 72 770 Td (PDFShush dark mode) Tj ET`;
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let n = 1; n <= 5; n++) {
    offsets[n] = Buffer.byteLength(body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(body, 'latin1'), Buffer.from(xref, 'latin1')]);
}

/** One page saturated with the red primary: inversion has an unambiguous answer. */
function buildRedPdf() {
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    4: '<< /Length 31 >>\nstream\n1 0 0 rg 0 0 595 842 re f\nendstream',
  };
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let n = 1; n <= 4; n++) {
    offsets[n] = Buffer.byteLength(body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 5\n0000000000 65535 f \n`;
  for (let n = 1; n <= 4; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
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

async function download(page, buttonName) {
  const [downloadEvent] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  const filePath = await downloadEvent.path();
  const bytes = await readFile(filePath);
  return { bytes, name: downloadEvent.suggestedFilename() };
}

const isPdf = (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';

/** Reads the top-left pixel of the live preview canvas. */
function cornerPixel(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="dark-preview-canvas"]');
    const context = canvas.getContext('2d');
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  });
}

const near = (a, b, tol) =>
  a[0] >= b[0] - tol && a[0] <= b[0] + tol && a[1] >= b[1] - tol && a[1] <= b[1] + tol && a[2] >= b[2] - tol && a[2] <= b[2] + tol;

const triple = (a) => `(${a[0]}, ${a[1]}, ${a[2]})`;

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const fileWhite = path.join(FIXTURES, 'dark-white.pdf');
  const fileRed = path.join(FIXTURES, 'dark-red.pdf');
  await writeFile(fileWhite, buildWhitePdf());
  await writeFile(fileRed, buildRedPdf());

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const openTool = async (slug) => {
    await page.goto(`${BASE}/tools/${slug}`, { waitUntil: 'networkidle' });
  };
  const upload = (file) => page.locator('input[type="file"]').setInputFiles([file]);

  try {
    /* 1. White document: theme modes */
    console.log('\n1. Dark Mode PDF (theme)');
    await openTool('dark-mode-pdf');
    await upload(fileWhite);

    const canvas = page.locator('[data-testid="dark-preview-canvas"]');
    await waitFor(async () => {
      const box = await canvas.boundingBox();
      return box !== null && box.width > 100;
    }, 60_000, 'preview canvas');
    check('live preview canvas renders page 1', true);

    await page.screenshot({ path: path.join(ARTIFACTS, 'dark-mode-preview.png') });

    // Default theme `ink`: white paper lands (near) black.
    await waitFor(async () => {
      const pixel = await cornerPixel(page);
      return pixel[0] < 40 && pixel[1] < 40 && pixel[2] < 40;
    }, 15_000, 'ink corner pixel');
    check('ink theme maps white paper to dark', true, triple(await cornerPixel(page)));

    await page.locator('[data-testid="dark-theme-midnight"]').click();
    await waitFor(async () => near(await cornerPixel(page), [25, 30, 45], 20), 15_000, 'midnight corner pixel');
    check('midnight theme lands on its background colour', true, triple(await cornerPixel(page)));

    /* 2. Red document: hue behaviour */
    console.log('\n2. Dark Mode PDF (smart + invert on colour)');
    await upload(fileRed);
    await page.locator('[data-testid="dark-kind-smart"]').click();
    await waitFor(async () => near(await cornerPixel(page), [255, 0, 0], 25), 15_000, 'red corner pixel on smart');
    check('smart mode preserves hue (red stays red)', true, triple(await cornerPixel(page)));

    await page.locator('[data-testid="dark-kind-invert"]').click();
    await waitFor(async () => near(await cornerPixel(page), [0, 255, 255], 25), 15_000, 'cyan corner pixel on invert');
    check('invert flips the red page to cyan', true, triple(await cornerPixel(page)));

    /* 3. Run the job and inspect the download */
    console.log('\n3. Dark Mode PDF (run + download)');
    const runButton = page.getByRole('button', { name: 'Convert to dark mode' });
    await runButton.click();
    await page.getByText(/rebuilt for night reading/).waitFor({ timeout: 120_000 });
    const darkDl = await download(page, 'Download');
    check('dark-mode output is a valid PDF', isPdf(darkDl.bytes), `${darkDl.name} ${darkDl.bytes.length}B`);
    check('output is the rasterized rebuild (JPEG inside)', darkDl.bytes.includes('DCTDecode'));
    check('output name ends in -dark.pdf', darkDl.name.endsWith('-dark.pdf'), darkDl.name);
    await page.screenshot({ path: path.join(ARTIFACTS, 'dark-mode-result.png') });
  } finally {
    const errors = consoleErrors.filter((text) => !text.includes('favicon'));
    if (errors.length > 0) {
      console.log('\nBrowser console errors:');
      for (const text of errors) console.log(`  ${text}`);
      failures += errors.length;
    }
    await browser.close();
  }

  console.log(
    failures === 0 ? '\n=== dark-mode e2e: ok ===' : `\n=== dark-mode e2e: ${failures} failed ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
