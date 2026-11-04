/**
 * Adversarial corpus for the M5.0 product baseline (PLAN.md §31.6, Q4).
 *
 * Q4 asks whether a tool "works at the edges": zero bytes, one page, a document
 * far past the cap, encrypted, scanned, malformed, non-ASCII filenames and an
 * oversized file. These are generated deterministically so a re-run compares
 * like with like, and written under `tests/benchmarks/.corpus` (gitignored).
 *
 * One listed edge is deliberately absent: a *genuinely* linearised PDF. Neither
 * qpdf nor Ghostscript is available in this environment and no linearised
 * fixture is committed, so the baseline records the gap instead of shipping a
 * fake `/Linearized` dictionary that readers would treat as a corrupt file.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = path.join(ROOT, 'tests/benchmarks/.corpus');

/** Minimal, spec-valid PDF with `pages` blank pages. Mirrors the E2E builder. */
export function buildPdf(pages = 1, label = 'baseline') {
  const objects = [];
  const kids = [];
  const pageObjs = [];
  let next = 3;
  for (let i = 0; i < pages; i += 1) {
    const pageObj = next++;
    const contentObj = next++;
    pageObjs.push({ pageObj, contentObj, index: i });
    kids.push(`${pageObj} 0 R`);
  }
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;

  for (const { pageObj, contentObj, index } of pageObjs) {
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R ` +
      `/Resources << /Font << /F1 ${next + 1} 0 R >> >> >>`;
    const stream = `BT /F1 18 Tf 72 770 Td (${label} page ${index + 1}) Tj ET`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objects[next + 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

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
 * Builds the corpus once. Returns descriptors, not bytes, for the large cases
 * so callers can decide whether to pass a path or skip the heavy ones.
 */
export async function buildCorpus({ includeOversize = true } = {}) {
  await mkdir(CORPUS_DIR, { recursive: true });

  const onePage = buildPdf(1, 'corpus');
  const malformed = onePage.subarray(0, Math.floor(onePage.length * 0.6));
  const manyPages = buildPdf(2000, 'corpus');
  const scanned = await readFile(path.join(ROOT, 'tests/e2e/fixtures/imaged.pdf'));
  const encrypted = await readFile(
    path.join(ROOT, 'packages/pdf-core/test/fixtures/encrypted-aes128.pdf'),
  );

  const cases = [
    {
      id: 'empty',
      filename: 'empty.pdf',
      expectation: 'refuse',
      bytes: Buffer.alloc(0),
      note: '0-byte file',
    },
    {
      id: 'one-page',
      filename: 'one-page.pdf',
      expectation: 'accept',
      bytes: onePage,
      note: 'smallest valid document',
    },
    {
      id: 'many-pages',
      filename: 'many-pages-2000.pdf',
      expectation: 'refuse',
      bytes: manyPages,
      note: '2,000 pages, over the 500-page in-browser cap',
    },
    {
      id: 'encrypted',
      filename: 'encrypted-aes128.pdf',
      expectation: 'refuse',
      bytes: encrypted,
      note: 'AES-128, password-protected',
    },
    {
      id: 'scanned',
      filename: 'scanned.pdf',
      expectation: 'accept',
      bytes: scanned,
      note: 'image-only page, no text layer',
    },
    {
      id: 'malformed',
      filename: 'malformed.pdf',
      expectation: 'either',
      bytes: malformed,
      note: 'truncated mid-object (recovery is acceptable, silence is not)',
    },
    {
      id: 'not-a-pdf',
      filename: 'notes.pdf',
      expectation: 'refuse',
      bytes: Buffer.from('This is not a PDF at all.\n', 'utf8'),
      note: 'wrong magic bytes',
    },
    {
      id: 'unicode-name',
      filename: 'résumé-文档-٢٠٢٦.pdf',
      expectation: 'accept',
      bytes: onePage,
      note: 'non-ASCII filename, valid bytes',
    },
  ];

  if (includeOversize) {
    // 200 MB, past the 100 MB per-file limit. A real document is not needed:
    // the capacity guard must refuse before anything is parsed.
    const size = 200 * 1024 * 1024;
    const header = Buffer.from('%PDF-1.4\n', 'latin1');
    const tail = Buffer.from('\n%%EOF\n', 'latin1');
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const parts = [header];
    for (let written = header.length; written < size - tail.length; written += chunk.length) {
      parts.push(chunk);
    }
    parts.push(tail);
    cases.push({
      id: 'oversize',
      filename: 'oversize-200mb.pdf',
      expectation: 'refuse',
      bytes: Buffer.concat(parts),
      note: '200 MB, past the 100 MB per-file limit',
    });
  }

  for (const entry of cases) {
    const target = path.join(CORPUS_DIR, entry.filename);
    await writeFile(target, entry.bytes);
    entry.path = target;
    entry.size = entry.bytes.byteLength;
    delete entry.bytes;
  }

  return cases;
}

/** Q4 edges this environment cannot generate honestly. */
export const CORPUS_GAPS = [
  {
    edge: 'linearized',
    reason:
      'no qpdf/Ghostscript in this environment and no linearised fixture committed; a fake dictionary would test corruption, not linearisation',
  },
];
