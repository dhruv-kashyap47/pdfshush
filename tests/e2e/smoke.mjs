/**
 * Phase 0 end-to-end smoke test.
 *
 * Drives the real app in a real browser (system Edge via Playwright) and runs
 * all three live tools against generated PDF fixtures, asserting on actual
 * downloaded bytes. Run with the dev server up:
 *
 *   pnpm dev            # terminal 1
 *   node tests/e2e/smoke.mjs
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

/** Builds a minimal, spec-valid PDF with `pageCount` blank pages. */
function buildPdf(pageCount, label) {
  const objects = [];
  const kids = [];
  const pageObjNums = [];

  // obj numbers: 1=catalog, 2=pages, then per page: page obj + contents obj
  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = next++;
    const contentObj = next++;
    pageObjNums.push({ pageObj, contentObj, index: i });
    kids.push(`${pageObj} 0 R`);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;

  for (const { pageObj, contentObj, index } of pageObjNums) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${next} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}) Tj ET`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[next] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let body = '%PDF-1.4\n';
  const offsets = [0];
  const total = next;
  for (let num = 1; num <= total; num += 1) {
    offsets[num] = Buffer.byteLength(body, 'latin1');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= total; num += 1) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body, 'latin1');
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

async function downloadAndAssert(page, buttonName, kind) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  const filePath = await download.path();
  const bytes = await readFile(filePath);
  const head = bytes.subarray(0, 5).toString('latin1');
  const headZip = bytes.subarray(0, 2).toString('latin1');
  if (kind === 'pdf') {
    return { ok: head === '%PDF-', bytes, name: download.suggestedFilename() };
  }
  return { ok: headZip === 'PK', bytes, name: download.suggestedFilename() };
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const pdfA = buildPdf(3, 'PDFShush A');
  const pdfB = buildPdf(2, 'PDFShush B');
  const fileA = path.join(FIXTURES, 'alpha.pdf');
  const fileB = path.join(FIXTURES, 'beta.pdf');
  await writeFile(fileA, pdfA);
  await writeFile(fileB, pdfB);

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  /* 1. Homepage */
  console.log('\n1. Homepage');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('title contains PDFShush', (await page.title()).includes('PDFShush'));
  check('hero renders', await page.getByText('without the upload.').isVisible());
  await page.getByRole('button', { name: /All Tools/ }).hover();
  await waitFor(async () => (await page.getByText('Bates Numbering').count()) > 0, 10_000, 'mega menu');
  check('mega menu opens with full catalog', true);
  await page.screenshot({ path: path.join(ARTIFACTS, 'home-megamenu.png') });
  await page.mouse.move(720, 600);

  /* 2. Merge */
  console.log('\n2. Merge tool');
  await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA, fileB]);
  await waitFor(async () => (await page.getByText('3 pages').count()) > 0, 30_000, 'page counts');
  check('page counts shown (3p + 2p)', true);
  await page.getByRole('button', { name: /Merge 2 files/ }).click();
  await page.getByText('merged.pdf').waitFor({ timeout: 60_000 });
  check('result panel shows merged.pdf', true);
  const mergeDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('downloaded file is a valid PDF', mergeDl.ok, `${mergeDl.name} ${mergeDl.bytes.length}B`);
  await page.screenshot({ path: path.join(ARTIFACTS, 'merge-result.png') });

  /* 3. Organize */
  console.log('\n3. Organize tool');
  await page.goto(`${BASE}/tools/organize-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 3, 60_000, '3 thumbnails');
  check('thumbnails rendered in worker (3 pages)', true);
  check(
    'thumbnails are real images',
    await page.locator('img[alt="Page 1"]').evaluate((img) => img.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'organize-grid.png') });

  await page.getByRole('button', { name: 'Delete page' }).nth(1).click();
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 2, 10_000, '2 thumbnails');
  check('delete page works (3 → 2)', true);

  await page.getByRole('button', { name: /Save 2 pages/ }).click();
  await page.getByText('-organized.pdf').waitFor({ timeout: 60_000 });
  const orgDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('organized output is a valid PDF', orgDl.ok, `${orgDl.name} ${orgDl.bytes.length}B`);

  /* 4. PDF to JPG */
  console.log('\n4. PDF to JPG tool');
  await page.goto(`${BASE}/tools/pdf-to-jpg`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByText(/will produce 3 images/).count()) > 0,
    30_000,
    'options panel',
  );
  check('inspect shows 3 pages / 3 images', true);
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await page.getByText('Download ZIP').waitFor({ timeout: 90_000 });
  await waitFor(async () => (await page.locator('figure img').count()) === 3, 30_000, '3 previews');
  check('image previews rendered (3 pages)', true);
  check(
    'JPG format actually produces .jpg files',
    (await page.getByText('alpha-1.jpg').count()) > 0,
    'caption check',
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'pdf-to-jpg-result.png') });
  const imgDl = await downloadAndAssert(page, 'Download ZIP', 'zip');
  check('ZIP download valid (PK header)', imgDl.ok, `${imgDl.name} ${imgDl.bytes.length}B`);

  /* 5. Planned tool page + 404 */
  console.log('\n5. Routing');
  await page.goto(`${BASE}/tools/compress-pdf`, { waitUntil: 'networkidle' });
  check('planned tool page renders', await page.getByText('In development').isVisible());
  await page.goto(`${BASE}/tools/does-not-exist`, { waitUntil: 'networkidle' });
  check('404 page renders', await page.getByText('This page went missing').isVisible());

  /* console health */
  console.log('\n6. Console health');
  const fatal = consoleErrors.filter(
    (text) => !text.includes('favicon') && !text.includes('Download the React DevTools'),
  );
  check('no console/page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  await browser.close();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E run failed:', error);
  process.exit(1);
});
