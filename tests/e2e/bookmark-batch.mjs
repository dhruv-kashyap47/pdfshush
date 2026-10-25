/**
 * End-to-end test for the bookmark batch (PLAN.md changelog, 2026-10-25):
 * Stamp, Repair, Combine, Split by bookmarks, Batch run, Image editor and the
 * Workflows tool page.
 *
 * Every check reads the downloaded bytes -- the point of the batch is that the
 * new engines produce real files, not that a spinner disappeared.
 *
 *   pnpm --filter @pdfshush/web dev
 *   node tests/e2e/bookmark-batch.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync, inflateRawSync } from 'node:zlib';
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

/** A real outline: a linked sibling list under one /Outlines root. */
function buildBookmarkedPdf(pageCount, label, bookmarks) {
  const objects = [];
  const kids = [];
  const pages = [];
  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pages.push({ pageObj: next++, contentObj: next++, index: i });
    kids.push(`${pages[pages.length - 1].pageObj} 0 R`);
  }
  const fontObj = next++;
  const rootObj = next++;
  const firstItem = next;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${rootObj} 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  for (const { pageObj, contentObj, index } of pages) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}) Tj ET`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[rootObj] =
    `<< /Type /Outlines /First ${firstItem} 0 R /Last ${firstItem + bookmarks.length - 1} 0 R ` +
    `/Count ${bookmarks.length} >>`;

  bookmarks.forEach((bookmark, index) => {
    const number = firstItem + index;
    const page = pages[bookmark.page];
    if (!page) throw new Error(`Bookmark ${bookmark.title} points outside the document`);
    const prev = index > 0 ? `/Prev ${number - 1} 0 R ` : '';
    const nextItem = index < bookmarks.length - 1 ? `/Next ${number + 1} 0 R ` : '';
    const title = bookmark.title.replace(/([()\\])/g, '\\$1');
    objects[number] =
      `<< /Title (${title}) /Parent ${rootObj} 0 R ${prev}${nextItem}` +
      `/Dest [${page.pageObj} 0 R /Fit] >>`;
  });

  return serializePdf(objects);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(4 + body.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 4 + body.length);
  return out;
}

function buildPng(width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    for (let x = 0; x < width; x += 1) {
      const value = 40 + Math.round((x / width) * 160);
      const i = row + 1 + x * 3;
      raw[i] = value;
      raw[i + 1] = Math.round(value * 0.8);
      raw[i + 2] = 200 - Math.round(value * 0.4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
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

async function download(page, buttonName) {
  const [downloadEvent] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.getByRole('button', { name: buttonName }).click(),
  ]);
  return { bytes: await readFile(await downloadEvent.path()), name: downloadEvent.suggestedFilename() };
}

const isPdf = (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';
const isZip = (bytes) => bytes.subarray(0, 2).toString('latin1') === 'PK';
const isPng = (bytes) =>
  bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

function pdfPageCount(bytes) {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

/** Reads the EOCD record rather than guessing from compressed payload bytes. */
function zipEntryCount(zip) {
  for (let offset = zip.length - 22; offset >= 0; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return zip.readUInt16LE(offset + 10);
  }
  return 0;
}

function firstZipEntry(zip) {
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip local header');
  const method = zip.readUInt16LE(8);
  const compressedSize = zip.readUInt32LE(18);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const raw = zip.subarray(start, start + compressedSize);
  return method === 0 ? raw : inflateRawSync(raw);
}

function pdfContainsText(bytes, needle) {
  const latin1 = bytes.toString('latin1');
  let haystack = '';
  const streams = /stream\r?\n/g;
  let match;
  while ((match = streams.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    const slice = bytes.subarray(start, end);
    try {
      haystack += inflateSync(slice).toString('latin1');
    } catch {
      haystack += slice.toString('latin1');
    }
    streams.lastIndex = end + 'endstream'.length;
  }
  const hex = Buffer.from(needle, 'utf8').toString('hex').toLowerCase();
  return haystack.toLowerCase().includes(needle.toLowerCase()) || haystack.toLowerCase().includes(hex);
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const alpha = path.join(FIXTURES, 'alpha-bookmarks.pdf');
  const beta = path.join(FIXTURES, 'beta-bookmarks.pdf');
  const outline = path.join(FIXTURES, 'outline.pdf');
  const photo = path.join(FIXTURES, 'photo-bookmarks.png');

  await writeFile(alpha, buildPdf(3, 'PDFShush Batch'));
  await writeFile(beta, buildPdf(2, 'PDFShush Second'));
  await writeFile(
    outline,
    buildBookmarkedPdf(5, 'Bookmarked', [
      { title: 'Introduction', page: 0 },
      { title: 'Method and Data', page: 2 },
      { title: 'Results', page: 4 },
    ]),
  );
  await writeFile(photo, buildPng(160, 100));

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
  const upload = (files) =>
    page.locator('input[type="file"]').setInputFiles(Array.isArray(files) ? files : [files]);

  try {
    /* 1. Stamp */
    console.log('\n1. Stamp');
    await openTool('stamp');
    await upload(alpha);
    await page.getByRole('button', { name: 'Apply stamp' }).click();
    await page.getByText('alpha-bookmarks-stamped.pdf').waitFor({ timeout: 90_000 });
    const stampDl = await download(page, 'Download');
    check('stamp output is a valid PDF', isPdf(stampDl.bytes), `${stampDl.name} ${stampDl.bytes.length}B`);
    check('stamp keeps all three pages', pdfPageCount(stampDl.bytes) === 3);
    check('stamp writes the chosen mark', pdfContainsText(stampDl.bytes, 'APPROVED'));
    await page.screenshot({ path: path.join(ARTIFACTS, 'stamp-result.png') });

    /* 2. Repair */
    console.log('\n2. Repair PDF');
    await openTool('repair-pdf');
    await upload(alpha);
    await page.getByTestId('repair-run').click();
    await page.getByText('alpha-bookmarks-repaired.pdf').waitFor({ timeout: 90_000 });
    const repairDl = await download(page, 'Download');
    check('repair output is a valid PDF', isPdf(repairDl.bytes));
    check('repair keeps the pages', pdfPageCount(repairDl.bytes) === 3);
    check(
      'repair is honest about an already-valid source',
      await page.getByText(/already passed a strict structural check/).isVisible(),
    );

    /* 3. Combine */
    console.log('\n3. Combine PDF + image + PDF');
    await openTool('combine-pdf');
    await upload(alpha);
    await page.getByTestId('combine-list').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Add more' }).click();
    await upload(photo);
    await page.getByRole('button', { name: 'Add more' }).click();
    await upload(beta);
    await page.getByTestId('combine-list').waitFor({ timeout: 30_000 });
    check('combine lists all three inputs', (await page.getByTestId('combine-list').locator('li').count()) === 3);
    check(
      'adding files with "Add more" does not duplicate them',
      (await page.getByTestId('combine-list').locator('li').allInnerTexts()).filter((text) =>
        text.includes('alpha-bookmarks.pdf'),
      ).length === 1,
    );
    await page.getByTestId('combine-run').click();
    await page.getByText('alpha-bookmarks-combined.pdf').waitFor({ timeout: 90_000 });
    const combineDl = await download(page, 'Download');
    check('combine output is a valid PDF', isPdf(combineDl.bytes));
    check('combine produced 3 + 1 + 2 pages', pdfPageCount(combineDl.bytes) === 6, `${pdfPageCount(combineDl.bytes)} pages`);
    check('combine keeps text from both PDFs', pdfContainsText(combineDl.bytes, 'PDFShush Batch page 2'));
    check('combine keeps text from the second PDF', pdfContainsText(combineDl.bytes, 'PDFShush Second page 1'));
    await page.screenshot({ path: path.join(ARTIFACTS, 'combine-result.png') });

    /* 4. Split by bookmarks */
    console.log('\n4. Split by bookmarks');
    await openTool('split-by-bookmarks');
    await upload(outline);
    await page.getByTestId('bookmarks-run').click();
    await page.getByText('outline-bookmarks.zip').waitFor({ timeout: 90_000 });
    const parts = page.getByTestId('bookmark-parts').locator('li');
    check('outline produced three sections', (await parts.count()) === 3);
    check('section titles come from the bookmarks', (await parts.first().innerText()).includes('Introduction'));
    const splitDl = await download(page, 'Download');
    check('bookmark split is a valid ZIP', isZip(splitDl.bytes), splitDl.name);
    check('archive holds three files', zipEntryCount(splitDl.bytes) === 3);
    check('first section is a PDF', isPdf(firstZipEntry(splitDl.bytes)));
    await page.screenshot({ path: path.join(ARTIFACTS, 'bookmarks-result.png') });

    /* 5. Batch run */
    console.log('\n5. Batch run (grayscale)');
    await openTool('batch-run');
    await upload(alpha);
    await page.getByRole('button', { name: 'Add more' }).click();
    await upload(beta);
    check('batch accepts a second file without duplicating the first', await page.getByText('2 PDF files selected').isVisible());
    await page.locator('#batch-op').click();
    await page.getByRole('option', { name: 'Grayscale' }).click();
    await page.getByTestId('batch-run').click();
    await page.getByText('grayscale-batch.zip').waitFor({ timeout: 180_000 });
    check('batch reports two packed files', await page.getByText(/2 files packed/).isVisible());
    const batchDl = await download(page, 'Download');
    check('batch archive is a valid ZIP', isZip(batchDl.bytes), batchDl.name);
    check('batch archive holds both outputs', zipEntryCount(batchDl.bytes) === 2);
    check('batch output is a PDF', isPdf(firstZipEntry(batchDl.bytes)));
    const secondDl = await download(page, 'Download');
    check(
      'the archive can be downloaded a second time',
      secondDl.bytes.length === batchDl.bytes.length,
      `${secondDl.bytes.length}B`,
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'batch-result.png') });

    /* 6. Image editor */
    console.log('\n6. Image editor');
    await openTool('image-editor');
    await upload(photo);
    await page.getByTestId('image-canvas').waitFor({ timeout: 30_000 });
    await page.getByTestId('image-rotate').click();
    await waitFor(
      async () => (await page.getByTestId('image-canvas').getAttribute('height')) === '160',
      10_000,
      'rotated canvas',
    );
    const pngDl = await download(page, 'PNG');
    check('image export is a real PNG', isPng(pngDl.bytes), pngDl.name);
    check('rotation swapped the exported dimensions', pngDl.bytes.readUInt32BE(16) === 100 && pngDl.bytes.readUInt32BE(20) === 160);
    await page.screenshot({ path: path.join(ARTIFACTS, 'image-editor.png') });

    /* 7. Image editor -> PDF */
    console.log('\n7. Image editor -> PDF');
    await page.getByTestId('image-to-pdf').click();
    await page.getByText(/photo-bookmarks\.pdf/).waitFor({ timeout: 90_000 });
    const imagePdfDl = await download(page, 'Download');
    check('editor PDF is valid', isPdf(imagePdfDl.bytes));
    check('editor PDF has one page', pdfPageCount(imagePdfDl.bytes) === 1);

    /* 8. Workflows tool page */
    console.log('\n8. Workflows page');
    await openTool('workflows');
    check('workflow builder is embedded on the tool page', await page.getByText('New workflow').isVisible());
    check('planned notice is gone', !(await page.getByText(/is on the roadmap/).isVisible()));

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
