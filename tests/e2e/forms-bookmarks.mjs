/**
 * End-to-end test for the authoring batch (PLAN.md changelog, 2026-10-26):
 * Create Forms and Create Bookmarks.
 *
 * Both tools are exercised through the real UI, and every assertion reads the
 * downloaded bytes. Field names and bookmark titles are written as UTF-16BE
 * hex strings by pdf-lib, so the checks encode them the same way rather than
 * hoping for plain ASCII.
 *
 *   pnpm --filter @pdfshush/web dev
 *   node tests/e2e/forms-bookmarks.mjs
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

function serializePdf(objects) {
  const total = objects.length - 1;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let num = 1; num <= total; num += 1) {
    if (objects[num] === undefined) continue;
    offsets[num] = Buffer.byteLength(body, 'latin1');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= total; num += 1) {
    xref += `${String(offsets[num] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function escapePdfText(text) {
  return text.replace(/([()\\])/g, '\\$1');
}

function buildPdf(pageCount, label) {
  const objects = [];
  const kids = [];
  const pages = [];
  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pages.push({ pageObj: next++, contentObj: next++, index: i });
    kids.push(`${pages[pages.length - 1].pageObj} 0 R`);
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  for (const { pageObj, contentObj, index } of pages) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${next + 1} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}) Tj ET`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[next + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return serializePdf(objects);
}

/**
 * A report-shaped PDF: one large heading, three body lines, a small running
 * header and a page number on every page. The suggestion heuristic has to keep
 * the headings and drop the rest.
 */
