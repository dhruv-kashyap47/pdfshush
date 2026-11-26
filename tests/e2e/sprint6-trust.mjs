/**
 * Sprint 6 browser E2E: OCR inside the editor, export trust and the no-change
 * guard.
 *
 * The OCR fixture is a real scan (a JPEG of rendered text, no text operators),
 * so the text layer cannot be copied from anywhere. The assertions read the
 * downloaded bytes back and record every network destination.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/sprint6-trust.mjs
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from '../../apps/web/node_modules/@cantoo/pdf-lib/es/index.js';
import { buildPdf, extractText, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'sprint6-trust');
const require = createRequire(path.join(HERE, '..', '..', 'packages', 'pdf-core', 'package.json'));

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks += 1;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

function scanJpeg() {
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
  ctx.font = 'bold 64px Arial';
  ctx.fillText('TOTAL 42', 150, 560);
  return canvas.toBuffer('image/jpeg', 92);
}

async function writeScanFixture() {
  const jpeg = scanJpeg();
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  for (let index = 0; index < 2; index += 1) {
    const page = doc.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  const file = path.join(WORK, 'sprint6-scan.pdf');
  await writeFile(file, await doc.save({ useObjectStreams: false }));
  return file;
}

async function openEditor(page, fixture) {
  await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
  // Vite may optimize dependencies on first load and reload the page, which
  // would discard a file chosen a moment earlier.
  await page.waitForTimeout(2_500);
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor');
  await waitFor(
    async () => (await page.getByTestId('editor-page-0').count()) === 1,
    60_000,
    'first page',
  );
}

async function saveAndDownload(page, expectedName) {
  await page.getByTestId('editor-save').click();
  await waitFor(
    async () => (await page.getByText(expectedName).count()) > 0,
    120_000,
    'saved result',
  );
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  return readFile(await download.path());
}

async function poolStats(page) {
  return page.evaluate(() => {
    const probe = window.__pdfshushPool;
    return probe ? probe.stats() : null;
  });
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const scanPath = await writeScanFixture();
  const textPath = path.join(WORK, 'sprint6-text.pdf');
  await writeFile(textPath, buildPdf('Sprint six trust fixture'));

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__PDFSHUSH_TEST__ = true;
  });

  const consoleErrors = [];
  const externalRequests = [];
  const modelRequests = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !/Failed to load resource|net::|ERR_|favicon/i.test(message.text())
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== new URL(BASE).origin) externalRequests.push(request.url());
    if (url.pathname.includes('/tessdata/')) modelRequests.push(request.url());
  });

  try {
    console.log('\n1. A scan in the editor offers OCR and keeps the page');
    await openEditor(page, scanPath);
    const banner = page.getByTestId('ocr-scan-banner');
    await banner.waitFor({ timeout: 60_000 });
    check('the scan is detected and the offer is explicit', (await banner.innerText()).includes('This page is a scan'));
    check('nothing is saved before OCR or an edit', await page.getByTestId('editor-save').isDisabled());

    await page.getByTestId('ocr-read-page').click();
    await page.getByTestId('ocr-progress').waitFor({ timeout: 30_000 });
    const provenance = page.getByTestId('ocr-provenance');
    await provenance.waitFor({ timeout: 300_000 });
    const provenanceText = await provenance.innerText();
    check('OCR reports page confidence', /% mean confidence/i.test(provenanceText), provenanceText);
    check('the copy asks the user to check the text', /check the text/i.test(provenanceText));
    check('the scan model came from this origin', modelRequests.length > 0, modelRequests[0] ?? 'none');
    check(
      'no request left this origin during editor OCR',
      externalRequests.length === 0,
      externalRequests.slice(0, 3).join(', ') || '0 external',
    );
    check('OCR makes the document saveable', !(await page.getByTestId('editor-save').isDisabled()));

    // OCR the second scan page, then return to the first: its confidence must
    // survive the second run rather than being cleared by the cache invalidation.
    await page.getByTestId('editor-page-1').scrollIntoViewIfNeeded();
    await page.getByTestId('editor-page-1').click({ position: { x: 90, y: 90 } });
    await waitFor(
      async () => (await page.getByTestId('ocr-scan-banner').count()) === 1,
      30_000,
      'second scan banner',
    );
    // The button unmounts as soon as OCR starts; a normal click can lose the
    // node between pointerdown and pointerup. Dispatch the click in one turn.
    await page
      .getByTestId('ocr-read-page')
      .evaluate((element) => element.click());
    await waitFor(
      async () => (await page.getByTestId('ocr-provenance').count()) === 1,
      300_000,
      'second OCR provenance',
    );

    await page.getByTestId('editor-page-0').scrollIntoViewIfNeeded();
    await page.getByTestId('editor-page-0').click({ position: { x: 90, y: 90 } });
    await waitFor(
      async () => (await page.getByTestId('ocr-provenance').count()) === 1,
      30_000,
      'first OCR provenance after second run',
    );
    check(
      'the first page keeps its confidence after a second OCR run',
      /% mean confidence/i.test(await page.getByTestId('ocr-provenance').innerText()),
    );

    const ocrBytes = await saveAndDownload(page, '-edited.pdf');
    check('the OCR output is a PDF', ocrBytes.subarray(0, 5).toString('latin1') === '%PDF-');
    const extracted = (await extractText(ocrBytes)).replace(/\s+/g, ' ');
    check('the downloaded file carries the OCR words', /INVOICE 2026/i.test(extracted), extracted.slice(0, 120));
    check('the total is searchable too', /TOTAL 42/i.test(extracted));

    const receipt = page.getByTestId('edit-receipt-stats');
    await receipt.waitFor({ timeout: 15_000 });
    const receiptText = await receipt.innerText();
    check('an OCR-only export still gets a receipt', /page/i.test(receiptText), receiptText.slice(0, 120));
    const verification = await page.getByTestId('edit-receipt').innerText();
    check(
      'the receipt does not claim verification never ran',
      !/No verification checks were run/i.test(verification),
      verification.slice(0, 160),
    );
    check('the receipt counts the OCR pages', /2 OCR pages/i.test(verification), verification.slice(0, 160));
    const idle = await waitFor(async () => {
      const stats = await poolStats(page);
      return stats && stats.busy === 0 && stats.queued === 0 ? stats : null;
    }, 30_000, 'OCR worker idle');
    check('the OCR job is no longer running', idle.busy === 0 && idle.queued === 0, JSON.stringify(idle));

    console.log('\n2. Object-only exports: guard, receipt, untouched text');
    await openEditor(page, textPath);
    check('a freshly opened document cannot be saved', await page.getByTestId('editor-save').isDisabled());
    await page.getByTestId('editor-tool-check').click();
    const box = await page.getByTestId('editor-page-0').boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
    await waitFor(
      async () => (await page.getByTestId('editor-object-check').count()) === 1,
      10_000,
      'check object',
    );
    check('placing an object enables Save', !(await page.getByTestId('editor-save').isDisabled()));

    const objectBytes = await saveAndDownload(page, '-edited.pdf');
    const objectReceipt = page.getByTestId('edit-receipt-stats');
    await objectReceipt.waitFor({ timeout: 15_000 });
    const objectReceiptText = await objectReceipt.innerText();
    check('an object-only export reports its stats', /object.*drawn/i.test(objectReceiptText), objectReceiptText);
    const objectVerification = page.getByTestId('edit-receipt').innerText();
    check(
      'object-only verification is a real check, not an empty verdict',
      /checks passed/i.test(await objectVerification),
    );
    const objectText = (await extractText(objectBytes)).replace(/\s+/g, ' ');
    check('an untouched page keeps its text', /Sprint six trust fixture/i.test(objectText), objectText.slice(0, 80));

    check(
      'still no request left this origin',
      externalRequests.length === 0,
      externalRequests.slice(0, 3).join(', ') || '0 external',
    );
  } finally {
    if (consoleErrors.length > 0) {
      console.log('\nBrowser console errors:');
      for (const text of consoleErrors.slice(0, 10)) console.log(`  ${text}`);
      failures += consoleErrors.length;
    }
    await browser.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed (${checks} total)`);
    process.exit(1);
  }
  console.log(`\n=== Sprint 6 trust e2e: ${checks} checks passed ===`);
}

await main();
