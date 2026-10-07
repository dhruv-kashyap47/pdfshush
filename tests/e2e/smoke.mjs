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

  /* 5. Delete Pages */
  console.log('\n5. Delete Pages tool');
  await page.goto(`${BASE}/tools/delete-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 3, 60_000, '3 thumbnails');
  await page.getByRole('button', { name: 'Mark page 2 for deletion' }).click();
  await waitFor(async () => (await page.getByText(/will remain/).count()) > 0, 5_000, 'marking feedback');
  check('marking a page shows remain count', true);
  await page.screenshot({ path: path.join(ARTIFACTS, 'delete-pages-marked.png') });
  await page.getByRole('button', { name: /Delete selected/ }).click();
  await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 2, 10_000, '2 thumbnails after delete');
  check('delete selected removes marked page (3 → 2)', true);
  await page.getByRole('button', { name: /Save 2 pages/ }).click();
  await page.getByText('-organized.pdf').waitFor({ timeout: 60_000 });
  const delDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('delete output is a valid PDF', delDl.ok, `${delDl.name} ${delDl.bytes.length}B`);

  /* 6. Extract Pages */
  console.log('\n6. Extract Pages tool');
  await page.goto(`${BASE}/tools/extract-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByText(/will extract 3 pages/).count()) > 0,
    30_000,
    'extract options',
  );
  check('inspect shows extract-all by default', true);
  await page.getByLabel('Pages to extract').fill('1-2');
  await waitFor(
    async () => (await page.getByText(/will extract 2 pages/).count()) > 0,
    5_000,
    'range recount',
  );
  check('range 1-2 recounts output (3 → 2)', true);
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
  await waitFor(async () => (await page.getByText(/1 rotated/).count()) > 0, 5_000, 'rotation feedback');
  check('per-page rotation tracked (1 rotated)', true);
  await page.getByRole('button', { name: 'Rotate all pages right' }).click();
  await waitFor(async () => (await page.getByText(/4 rotated|3 rotated/).count()) > 0, 5_000, 'rotate all');
  check('rotate-all turns remaining pages too', true);
  await page.getByRole('button', { name: /Save 3 pages/ }).click();
  await page.getByText('-organized.pdf').waitFor({ timeout: 60_000 });
  const rotDl = await downloadAndAssert(page, 'Download', 'pdf');
  check('rotated output is a valid PDF', rotDl.ok, `${rotDl.name} ${rotDl.bytes.length}B`);

  /* 8. Split by pages */
  console.log('\n8. Split by pages tool');
  await page.goto(`${BASE}/tools/split-by-pages`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA]);
  await waitFor(
    async () => (await page.getByText(/will produce 3 files/).count()) > 0,
    30_000,
    'part estimate',
  );
  check('chunk=1 estimates 3 parts', true);
  await page.getByRole('button', { name: /Split into 3 files/ }).click();
  await page.getByText('alpha-split.zip').waitFor({ timeout: 60_000 });
  check('split ZIP names parts', (await page.getByText('alpha-part-1.pdf').count()) > 0);
  const splitDl = await downloadAndAssert(page, 'Download ZIP', 'zip');
  check('split download is a valid ZIP', splitDl.ok, `${splitDl.name} ${splitDl.bytes.length}B`);

  /* 9. Alternate & Mix */
  console.log('\n9. Alternate & Mix tool');
  await page.goto(`${BASE}/tools/alternate-mix`, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles([fileA, fileB]);
  await waitFor(
    async () => (await page.getByText('A1, B1, A2, B2, A3, …').count()) > 0,
    30_000,
    'interleave pattern',
  );
  check('interleave pattern preview shown', true);
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
  await waitFor(
    async () => (await page.getByText(/2 sheets at 2-up/).count()) > 0,
    30_000,
    'n-up estimate',
  );
  check('2-up estimate shown (3 pages → 2 sheets)', true);
  await page.getByRole('button', { name: /4-up/ }).click();
  await waitFor(
    async () => (await page.getByText(/1 sheet at 4-up/).count()) > 0,
    5_000,
    '4-up recount',
  );
  check('4-up recount (3 pages → 1 sheet)', true);
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
  await waitFor(
    async () => (await page.locator('[data-testid="editor-page-raster"]').count()) === 3,
    60_000,
    '3 page rasters',
  );
  check('page rasters rendered (3 pages)', true);
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
  check('text box created and typed into', true);
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
  await waitFor(
    async () => (await page.getByTestId('editor-zoom-level').textContent()) !== fitZoom,
    5_000,
    'zoom out changes level',
  );
  check('zoom steps down from the fit-width default', true, `opened at ${fitZoom}`);
  await page.getByTestId('editor-zoom-in').click();

  // Highlight by drag.
  await page.getByTestId('editor-tool-highlight').click();
  await editorPage.scrollIntoViewIfNeeded();
  box = await editorPage.boundingBox();
  await page.mouse.move(box.x + 70, box.y + 380);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 405, { steps: 6 });
  await page.mouse.up();
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-highlight"]').count()) === 1,
    10_000,
    'highlight object',
  );
  check('highlight created by dragging', true);

  // Undo / redo round trip.
  await page.getByTestId('editor-undo').click();
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-highlight"]').count()) === 0,
    5_000,
    'undo drops highlight',
  );
  check('undo removes the highlight', true);
  await page.getByTestId('editor-redo').click();
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-highlight"]').count()) === 1,
    5_000,
    'redo restores highlight',
  );
  check('redo restores the highlight', true);

  // Select + keyboard delete + undo.
  await page.getByTestId('editor-tool-select').click();
  await page.locator('[data-testid="editor-object-text"]').click();
  await page.keyboard.press('Delete');
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-text"]').count()) === 0,
    5_000,
    'delete removes text',
  );
  check('delete removes the selected object', true);
  await page.keyboard.press('Control+z');
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-text"]').count()) === 1,
    5_000,
    'undo restores text',
  );
  check('undo restores the deleted object', true);

  // Nudge and duplicate -- the two shortcuts every editor ships with.
  await page.locator('[data-testid="editor-object-text"]').click();
  const leftBefore = await page
    .locator('[data-testid="editor-object-text"]')
    .first()
    .evaluate((element) => parseFloat(element.style.left));
  await page.keyboard.press('ArrowRight');
  await waitFor(
    async () =>
      (await page
        .locator('[data-testid="editor-object-text"]')
        .first()
        .evaluate((element) => parseFloat(element.style.left))) > leftBefore,
    5_000,
    'arrow key nudges the object',
  );
  check('arrow keys nudge the selection', true);
  await page.keyboard.press('Control+d');
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-text"]').count()) === 2,
    5_000,
    'duplicate inserts a second copy',
  );
  check('Ctrl+D duplicates the object', true);
  await page.keyboard.press('Control+z');
  await waitFor(
    async () => (await page.locator('[data-testid="editor-object-text"]').count()) === 1,
    5_000,
    'undo removes the duplicate',
  );
  check('undo removes the duplicate', true);

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
  await page.getByText('-edited.pdf').waitFor({ timeout: 90_000 });
  check('result panel shows alpha-edited.pdf', true);
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
  await waitFor(
    async () => (await page.locator('[data-testid^="editor-object-"]').count()) === 0,
    5_000,
    'no leftover objects',
  );
  check('start over opens a clean document', true);
  await page.screenshot({ path: path.join(ARTIFACTS, 'edit-restarted.png') });

  /* 16. Planned tool page + 404 */
  console.log('\n16. Routing');
  await page.goto(`${BASE}/tools/compress-pdf`, { waitUntil: 'networkidle' });
  check('planned tool page renders', await page.getByText('In development').isVisible());
  await page.goto(`${BASE}/tools/does-not-exist`, { waitUntil: 'networkidle' });
  check('404 page renders', await page.getByText('This page went missing').isVisible());

  /* console health */
  console.log('\n17. Console health');
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