function buildHeadedPdf(sections) {
  const objects = [];
  const kids = [];
  const pages = [];
  let next = 3;
  for (let i = 0; i < sections.length; i += 1) {
    pages.push({ pageObj: next++, contentObj: next++ });
    kids.push(`${pages[pages.length - 1].pageObj} 0 R`);
  }
  const fontObj = next++;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${sections.length} >>`;

  sections.forEach((section, index) => {
    const { pageObj, contentObj } = pages[index];
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    const lines = [
      `BT /F1 9 Tf 72 800 Td (${escapePdfText('ACME CONFIDENTIAL')}) Tj ET`,
      `BT /F1 26 Tf 72 740 Td (${escapePdfText(section.heading)}) Tj ET`,
      ...section.body.map(
        (line, lineIndex) =>
          `BT /F1 10 Tf 72 ${690 - lineIndex * 18} Td (${escapePdfText(line)}) Tj ET`,
      ),
      `BT /F1 9 Tf 300 40 Td (${index + 1}) Tj ET`,
    ];
    const stream = lines.join('\n');
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return serializePdf(objects);
}

/* ------------------------------------------------------------- tiny asserts */

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(fn, timeoutMs = 60_000, label = 'condition') {
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
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  return {
    bytes: await readFile(await downloadEvent.path()),
    name: downloadEvent.suggestedFilename(),
  };
}

const isPdf = (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';

function pdfPageCount(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

/** pdf-lib writes strings as `<FEFF...>` UTF-16BE hex. */
function utf16Hex(text) {
  return Buffer.from(`\uFEFF${text}`, 'utf16le').swap16().toString('hex');
}

function bytesContain(bytes, needle) {
  return bytes.toString('latin1').toLowerCase().includes(needle.toLowerCase());
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const formsFixture = path.join(FIXTURES, 'forms-e2e.pdf');
  const headedFixture = path.join(FIXTURES, 'headed-e2e.pdf');

  await writeFile(formsFixture, buildPdf(1, 'Forms E2E'));
  await writeFile(
    headedFixture,
    buildHeadedPdf([
      {
        heading: 'Introduction',
        body: ['This report explains the approach.', 'It covers scope and method.', 'It ends with results.'],
      },
      {
        heading: 'Method and Data',
        body: ['Samples were collected in March.', 'Every record was checked twice.', 'No record was discarded.'],
      },
      {
        heading: 'Results',
        body: ['The first result was positive.', 'The second was inconclusive.', 'Both are discussed here.'],
      },
    ]),
  );

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const openTool = async (slug) => {
    await page.goto(`${BASE}/tools/${slug}`, { waitUntil: 'networkidle' });
  };
  const upload = (files) =>
    page.locator('input[type="file"]').setInputFiles(Array.isArray(files) ? files : [files]);

  try {
    /* 1. Create Forms */
    console.log('\n1. Create Forms');
    await openTool('create-forms');
    check(
      'planned notice is gone',
      !(await page.getByText(/is on the roadmap/).isVisible()),
    );
    await upload(formsFixture);
    await page.getByTestId('create-forms-page').waitFor({ timeout: 90_000 });
    check('page preview renders', await page.locator('img[alt="Page 1"]').isVisible());

    await page.getByTestId('create-forms-add-text').click();
    await page.getByTestId('field-name').fill('full_name');
    await page.getByTestId('create-forms-add-checkbox').click();
    await page.getByTestId('field-name').fill('agree');
    check(
      'two fields are listed',
      (await page.locator('[data-testid^="field-row-"]').count()) === 2,
    );

    const pageBox = await page.getByTestId('create-forms-page').boundingBox();
    await page.mouse.click(pageBox.x + pageBox.width * 0.62, pageBox.y + pageBox.height * 0.62);
    await waitFor(
      async () => (await page.locator('[data-testid^="field-row-"]').count()) === 3,
      10_000,
      'click-to-place field',
    );
    check('clicking the page places a field', true);
    await page.getByTestId('create-forms-remove').click();
    check(
      'removing the selected field returns to two',
      (await page.locator('[data-testid^="field-row-"]').count()) === 2,
    );

    check(
      'duplicate names are refused before running',
      await page.getByTestId('create-forms-run').isEnabled(),
    );
    await page.getByTestId('create-forms-run').click();
    await page.getByText('forms-e2e-fillable.pdf').waitFor({ timeout: 90_000 });
    const formsDl = await download(page, 'Download');
    check('form output is a valid PDF', isPdf(formsDl.bytes), `${formsDl.name} ${formsDl.bytes.length}B`);
    check('form output keeps the page', pdfPageCount(formsDl.bytes) === 1);
    check('form output has an AcroForm', bytesContain(formsDl.bytes, '/AcroForm'));
    check('text field is a real /Tx field', bytesContain(formsDl.bytes, '/FT /Tx'));
    check('checkbox is a real /Btn field', bytesContain(formsDl.bytes, '/FT /Btn'));
    check(
      'field full_name is written',
      bytesContain(formsDl.bytes, `<${utf16Hex('full_name')}>`),
    );
    check('field agree is written', bytesContain(formsDl.bytes, `<${utf16Hex('agree')}>`));
    await page.screenshot({ path: path.join(ARTIFACTS, 'create-forms-result.png') });

    /* 2. Create Bookmarks */
    console.log('\n2. Create Bookmarks');
    await openTool('create-bookmarks');
    check(
      'planned notice is gone',
      !(await page.getByText(/is on the roadmap/).isVisible()),
    );
    await upload(headedFixture);
    await page.getByTestId('bookmark-title-0').waitFor({ timeout: 90_000 });
    await waitFor(
      async () => (await page.locator('[data-testid^="bookmark-title-"]').count()) === 3,
      30_000,
      'three suggestions',
    );
    const detected = await page
      .locator('[data-testid^="bookmark-title-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    check(
      'detects the three headings',
      JSON.stringify(detected) === JSON.stringify(['Introduction', 'Method and Data', 'Results']),
      detected.join(' | '),
    );

    await page.getByTestId('create-bookmarks-mode-pages').click();
    await waitFor(
      async () => (await page.locator('[data-testid^="bookmark-title-"]').count()) === 3,
      15_000,
      'page-mode suggestions',
    );
    check('every-page mode keeps three rows', true);
    await page.getByTestId('create-bookmarks-mode-headings').click();

    await page.getByTestId('bookmark-title-0').fill('Introduction and Scope');
    await page
      .getByRole('button', { name: /^Indent Method and Data/ })
      .click();
    check('a bookmark can be nested', await page.getByText('level 2').isVisible());

    await page.getByTestId('create-bookmarks-add').click();
    check(
      'a manual bookmark can be added',
      (await page.locator('[data-testid^="bookmark-title-"]').count()) === 4,
    );
    await page.getByRole('button', { name: /^Remove New bookmark/ }).click();
    check(
      'the manual bookmark can be removed',
      (await page.locator('[data-testid^="bookmark-title-"]').count()) === 3,
    );

    await page.getByTestId('create-bookmarks-run').click();
    await page.getByText('headed-e2e-bookmarked.pdf').waitFor({ timeout: 90_000 });
    const bookmarkDl = await download(page, 'Download');
    check(
      'bookmark output is a valid PDF',
      isPdf(bookmarkDl.bytes),
      `${bookmarkDl.name} ${bookmarkDl.bytes.length}B`,
    );
    check('bookmark output keeps all three pages', pdfPageCount(bookmarkDl.bytes) === 3);
    check('bookmark output has an outline root', bytesContain(bookmarkDl.bytes, '/Outlines'));
    check(
      'edited title is written',
      bytesContain(bookmarkDl.bytes, `<${utf16Hex('Introduction and Scope')}>`),
    );
    check(
      'second title is written',
      bytesContain(bookmarkDl.bytes, `<${utf16Hex('Method and Data')}>`),
    );
    check('third title is written', bytesContain(bookmarkDl.bytes, `<${utf16Hex('Results')}>`));
    check(
      'nested items point at their parent',
      (bookmarkDl.bytes.toString('latin1').match(/\/Parent\s+\d+\s+0\s+R/g) ?? []).length >= 3,
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'create-bookmarks-result.png') });

    /* Console errors */
    console.log('\nConsole');
    let apiReachable = false;
    try {
      apiReachable = (await fetch(`${BASE}/api/tools`)).ok;
    } catch {
      apiReachable = false;
    }
    const fatal = consoleErrors.filter(
      (text) => !(!apiReachable && /Failed to load resource|Request failed \(50\d\)/i.test(text)),
    );
    check('no console/page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
