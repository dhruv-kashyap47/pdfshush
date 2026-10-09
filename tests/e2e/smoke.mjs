/**
 * End-to-end smoke test (P0-P2: all 14 live tools, incl. the editor).
 *
 * Drives the real app in a real browser (system Edge via Playwright) and runs
 * every live tool against generated PDF fixtures, asserting on actual
 * downloaded bytes. Run with the dev server up:
 *
 *   pnpm dev            # terminal 1
 *   node tests/e2e/smoke.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
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

/** Builds a valid `size`x`size` opaque PNG, for the editor image-insert flow. */
function buildPng(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // One filter byte per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 40 + ((x * 37) % 200);
      raw[p + 1] = 90 + ((y * 23) % 150);
      raw[p + 2] = 200;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  const megaVisible = await waitFor(
    async () => (await page.getByText('Bates Numbering').count()) > 0,
    10_000,
    'mega menu',
  );
  const catalogLinks = await page.locator('a[href^="/tools/"]').count();
  check(
    'mega menu opens with full catalog',
    megaVisible === true && catalogLinks >= 40,
    `${catalogLinks} tool links`,
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'home-megamenu.png') });
  await page.mouse.move(720, 600);

  /* 2. Merge */
  console.log('\n2. Merge tool');
  await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA, fileB]);
  const threePageRows = await waitFor(
    async () => (await page.getByText('3 pages').count()) > 0,
    30_000,
    'page counts',
  );
  const twoPageRows = await page.getByText('2 pages').count();
  check(
    'page counts shown (3p + 2p)',
    threePageRows === true && twoPageRows > 0,
    `${twoPageRows} row(s) showing "2 pages"`,
  );
  await page.getByRole('button', { name: /Merge 2 files/ }).click();
  await page.getByText('merged.pdf').first().waitFor({ timeout: 60_000 });
  const mergedLabel = await page.getByText('merged.pdf').first().textContent();
  check('result panel shows merged.pdf', /merged\.pdf/.test(mergedLabel ?? ''), mergedLabel ?? '');
  const mergeDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('downloaded file is a valid PDF', mergeDl.ok, `${mergeDl.name} ${mergeDl.bytes.length}B`);
  await page.screenshot({ path: path.join(ARTIFACTS, 'merge-result.png') });

  /* 3. Organize */
  console.log('\n3. Organize tool');
  await page.goto(`${BASE}/tools/organize-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const organizedThumbs = await waitFor(
    async () => {
      const n = await page.locator('img[alt^="Page "]').count();
      return n === 3 ? n : null;
    },
    60_000,
    '3 thumbnails',
  );
  check('thumbnails rendered in worker (3 pages)', organizedThumbs === 3, `${organizedThumbs} thumbnails`);
  check(
    'thumbnails are real images',
    await page.locator('img[alt="Page 1"]').evaluate((img) => img.naturalWidth > 0),
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'organize-grid.png') });

  await page.getByRole('button', { name: 'Delete page' }).nth(1).click();
  const afterMarkDelete = await waitFor(
    async () => {
      const n = await page.locator('img[alt^="Page "]').count();
      return n === 2 ? n : null;
    },
    10_000,
    '2 thumbnails',
  );
  check('delete page works (3 → 2)', afterMarkDelete === 2, `${afterMarkDelete} thumbnails`);

  await page.getByRole('button', { name: /Save 2 pages/ }).click();
  await page.getByText('-organized.pdf').waitFor({ timeout: 60_000 });
  const orgDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('organized output is a valid PDF', orgDl.ok, `${orgDl.name} ${orgDl.bytes.length}B`);
  check('organize output is named -organized.pdf', orgDl.name.endsWith('-organized.pdf'), orgDl.name);

  /* 4. PDF to JPG */
  console.log('\n4. PDF to JPG tool');
  await page.goto(`${BASE}/tools/pdf-to-jpg`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const imgEstimate = await waitFor(
    async () => page.getByText(/will produce 3 images/).first().textContent(),
    30_000,
    'options panel',
  );
  check('inspect shows 3 pages / 3 images', /3 images/.test(imgEstimate ?? ''), imgEstimate ?? '');
  await page.getByRole('button', { name: 'Convert to JPG' }).click();
  await page.getByText('Download ZIP').waitFor({ timeout: 90_000 });
  const previewCount = await waitFor(
    async () => {
      const n = await page.locator('figure img').count();
      return n === 3 ? n : null;
    },
    30_000,
    '3 previews',
  );
  check('image previews rendered (3 pages)', previewCount === 3, `${previewCount} previews`);
  check(
    'JPG format actually produces .jpg files',
    (await page.getByText('alpha-1.jpg').count()) > 0,
    'caption check',
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'pdf-to-jpg-result.png') });
  const imgDl = await downloadAndAssert(page, 'Download ZIP', 'zip');
  check('ZIP download valid (PK header)', imgDl.ok, `${imgDl.name} ${imgDl.bytes.length}B`);

  /* 5. Delete Pages */
  console.log('\n5. Delete Pages tool');
  await page.goto(`${BASE}/tools/delete-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 3, 60_000, '3 thumbnails');
  await page.getByRole('button', { name: 'Mark page 2 for deletion' }).click();
  const remainText = await waitFor(
    async () => page.getByText(/will remain/).first().textContent(),
    5_000,
    'marking feedback',
  );
  // One of three pages is marked, so two must remain.
  check('marking a page shows remain count', /\b2\b/.test(remainText ?? ''), remainText ?? '');
  await page.screenshot({ path: path.join(ARTIFACTS, 'delete-pages-marked.png') });
  await page.getByRole('button', { name: /Delete selected/ }).click();
  const afterDeleteSelected = await waitFor(
    async () => {
      const n = await page.locator('img[alt^="Page "]').count();
      return n === 2 ? n : null;
    },
    10_000,
    '2 thumbnails after delete',
  );
  check(
    'delete selected removes marked page (3 → 2)',
    afterDeleteSelected === 2,
    `${afterDeleteSelected} thumbnails`,
  );
  await page.getByRole('button', { name: /Save 2 pages/ }).click();
  // Regression: all three grid tools run the same `organize` job, and without an
  // explicit outputName it fell back to its own default -- so deleting pages
  // produced "-organized.pdf".
  await page.getByText('-deleted.pdf').waitFor({ timeout: 60_000 });
  const delDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('delete output is a valid PDF', delDl.ok, `${delDl.name} ${delDl.bytes.length}B`);
  check('delete output is named -deleted.pdf', delDl.name.endsWith('-deleted.pdf'), delDl.name);

  /* 6. Extract Pages */
  console.log('\n6. Extract Pages tool');
  await page.goto(`${BASE}/tools/extract-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const extractDefault = await waitFor(
    async () => page.getByText(/will extract 3 pages/).first().textContent(),
    30_000,
    'extract options',
  );
  check('inspect shows extract-all by default', /3 pages/.test(extractDefault ?? ''), extractDefault ?? '');
  await page.getByLabel('Pages to extract').fill('1-2');
  const extractRecount = await waitFor(
    async () => page.getByText(/will extract 2 pages/).first().textContent(),
    5_000,
    'range recount',
  );
  check('range 1-2 recounts output (3 → 2)', /2 pages/.test(extractRecount ?? ''), extractRecount ?? '');
  await page.getByRole('button', { name: /Extract 2 pages/ }).click();
  await page.getByText('-extracted.pdf').waitFor({ timeout: 60_000 });
  const extDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('extracted output is a valid PDF', extDl.ok, `${extDl.name} ${extDl.bytes.length}B`);

  /* 7. Rotate */
  console.log('\n7. Rotate tool');
  await page.goto(`${BASE}/tools/rotate-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 3, 60_000, '3 thumbnails');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();
  const oneRotated = await waitFor(
    async () => page.getByText(/1 rotated/).first().textContent(),
    5_000,
    'rotation feedback',
  );
  check('per-page rotation tracked (1 rotated)', /1 rotated/.test(oneRotated ?? ''), oneRotated ?? '');
  await page.getByRole('button', { name: 'Rotate all pages right' }).click();
  const allRotated = await waitFor(
    async () => page.getByText(/[34] rotated/).first().textContent(),
    5_000,
    'rotate all',
  );
  check(
    'rotate-all turns remaining pages too',
    /[34] rotated/.test(allRotated ?? '') && !/1 rotated/.test(allRotated ?? ''),
    allRotated ?? '',
  );
  await page.getByRole('button', { name: /Save 3 pages/ }).click();
  // Same shared-job fallback as Delete Pages: rotating produced "-organized.pdf".
  await page.getByText('-rotated.pdf').waitFor({ timeout: 60_000 });
  const rotDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('rotated output is a valid PDF', rotDl.ok, `${rotDl.name} ${rotDl.bytes.length}B`);
  check('rotate output is named -rotated.pdf', rotDl.name.endsWith('-rotated.pdf'), rotDl.name);

  /* 8. Split by pages */
  console.log('\n8. Split by pages tool');
  await page.goto(`${BASE}/tools/split-by-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const partsEstimate = await waitFor(
    async () => page.getByText(/will produce 3 files/).first().textContent(),
    30_000,
    'part estimate',
  );
  check('chunk=1 estimates 3 parts', /3 files/.test(partsEstimate ?? ''), partsEstimate ?? '');
  await page.getByRole('button', { name: /Split into 3 files/ }).click();
  await page.getByText('alpha-split.zip').waitFor({ timeout: 60_000 });
  check('split ZIP names parts', (await page.getByText('alpha-part-1.pdf').count()) > 0);
  const splitDl = await downloadAndAssert(page, 'Download ZIP', 'zip');
  check('split download is a valid ZIP', splitDl.ok, `${splitDl.name} ${splitDl.bytes.length}B`);

  /* 9. Alternate & Mix */
  console.log('\n9. Alternate & Mix tool');
  await page.goto(`${BASE}/tools/alternate-mix`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA, fileB]);
  const interleave = await waitFor(
    async () => page.getByText('A1, B1, A2, B2, A3, …').first().textContent(),
    30_000,
    'interleave pattern',
  );
  check(
    'interleave pattern preview shown',
    /A1,\s*B1,\s*A2,\s*B2,\s*A3/.test(interleave ?? ''),
    interleave ?? '',
  );
  await page.getByRole('button', { name: /Mix 5 pages/ }).click();
  await page.getByText('-mixed.pdf').waitFor({ timeout: 60_000 });
  const mixDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('mixed output is a valid PDF', mixDl.ok, `${mixDl.name} ${mixDl.bytes.length}B`);

  /* 10. Split in half */
  console.log('\n10. Split in half tool');
  await page.goto(`${BASE}/tools/split-in-half`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByRole('button', { name: /Split in half/ }).count()) > 0,
    30_000,
    'split form',
  );
  await page.getByRole('button', { name: /Split in half/ }).click();
  await page.getByText('alpha-halves.zip').waitFor({ timeout: 60_000 });
  check(
    'halves ZIP lists left/right parts',
    (await page.getByText('alpha-left.pdf and alpha-right.pdf').count()) > 0,
  );
  const halfDl = await downloadAndAssert(page, 'Download ZIP', 'zip');
  check('halves download is a valid ZIP', halfDl.ok, `${halfDl.name} ${halfDl.bytes.length}B`);

  /* 11. Page Numbers */
  console.log('\n11. Page Numbers tool');
  await page.goto(`${BASE}/tools/page-numbers`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByText(/3 pages · stamping every page/).count()) > 0,
    30_000,
    'stamp form',
  );
  await page.getByRole('button', { name: 'Add page numbers' }).click();
  await page.getByText('-numbered.pdf').waitFor({ timeout: 60_000 });
  const numDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('numbered output is a valid PDF', numDl.ok, `${numDl.name} ${numDl.bytes.length}B`);

  /* 12. Crop */
  console.log('\n12. Crop tool');
  await page.goto(`${BASE}/tools/crop-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.locator('img[alt="Page 1 crop preview"]').count()) === 1,
    60_000,
    'crop preview',
  );
  await page.locator('#margin-left').fill('10');
  await page.screenshot({ path: path.join(ARTIFACTS, 'crop-preview.png') });
  await page.getByRole('button', { name: /Crop 3 pages/ }).click();
  await page.getByText('-cropped.pdf').waitFor({ timeout: 60_000 });
  const cropDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('cropped output is a valid PDF', cropDl.ok, `${cropDl.name} ${cropDl.bytes.length}B`);

  /* 13. Header & Footer */
  console.log('\n13. Header & Footer tool');
  await page.goto(`${BASE}/tools/header-footer`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByText(/3 pages/).count()) > 0,
    30_000,
    'stamp form',
  );
  await page.getByLabel('Header text').fill('PDFShush header');
  await page.getByRole('button', { name: 'Apply header & footer' }).click();
  await page.getByText('-header-footer.pdf').waitFor({ timeout: 60_000 });
  const hfDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('header/footer output is a valid PDF', hfDl.ok, `${hfDl.name} ${hfDl.bytes.length}B`);

  /* 14. N-up */
  console.log('\n14. N-up tool');
  await page.goto(`${BASE}/tools/n-up`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const twoUp = await waitFor(
    async () => page.getByText(/2 sheets at 2-up/).first().textContent(),
    30_000,
    'n-up estimate',
  );
  check('2-up estimate shown (3 pages → 2 sheets)', /2 sheets at 2-up/.test(twoUp ?? ''), twoUp ?? '');
  await page.getByRole('button', { name: /4-up/ }).click();
  const fourUp = await waitFor(
    async () => page.getByText(/1 sheet at 4-up/).first().textContent(),
    5_000,
    '4-up recount',
  );
  check('4-up recount (3 pages → 1 sheet)', /1 sheet at 4-up/.test(fourUp ?? ''), fourUp ?? '');
  await page.getByRole('button', { name: /Make 1 sheet/ }).click();
  await page.getByText('-4up.pdf').waitFor({ timeout: 60_000 });
  const nupDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('N-up output is a valid PDF', nupDl.ok, `${nupDl.name} ${nupDl.bytes.length}B`);

  /* 15. Edit PDF (P2 editor) */
  console.log('\n15. Edit PDF tool');
  await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
  // The editor mounts a second (image picker) file input, so pick the PDF dropzone.
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor mounted');
  check('editor mounts with toolbar', await page.getByTestId('editor-toolbar').isVisible());
  const rasterCount = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-page-raster"]').count();
      return n === 3 ? n : null;
    },
    60_000,
    '3 page rasters',
  );
  check('page rasters rendered (3 pages)', rasterCount === 3, `${rasterCount} rasters`);
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-editor.png') });

  const editorPage = page.locator('[data-testid="editor-page"][data-page-index="0"]');

  // Add text: pick the tool, drag a box, type into it, commit with blur.
  await page.getByTestId('editor-tool-text').click();
  await editorPage.scrollIntoViewIfNeeded();
  let box = await editorPage.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 330, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('editor-text-input').waitFor({ timeout: 15_000 });
  await page.getByTestId('editor-text-input').fill('Edited in the browser');
  const typedValue = await page.getByTestId('editor-text-input').inputValue();
  check('text box created and typed into', typedValue === 'Edited in the browser', typedValue);

  // Ctrl+Z inside a text box must stay a *text* undo. Text edits are applied
  // with live (no history entry of their own), so a document-level undo here
  // skipped the keystrokes and deleted the whole object instead.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check(
    'Ctrl+Z while typing does not delete the text box',
    (await page.locator('[data-testid="editor-object-text"]').count()) === 1,
  );
  await page.getByTestId('editor-tool-select').click(); // blur commits the edit

  // The text box grew to fit its content (measured like the exporter wraps).
  const textBoxHeight = await page
    .locator('[data-testid="editor-object-text"]')
    .first()
    .evaluate((element) => parseFloat(element.style.height));
  check('text box height matches its content', textBoxHeight > 15, `${textBoxHeight}px`);

  // Fit-width opening zoom, and relative zoom stepping from there.
  const fitZoom = await page.getByTestId('editor-zoom-level').textContent();
  await page.getByTestId('editor-zoom-out').click();
  const zoomedOut = await waitFor(
    async () => {
      const level = await page.getByTestId('editor-zoom-level').textContent();
      return level !== fitZoom ? level : null;
    },
    5_000,
    'zoom out changes level',
  );
  const fitPercent = Number(String(fitZoom).replace(/[^\d.]/g, ''));
  const zoomedPercent = Number(String(zoomedOut).replace(/[^\d.]/g, ''));
  check(
    'zoom steps down from the fit-width default',
    zoomedPercent < fitPercent,
    `${fitZoom} → ${zoomedOut}`,
  );
  await page.getByTestId('editor-zoom-in').click();

  // Highlight by drag.
  await page.getByTestId('editor-tool-highlight').click();
  await editorPage.scrollIntoViewIfNeeded();
  box = await editorPage.boundingBox();
  await page.mouse.move(box.x + 70, box.y + 380);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 405, { steps: 6 });
  await page.mouse.up();
  const highlightCount = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-object-highlight"]').count();
      return n === 1 ? n : null;
    },
    10_000,
    'highlight object',
  );
  check('highlight created by dragging', highlightCount === 1, `${highlightCount} highlights`);

  // Undo / redo round trip.
  await page.getByTestId('editor-undo').click();
  const highlightsAfterUndo = await waitFor(
    async () => (await page.locator('[data-testid="editor-object-highlight"]').count()) === 0,
    5_000,
    'undo drops highlight',
  );
  const highlightCountAfterUndo = await page.locator('[data-testid="editor-object-highlight"]').count();
  check(
    'undo removes the highlight',
    highlightsAfterUndo === true && highlightCountAfterUndo === 0,
    `${highlightCountAfterUndo} highlights left`,
  );
  await page.getByTestId('editor-redo').click();
  const afterRedo = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-object-highlight"]').count();
      return n === 1 ? n : null;
    },
    5_000,
    'redo restores highlight',
  );
  check('redo restores the highlight', afterRedo === 1, `${afterRedo} highlights`);

  // Select + keyboard delete + undo.
  await page.getByTestId('editor-tool-select').click();
  await page.locator('[data-testid="editor-object-text"]').click();
  await page.keyboard.press('Delete');
  const afterDeleteKey = await waitFor(
    async () => (await page.locator('[data-testid="editor-object-text"]').count()) === 0,
    5_000,
    'delete removes text',
  );
  const textCountAfterDelete = await page.locator('[data-testid="editor-object-text"]').count();
  check(
    'delete removes the selected object',
    afterDeleteKey === true && textCountAfterDelete === 0,
    `${textCountAfterDelete} text objects`,
  );
  await page.keyboard.press('Control+z');
  const afterRestoreKey = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-object-text"]').count();
      return n === 1 ? n : null;
    },
    5_000,
    'undo restores text',
  );
  check('undo restores the deleted object', afterRestoreKey === 1, `${afterRestoreKey} text object`);

  // Nudge and duplicate -- the two shortcuts every editor ships with.
  await page.locator('[data-testid="editor-object-text"]').click();
  const leftBefore = await page
    .locator('[data-testid="editor-object-text"]')
    .first()
    .evaluate((element) => parseFloat(element.style.left));
  await page.keyboard.press('ArrowRight');
  const nudgedLeft = await waitFor(
    async () => {
      const left = await page
        .locator('[data-testid="editor-object-text"]')
        .first()
        .evaluate((element) => parseFloat(element.style.left));
      return left > leftBefore ? left : null;
    },
    5_000,
    'arrow key nudges the object',
  );
  check('arrow keys nudge the selection', nudgedLeft > leftBefore, `${leftBefore} -> ${nudgedLeft}`);
  // A held arrow key must not push one undo step per repeat, or real edits get
  // buried under dozens of one-pixel steps. Assert the exact position: one
  // undo has to undo the whole burst.
  const textLeft = () =>
    page
      .locator('[data-testid="editor-object-text"]')
      .first()
      .evaluate((element) => parseFloat(element.style.left));
  await page.waitForTimeout(900); // let the previous nudge's window close
  const beforeBurst = await textLeft();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900); // let the coalescing window close
  const afterBurst = await textLeft();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const afterUndo = await textLeft();
  check(
    'a burst of arrow nudges collapses into one undo step',
    afterBurst > beforeBurst && Math.abs(afterUndo - beforeBurst) < 0.5,
    `${beforeBurst} -> ${afterBurst} -> undo -> ${afterUndo}`,
  );
  await page.keyboard.press('Control+d');
  const duplicated = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-object-text"]').count();
      return n === 2 ? n : null;
    },
    5_000,
    'duplicate inserts a second copy',
  );
  check('Ctrl+D duplicates the object', duplicated === 2, `${duplicated} text objects`);
  await page.keyboard.press('Control+z');
  const deduped = await waitFor(
    async () => {
      const n = await page.locator('[data-testid="editor-object-text"]').count();
      return n === 1 ? n : null;
    },
    5_000,
    'undo removes the duplicate',
  );
  check('undo removes the duplicate', deduped === 1, `${deduped} text object`);

  // Image objects need a blob URL that stays valid across re-renders. The URL
  // used to be minted inside `useMemo` during render, where React may discard the
  // memo's value; the cleanup then only revoked the committed copy, so a
  // discarded render leaked a URL for the tab's lifetime. Assert the *live* one
  // keeps working after an unrelated re-render, which is what an over-eager
  // revoke would break.
  const pngFixture = path.join(FIXTURES, 'swatch.png');
  await writeFile(pngFixture, buildPng(48));
  await page.getByTestId('editor-tool-image').click();
  box = await editorPage.boundingBox();
  await page.mouse.click(box.x + 120, box.y + 120);
  await page.locator('input[accept="image/png,image/jpeg"]').setInputFiles([pngFixture]);
  const imageObject = await page
    .getByTestId('editor-object-image')
    .first()
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  check('image object inserted from a PNG', imageObject === true);
  const imageRendered = async () =>
    page
      .getByTestId('editor-object-image')
      .first()
      .evaluate((el) => {
        const img = el.querySelector('img');
        return Boolean(img && img.naturalWidth > 0);
      })
      .catch(() => false);
  const imageDrew = await waitFor(imageRendered, 10_000, 'inserted image decodes');
  check('inserted image actually decodes', imageDrew === true);
  await page.getByTestId('editor-zoom-in').click();
  await page.waitForTimeout(600);
  check(
    'image blob URL survives an unrelated re-render',
    (await imageRendered()) === true,
  );
  // Remove it again so the save/export assertions below stay about one object.
  await page.getByTestId('editor-tool-select').click();
  await page.getByTestId('editor-object-image').click();
  await page.getByTestId('editor-delete').click();
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-image"]').count()) === 0,
    5_000,
    'image object removed',
  );

  // Z-order controls: select the lower object, then bring it forward.
  await page.locator('[data-testid="editor-object-text"]').click();
  const orderBefore = await page
    .locator('[data-testid^="editor-object-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.objectId));
  check('bring-forward is available on selection', await page.getByTestId('editor-bring-forward').isEnabled());
  await page.getByTestId('editor-bring-forward').click();
  const orderAfter = await page
    .locator('[data-testid^="editor-object-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.objectId));
  check('bring forward reorders the stack', orderBefore.join() !== orderAfter.join());

  // Save -> validated export -> download -> cross-pollination chips.
  await page.getByTestId('editor-save').click();
  await page.getByText('-edited.pdf').first().waitFor({ timeout: 90_000 });
  const editedLabel = await page.getByText('-edited.pdf').first().textContent();
  check(
    'result panel shows alpha-edited.pdf',
    /alpha-edited\.pdf/.test(editedLabel ?? ''),
    editedLabel ?? '',
  );
  const editDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('edited output is a valid PDF', editDl.ok, `${editDl.name} ${editDl.bytes.length}B`);
  check('cross-pollination chips shown', await page.getByTestId('next-chip-organize-pdf').isVisible());
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-result.png') });

  // Saving does not end the session: the document stays open and intact.
  await page.getByTestId('result-continue').click();
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 15_000, 'editor reopened');
  check(
    'continue editing keeps the objects',
    (await page.locator('[data-testid="editor-object-text"]').count()) === 1 &&
      (await page.locator('[data-testid="editor-object-highlight"]').count()) === 1,
  );

  // Starting over must not carry the previous document's objects into the next.
  await page.getByTestId('editor-save').click();
  await page.getByText('-edited.pdf').waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Start over' }).click();
  await waitFor(
    async () => (await page.locator('input[accept*="application/pdf"]').count()) === 1,
    15_000,
    'dropzone back',
  );
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor reopened');
  const leftoverObjects = await waitFor(
    async () => (await page.locator('[data-testid^="editor-object-"]').count()) === 0,
    5_000,
    'no leftover objects',
  );
  const leftoverCount = await page.locator('[data-testid^="editor-object-"]').count();
  check(
    'start over opens a clean document',
    leftoverObjects === true && leftoverCount === 0,
    `${leftoverCount} objects carried over`,
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-restarted.png') });

  // Swapping the file with "Change file" must re-render every page. Page
  // rasters are cached by page index, and alpha/beta share page geometry, so
  // the cache used to serve the previous document's image once the cached width
  // happened to match the new desired one. Blob URLs are minted per render, so
  // comparing them answers "was this page re-rendered?" exactly -- a pixel
  // comparison would pass on two blank white pages.
  const rasterUrls = () =>
    page.locator('[data-testid="editor-page-raster"]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('src')),
    );
  // Rasters arrive two at a time and are re-requested once the fit-width zoom
  // settles, so "loaded" is not "done". Wait for the URLs to stop changing:
  // without quiescence this check passes or fails depending on which pages
  // happened to still be queued.
  async function settledRasters() {
    let previous = await rasterUrls();
    for (let i = 0; i < 25; i += 1) {
      await page.waitForTimeout(400);
      const current = await rasterUrls();
      if (current.length > 0 && current.join('|') === previous.join('|')) return current;
      previous = current;
    }
    return previous;
  }
  await waitFor(
    async () => (await rasterUrls()).length === 3,
    60_000,
    '3 rasters before the swap',
  );
  const beforeSwap = await settledRasters();
  await page.getByRole('button', { name: 'Change file' }).click();
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fileB]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'beta loaded');
  const afterSwap = await settledRasters();
  const reused = afterSwap.filter((url) => beforeSwap.includes(url));
  check(
    'changing the file re-renders every page (no stale rasters)',
    reused.length === 0 && afterSwap.length === 2,
    reused.length === 0
      ? `${afterSwap.length} pages re-rendered`
      : `${reused.length}/${afterSwap.length} pages still showed the previous document`,
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-swapped.png') });

  /* 15b. Raster quality, and the embedded-image path */
  // Regression. Two defects hid behind "the <img> exists":
  //
  //  1. The raster budget compared a *scale* (px per point) against a pixel
  //     *width*, so every page was asked to render ~7px wide and `scaleForWidth`'s
  //     0.05 floor turned that into a 29px bitmap stretched across the column. A
  //     29px page and a correct one both satisfy "the raster element is present",
  //     which is why this suite never noticed.
  //  2. pdf.js allocates scratch canvases of its own while painting a page (image
  //     downscaling, soft masks, patterns, shadings). It defaults to a DOM-backed
  //     factory whose `globalThis.document` does not exist in a Web Worker, so
  //     every page painting an image died with "Cannot read properties of undefined
  //     (reading 'createElement')" and sat on its placeholder forever. Every other
  //     fixture in this repo is text and vector, so nothing ever reached that path.
  //
  // `fixtures/imaged.pdf` (see make-image-fixture.mjs) is the first fixture here
  // with images in it, which is the whole point: without it both bugs are untestable.
  console.log('\n15b. Raster quality + embedded-image rendering');
  const imaged = path.join(FIXTURES, 'imaged.pdf');
  if (!existsSync(imaged)) {
    check(
      'imaged.pdf fixture exists',
      false,
      'run `node tests/e2e/make-image-fixture.mjs` -- without an image-bearing PDF the ' +
        'pdf.js scratch-canvas path is never exercised and these bugs cannot be caught',
    );
  }
  const rasterDetail = () =>
    page.locator('[data-testid="editor-page-raster"]').evaluateAll((els) =>
      els.map((el) => {
        if (!el.complete || !el.naturalWidth) return { nw: 0, nh: 0, detail: 0 };
        // Sample the bitmap instead of trusting its presence: a stretched 29px
        // page and a genuinely rendered one are both "an <img> with a src".
        const factor = Math.min(1, 64 / el.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(el.naturalWidth * factor));
        canvas.height = Math.max(1, Math.round(el.naturalHeight * factor));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 4) {
          const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          sum += luma;
          sumSquares += luma * luma;
        }
        const count = data.length / 4;
        const mean = sum / count;
        return {
          nw: el.naturalWidth,
          nh: el.naturalHeight,
          detail: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)),
        };
      }),
    );
  const loadingCount = () => page.locator('[data-testid="editor-page-loading"]').count();

  const openInEditor = async (file) => {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([file]);
    await waitFor(
      async () => (await page.getByTestId('editor').count()) === 1,
      60_000,
      'editor mounted',
    );
    await waitFor(
      async () => (await page.locator('[data-testid="editor-page-raster"]').count()) > 0,
      60_000,
      'first raster',
    );
    // Quiesce before asserting: rasters arrive two at a time and are re-requested
    // once the fit-width zoom settles, so "loaded" is not "done".
    for (let i = 0; i < 25; i += 1) {
      const before = await rasterDetail();
      await page.waitForTimeout(400);
      const after = await rasterDetail();
      if (JSON.stringify(before) === JSON.stringify(after)) break;
    }
  };

  await openInEditor(existsSync(imaged) ? imaged : fileA);
  const imagedRasters = await rasterDetail();
  const imagedWidths = imagedRasters.map((r) => r.nw);
  check(
    'imaged.pdf: every page renders (the image path no longer throws)',
    imagedWidths.length === 3 && imagedWidths.every((w) => w > 0),
    `widths ${imagedWidths.join(', ')}`,
  );
  const stillLoading = await loadingCount();
  check(
    'imaged.pdf: no page is stuck on its loading placeholder',
    stillLoading === 0,
    `${stillLoading} still loading`,
  );
  check(
    'imaged.pdf: rasters are page-sized, not ~29px stretched',
    imagedWidths.every((w) => w >= 600),
    `min ${Math.min(...imagedWidths)}px`,
  );
  // A4 is 595pt wide; at fit-width the raster must exceed the page's own width.
  // The old budget produced 29px here.
  check(
    'imaged.pdf: A4 renders wider than its 595pt page box',
    imagedWidths.every((w) => w > 595),
    `${imagedWidths.join(', ')}px`,
  );
  check(
    'imaged.pdf: bitmaps contain real detail, not a flat placeholder',
    imagedRasters.some((r) => r.detail >= 8),
    `luma sd ${imagedRasters.map((r) => Math.round(r.detail)).join(', ')}`,
  );
  const imagedToasts = await page.locator('[data-sonner-toast]').allInnerTexts();
  check(
    'imaged.pdf: no "could not render page" toast',
    !imagedToasts.some((t) => /could not render/i.test(t)),
    imagedToasts.join(' / ') || 'none',
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-imaged.png') });

  // The text/vector case must not regress: it is the common one, and it was the
  // only kind of PDF this suite covered before.
  await openInEditor(fileA);
  const alphaRasters = await rasterDetail();
  check(
    'text-only PDF still renders page-sized (common case not regressed)',
    alphaRasters.length === 3 && alphaRasters.every((r) => r.nw >= 600),
    `widths ${alphaRasters.map((r) => r.nw).join(', ')}px`,
  );

  /* 16. Client page cap */
  // Regression: `checkClientCapacity` only enforces the 500-page cap when it is
  // handed a page count, and most tools passed bytes alone. A document far over
  // the cap was therefore accepted and then rendered/copied in the tab -- the
  // exact "crashed tab loses the user's files" failure the guard exists for.
  console.log('\n16. Client page cap');
  const overCap = path.join(FIXTURES, 'over-cap.pdf');
  await writeFile(overCap, buildPdf(501, 'OverCap'));

  // Split in half never inspected at all before this, so it had no page count
  // to check and accepted anything.
  await page.goto(`${BASE}/tools/split-in-half`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([overCap]);
  const splitCapMessage = await waitFor(
    async () => page.getByText(/in-browser limit is 500/).first().textContent(),
    45_000,
    'page-cap refusal in split-in-half',
  );
  check(
    'split-in-half refuses a 501-page document',
    /501 pages.*in-browser limit is 500/s.test(splitCapMessage ?? ''),
    (splitCapMessage ?? '').replace(/\s+/g, ' ').slice(0, 90),
  );
  check(
    'no files accepted after the page cap refused it',
    (await page.getByText('Every page gets cut into two halves.').count()) === 0,
  );

  // A representative single-file tool that used to check bytes only.
  await page.goto(`${BASE}/tools/extract-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([overCap]);
  const extractCapMessage = await waitFor(
    async () => page.getByText(/in-browser limit is 500/).first().textContent(),
    45_000,
    'page-cap refusal in extract-pages',
  );
  check(
    'extract-pages refuses a 501-page document',
    /501 pages.*in-browser limit is 500/s.test(extractCapMessage ?? ''),
    (extractCapMessage ?? '').replace(/\s+/g, ' ').slice(0, 90),
  );
  check(
    'page-cap message names the real count and limit',
    /501 pages/.test(extractCapMessage ?? '') &&
      /in-browser limit is 500/.test(extractCapMessage ?? ''),
  );

  // Control: the same tool must still accept a document under the cap, so the
  // check above cannot be passing by refusing everything.
  await page.goto(`${BASE}/tools/extract-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  const underCapText = await waitFor(
    async () => page.getByText(/will extract 3 pages/).first().textContent(),
    30_000,
    'under-cap document still accepted',
  );
  check('documents under the cap are still accepted', /3 pages/.test(underCapText ?? ''), underCapText ?? '');

  /* 17. Planned tool page + 404 */
  console.log('\n17. Routing');
  await page.goto(`${BASE}/tools/compress-pdf`, { waitUntil: 'networkidle' });
  check('planned tool page renders', await page.getByText('In development').isVisible());
  await page.goto(`${BASE}/tools/does-not-exist`, { waitUntil: 'networkidle' });
  check('404 page renders', await page.getByText('This page went missing').isVisible());

  /* 18. Recent history refreshes in-session */
  // Regression: `useRecent` read IndexedDB once on mount, and the header is a
  // persistent layout component. Every tool run recorded a new entry that the
  // menu never showed until a full reload, so Recent was empty for the whole
  // session no matter how many jobs the user completed.
  console.log('\n18. Recent history');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /All Tools/ }).hover();
  const recentItems = page.locator('p:text-is("Recent")').locator('xpath=following-sibling::ul[1]/li');
  const recentCount = await waitFor(
    async () => {
      const n = await recentItems.count();
      return n > 0 ? n : null;
    },
    15_000,
    'recent entries after tool runs',
  );
  const recentNames = await page
    .locator('p:text-is("Recent")')
    .first()
    .locator('xpath=following-sibling::ul[1]')
    .innerText();
  check(
    'recent history from this session shows without a reload',
    recentCount > 0,
    `${recentCount} entries`,
  );
  // Every tool records fire-and-forget and this suite navigates away straight
  // after a result, so these are whichever writes committed before teardown.
  // Before the refresh fix the header read IndexedDB once on mount and
  // rendered none of them at all.
  const recentToolNames = await page
    .locator('p:text-is("Recent")')
    .first()
    .locator('xpath=following-sibling::ul[1]/li')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''));
  check(
    'recent history lists several tools run earlier in this session',
    recentToolNames.length >= 3,
    recentToolNames.join(' | ').slice(0, 90),
  );
  await page.screenshot({ path: path.join(ARTIFACTS, 'header-recent.png') });

  // Regression, two bugs in one assertion. The write is fire-and-forget and the
  // page is destroyed the instant a result lands, while every writer also
  // awaited `indexedDB.open()` before its write transaction existed -- that wait
  // lost the race and took the entry with it. And the trim cursor walked the
  // index oldest-first, so past MAX_ENTRIES it deleted the *newest* entries
  // including the one just written. This is deliberately the last thing recorded
  // in the run, so by now far more than MAX_ENTRIES have been written: the newest
  // entry must still be the tool that just ran.
  await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA, fileB]);
  await waitFor(async () => (await page.getByText('3 pages').count()) > 0, 30_000, 'merge inspected');
  await page.getByRole('button', { name: /Merge 2 files/ }).click();
  await page.getByText('merged.pdf').first().waitFor({ timeout: 60_000 });
  await page.goto(BASE, { waitUntil: 'networkidle' }); // straight away, no settle
  await page.getByRole('button', { name: /All Tools/ }).hover();
  const newestRecent = await waitFor(
    async () =>
      page
        .locator('p:text-is("Recent")')
        .first()
        .locator('xpath=following-sibling::ul[1]/li')
        .first()
        .textContent()
        .catch(() => null),
    15_000,
    'newest recent entry after an immediate navigation',
  );
  check(
    'a history write survives navigating away immediately',
    /Merge PDF files/.test(newestRecent ?? ''),
    (newestRecent ?? '').replace(/\s+/g, ' ').slice(0, 60),
  );

  /* console health */
  console.log('\n19. Console health');
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
