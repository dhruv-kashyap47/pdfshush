/**
 * End-to-end test for the plain-tools batch (PLAN.md changelog, 2026-10-20):
 * flip, watermark, edit-metadata, remove-annotations, pdf-to-text,
 * grayscale, resize, extract-images, split-by-size, flatten.
 *
 * Drives the real app in a real browser (system Edge via Playwright) and runs
 * every tool against generated PDF fixtures, asserting on actual downloaded
 * bytes (magic bytes for PDF/ZIP/JPEG, plain text content for .txt). Run with
 * the dev server up:
 *
 *   pnpm dev                        # terminal 1
 *   node tests/e2e/plain-tools.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');

/* ---------------------------------------------------------------- fixtures */

/**
 * Builds a minimal, spec-valid PDF with `pageCount` blank pages. `padKb`
 * inflates each page's text stream (for split-by-size, where the tool needs a
 * file big enough to split at the UI's 0.1 MB floor).
 */
function buildPdf(pageCount, label, padKb = 0) {
  const objects = [];
  const kids = [];
  const pageObjNums = [];

  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = next++;
    const contentObj = next++;
    pageObjNums.push({ pageObj, contentObj, index: i });
    kids.push(`${pageObj} 0 R`);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;

  const padding = ' PDFShush pad line'.repeat(padKb > 0 ? Math.ceil((padKb * 1024) / 18) : 0);
  for (const { pageObj, contentObj, index } of pageObjNums) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${next + 1} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}${padding}) Tj ET`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[next + 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let body = '%PDF-1.4\n';
  const offsets = [0];
  const total = next + 1;
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

/**
 * A one-page PDF carrying a DCTDecode image XObject. The stub is not a real
 * JPEG beyond the SOI marker — extraction passes DCT streams through
 * byte-identical without decoding, and the magic-byte assert below proves it.
 */
function buildImagePdf() {
  const jpegStub = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(64, 0x42),
  ]);
  const imageDict =
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegStub.length} >>`;
  const page = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ` +
    `/Resources << /XObject << /Im1 5 0 R >> >> >>`;
  const content = `q 595 0 0 842 0 0 cm /Im1 Do Q`;

  const objects = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3: page,
    4: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    5: `${imageDict}\nstream\n`,
  };

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let num = 1; num <= 4; num += 1) {
    offsets[num] = Buffer.byteLength(body, 'latin1');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }
  // The image stream is raw bytes, not text — build its object manually.
  offsets[5] = Buffer.byteLength(body, 'latin1');
  body += `5 0 obj\n${imageDict}\nstream\n`;
  body = Buffer.concat([Buffer.from(body, 'latin1'), jpegStub, Buffer.from('\nendstream\nendobj\n', 'latin1')]);

  const xrefStart = body.length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let num = 1; num <= 5; num += 1) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([body, Buffer.from(xref, 'latin1')]);
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
const isZip = (bytes) => bytes.subarray(0, 2).toString('latin1') === 'PK';

/** Extracts the FIRST file's bytes from a deflate-method zip local header. */
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

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const fileA = path.join(FIXTURES, 'alpha.pdf');
  const fileFat = path.join(FIXTURES, 'fat.pdf');
  const fileImg = path.join(FIXTURES, 'with-image.pdf');
  await writeFile(fileA, buildPdf(3, 'PDFShush A'));
  await writeFile(fileFat, buildPdf(3, 'PDFShush Fat', 120));
  await writeFile(fileImg, buildImagePdf());

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
    /* 1. Flip */
    console.log('\n1. Flip PDF');
    await openTool('flip-pdf');
    await upload(fileA);
    await waitFor(async () => (await page.locator('img[alt^="Page "]').count()) === 3, 60_000, '3 thumbnails');
    await page.getByRole('button', { name: 'Flip all H' }).click();
    await page.getByText('3 mirrored').first().waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Mirror 3 pages' }).click();
    await page.getByText('pages mirrored').waitFor({ timeout: 60_000 });
    const flipDl = await download(page, 'Download');
    check('flip output is a valid PDF', isPdf(flipDl.bytes), `${flipDl.name} ${flipDl.bytes.length}B`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'flip-result.png') });

    /* 2. Watermark */
    console.log('\n2. Watermark');
    await openTool('watermark');
    await upload(fileA);
    await page.getByText('Preview · page 1').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Watermark', exact: true }).click();
    await page.getByText('watermarked').first().waitFor({ timeout: 60_000 });
    const wmDl = await download(page, 'Download');
    check('watermark output is a valid PDF', isPdf(wmDl.bytes), `${wmDl.name} ${wmDl.bytes.length}B`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'watermark-result.png') });

    /* 3. Edit Metadata */
    console.log('\n3. Edit Metadata');
    await openTool('edit-metadata');
    await upload(fileA);
    await page.getByPlaceholder('Annual Report').waitFor({ timeout: 60_000 });
    await page.getByPlaceholder('Annual Report').fill('E2E Metadata Title');
    await page.getByRole('button', { name: 'Save metadata' }).click();
    await page.getByText('Only the fields you changed').waitFor({ timeout: 60_000 });
    const metaDl = await download(page, 'Download');
    check('metadata output is a valid PDF', isPdf(metaDl.bytes), `${metaDl.name} ${metaDl.bytes.length}B`);

    /* 4. Remove Annotations */
    console.log('\n4. Remove Annotations');
    await openTool('remove-annotations');
    await upload(fileA);
    await page.getByRole('button', { name: 'Remove annotations' }).click();
    await page.getByText(/annotation/).first().waitFor({ timeout: 60_000 });
    const annDl = await download(page, 'Download');
    check('annotations output is a valid PDF', isPdf(annDl.bytes), `${annDl.name} ${annDl.bytes.length}B`);

    /* 5. PDF to Text */
    console.log('\n5. PDF to Text');
    await openTool('pdf-to-text');
    await upload(fileA);
    await page.getByRole('button', { name: 'Extract text' }).click();
    await page.locator('pre').waitFor({ timeout: 60_000 });
    const txtDl = await download(page, 'Download .txt');
    const txt = txtDl.bytes.toString('latin1');
    check('txt contains the page text', txt.includes('PDFShush A page 1'), `${txtDl.name} ${txtDl.bytes.length}B`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'pdf-to-text-result.png') });

    /* 6. Grayscale */
    console.log('\n6. Grayscale PDF');
    await openTool('grayscale-pdf');
    await upload(fileA);
    const grayButton = page.getByRole('button', { name: 'Convert to grayscale' });
    await waitFor(async () => grayButton.isEnabled(), 60_000, 'grayscale ready');
    await grayButton.click();
    await page.getByText(/rebuilt in black and white/).waitFor({ timeout: 120_000 });
    const grayDl = await download(page, 'Download');
    check('grayscale output is a valid PDF', isPdf(grayDl.bytes), `${grayDl.name} ${grayDl.bytes.length}B`);
    await page.screenshot({ path: path.join(ARTIFACTS, 'grayscale-result.png') });

    /* 7. Resize */
    console.log('\n7. Resize PDF');
    await openTool('resize-pdf');
    await upload(fileA);
    await page.getByRole('button', { name: /A4/ }).first().click();
    await page.getByRole('button', { name: 'Resize 3 pages' }).click();
    await page.getByText('resized').first().waitFor({ timeout: 60_000 });
    const resizeDl = await download(page, 'Download');
    check('resize output is a valid PDF', isPdf(resizeDl.bytes), `${resizeDl.name} ${resizeDl.bytes.length}B`);

    /* 8. Extract Images */
    console.log('\n8. Extract Images');
    await openTool('extract-images');
    await upload(fileImg);
    await page.getByRole('button', { name: 'Extract images' }).click();
    await page.getByRole('button', { name: /Download all \(ZIP\)/ }).waitFor({ timeout: 60_000 });
    const imgZip = await download(page, /Download all \(ZIP\)/);
    check('extract-images zip is a valid ZIP', isZip(imgZip.bytes), `${imgZip.name} ${imgZip.bytes.length}B`);
    const jpeg = firstZipEntry(imgZip.bytes);
    check(
      'zip entry is the original JPEG (FF D8 magic)',
      jpeg[0] === 0xff && jpeg[1] === 0xd8,
      `${jpeg.length}B`,
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'extract-images-result.png') });

    /* 9. Split by Size */
    console.log('\n9. Split by Size');
    await openTool('split-by-size');
    await upload(fileFat);
    const target = page.getByLabel('Target size per part (MB)');
    await target.waitFor({ timeout: 60_000 });
    await target.fill('0.1');
    await page.getByRole('button', { name: 'Split PDF' }).click();
    await page.getByText(/Download parts \(ZIP\)/).waitFor({ timeout: 120_000 });
    const partRows = await page.locator('tbody tr').count();
    check('multiple parts produced', partRows >= 2, `${partRows} parts listed`);
    const splitZip = await download(page, /Download parts \(ZIP\)/);
    check('split zip is a valid ZIP', isZip(splitZip.bytes), `${splitZip.name} ${splitZip.bytes.length}B`);

    /* 10. Flatten */
    console.log('\n10. Flatten PDF');
    await openTool('flatten-pdf');
    await upload(fileA);
    await page.getByText('This cannot be undone.').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Flatten PDF' }).click();
    await page.getByText(/passed through unchanged|baked into the pages/).first().waitFor({ timeout: 60_000 });
    const flatDl = await download(page, 'Download');
    check('flatten output is a valid PDF', isPdf(flatDl.bytes), `${flatDl.name} ${flatDl.bytes.length}B`);

    /* Console errors */
    console.log('\nConsole');
    // With no API stack running, the app's capability probes (/api/tools,
    // /api/auth/me) fail as 502 — the designed offline posture (smoke.mjs §20).
    let apiReachable = false;
    try {
      apiReachable = (await fetch(`${BASE}/api/tools`)).ok;
    } catch {
      apiReachable = false;
    }
    const fatal = consoleErrors.filter(
      (text) =>
        !(
          !apiReachable &&
          /Failed to load resource|Request failed \(50\d\)/i.test(text)
        ),
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
