/**
 * End-to-end test for the next-tools batch (PLAN.md changelog, 2026-10-21):
 * unlock, JPG to PDF, rename, Bates numbering, split by text, compress.
 *
 * Runs every tool in a real browser against generated fixtures and asserts on
 * the downloaded bytes. The encrypted fixture is generated once with pypdf (a
 * dev-time tool, not a dependency) and committed; see
 * scripts/make-encrypted-fixtures.py.
 *
 *   pnpm dev
 *   node tests/e2e/next-tools.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');

/* ---------------------------------------------------------------- fixtures */

function buildPdf(pageCount, label) {
  const objects = [];
  const kids = [];
  const pages = [];
  let next = 3;
  for (let i = 0; i < pageCount; i += 1) {
    pages.push({ pageObj: next++, contentObj: next++, index: i });
    kids.push(`${pages[pages.length - 1].pageObj} 0 R`);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  for (const { pageObj, contentObj, index } of pages) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${next + 1} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}) Tj ET`;
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

/** A real RGB PNG with a horizontal gradient, so the page is not blank. */
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

/** Inflates every Flate stream and searches both literal and hex-encoded text. */
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
  return (
    haystack.toLowerCase().includes(needle.toLowerCase()) ||
    haystack.toLowerCase().includes(hex)
  );
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const alpha = path.join(FIXTURES, 'alpha-next.pdf');
  const beta = path.join(FIXTURES, 'beta-next.pdf');
  const imageA = path.join(FIXTURES, 'photo-a.png');
  const imageB = path.join(FIXTURES, 'photo-b.png');
  const locked = path.join(ROOT, 'packages', 'pdf-core', 'test', 'fixtures', 'encrypted-aes128.pdf');

  await writeFile(alpha, buildPdf(3, 'PDFShush Next'));
  await writeFile(beta, buildPdf(2, 'PDFShush Beta'));
  await writeFile(imageA, buildPng(160, 100));
  await writeFile(imageB, buildPng(90, 140));

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
    /* 1. Unlock */
    console.log('\n1. Unlock PDF');
    await openTool('unlock-pdf');
    await upload(locked);
    const password = page.getByLabel('Current password');
    await password.waitFor({ timeout: 30_000 });
    await password.fill('shush123');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await page.getByText(/The password is gone from this copy/).waitFor({ timeout: 60_000 });
    const unlockDl = await download(page, 'Download');
    check('unlock output is a valid PDF', isPdf(unlockDl.bytes), `${unlockDl.name} ${unlockDl.bytes.length}B`);
    const unlockLatin1 = unlockDl.bytes.toString('latin1');
    check('unlock output carries no /Encrypt entry', !unlockLatin1.includes('/Encrypt'));
    check(
      'unlock output keeps the page text',
      unlockLatin1.includes('Locked page - PDFShush unlock test'),
    );
    await page.screenshot({ path: path.join(ARTIFACTS, 'unlock-result.png') });

    /* 2. JPG to PDF */
    console.log('\n2. JPG to PDF');
    await openTool('jpg-to-pdf');
    await upload([imageA, imageB]);
    await waitFor(
      async () => (await page.locator('[data-testid="image-list"] li').count()) === 2,
      30_000,
      'two image rows',
    );
    await page.getByRole('button', { name: 'Create PDF' }).click();
    await page.getByText(/images placed one per page/).waitFor({ timeout: 60_000 });
    const jpgDl = await download(page, 'Download');
    check('jpg-to-pdf output is a valid PDF', isPdf(jpgDl.bytes), `${jpgDl.name} ${jpgDl.bytes.length}B`);
    check('jpg-to-pdf created two pages', jpgDl.bytes.toString('latin1').includes('/Count 2'));
    await page.screenshot({ path: path.join(ARTIFACTS, 'jpg-to-pdf-result.png') });

    /* 3. Rename */
    console.log('\n3. Rename PDF');
    await openTool('rename-pdf');
    await upload([alpha, beta]);
    await page.getByLabel('Name pattern').waitFor({ timeout: 30_000 });
    await page.getByLabel('Name pattern').fill('file-{n}');
    await page.getByLabel('Sequence width').fill('2');
    await page.getByText('file-01.pdf').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Rename 2 files' }).click();
    await page.getByText(/The bytes were copied, not re-encoded/).waitFor({ timeout: 60_000 });
    const renameDl = await download(page, /Download renamed files \(ZIP\)/);
    check('rename output is a valid ZIP', isZip(renameDl.bytes), `${renameDl.name} ${renameDl.bytes.length}B`);
    check('renamed entry is still a PDF', isPdf(firstZipEntry(renameDl.bytes)));
    await page.screenshot({ path: path.join(ARTIFACTS, 'rename-result.png') });

    /* 4. Bates numbering */
    console.log('\n4. Bates Numbering');
    await openTool('bates-numbering');
    await upload(alpha);
    await page.getByLabel('Prefix').fill('CASE-');
    await page.getByLabel('Start at').fill('7');
    await page.getByLabel('Digits').fill('4');
    await page.getByText('CASE-0007').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Add Bates numbers' }).click();
    await page.getByText(/Numbers CASE-0007 through CASE-0009/).waitFor({ timeout: 60_000 });
    const batesDl = await download(page, 'Download');
    check('bates output is a valid PDF', isPdf(batesDl.bytes), `${batesDl.name} ${batesDl.bytes.length}B`);
    check('bates text is stamped into the page', pdfContainsText(batesDl.bytes, 'CASE-0007'));
    check('bates sequence advances', pdfContainsText(batesDl.bytes, 'CASE-0009'));
    await page.screenshot({ path: path.join(ARTIFACTS, 'bates-result.png') });

    /* 5. Split by text */
    console.log('\n5. Split by Text');
    await openTool('split-by-text');
    await upload(alpha);
    await page.getByLabel('Text that starts a new part').fill('page 3');
    await page.getByRole('button', { name: 'Split PDF' }).click();
    await page.getByText(/2 parts/).waitFor({ timeout: 60_000 });
    const splitRows = await page.locator('tbody tr').count();
    check('split-by-text produced two parts', splitRows === 2, `${splitRows} rows`);
    const textZip = await download(page, /Download parts \(ZIP\)/);
    check('split-by-text zip is a valid ZIP', isZip(textZip.bytes), `${textZip.name} ${textZip.bytes.length}B`);
    check('first split part is a PDF', isPdf(firstZipEntry(textZip.bytes)));
    await page.screenshot({ path: path.join(ARTIFACTS, 'split-by-text-result.png') });

    /* 6. Compress -- repack */
    console.log('\n6. Compress PDF (repack)');
    await openTool('compress-pdf');
    await upload(alpha);
    await page.getByRole('button', { name: /Repack only/ }).click();
    await page.getByRole('button', { name: 'Compress PDF' }).click();
    await page.getByText(/Repacked without touching text or images/).waitFor({ timeout: 60_000 });
    const repackDl = await download(page, 'Download');
    check('repack output is a valid PDF', isPdf(repackDl.bytes), `${repackDl.name} ${repackDl.bytes.length}B`);
    check('repack keeps the text layer', pdfContainsText(repackDl.bytes, 'PDFShush Next page 2'));

    /* 7. Compress -- strong (real browser raster path) */
    console.log('\n7. Compress PDF (strong)');
    await page.getByRole('button', { name: 'Start over' }).click();
    await upload(alpha);
    await waitFor(
      async () => await page.getByRole('button', { name: 'Compress PDF' }).isEnabled(),
      60_000,
      'compress ready',
    );
    await page.getByRole('button', { name: 'Compress PDF' }).click();
    await page.getByText(/Rebuilt as JPEG images/).waitFor({ timeout: 180_000 });
    const strongDl = await download(page, 'Download');
    check('strong compression output is a valid PDF', isPdf(strongDl.bytes), `${strongDl.name} ${strongDl.bytes.length}B`);
    check('strong compression reports before and after', await page.getByText('Before').isVisible());
    await page.screenshot({ path: path.join(ARTIFACTS, 'compress-result.png') });

    /* Console errors */
    console.log('\nConsole');
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
