/**
 * Fixture validation (read-only audit scaffolding, not a test).
 * Prints structural facts for every fixture so FIXTURES.md quotes observed
 * values, not guesses.
 *
 *   node docs/pdf-audit/.baseline/validate-fixtures.mjs
 */
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'packages/pdf-core/package.json'));
const { PDFDocument } = require('@cantoo/pdf-lib');
const pdfjs = await import(
  pathToFileURL(
    path.join(repo, 'node_modules/.pnpm/pdfjs-dist@6.4.299/node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
  ).href
);

const dir = path.join(repo, 'tests/fixtures/pdf-audit');
const files = (await readdir(dir)).filter((f) => f.endsWith('.pdf')).sort();

async function viaPdfLib(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages().map((p) => ({
    rotate: p.getRotation().angle,
    crop: p.getCropBox(),
    media: p.getMediaBox(),
    annots: p.node.Annots()?.size() ?? 0,
  }));
  const form = doc.getForm();
  return {
    pages: pages.length,
    first: pages[0],
    fields: form.getFields().map((f) => `${f.getName()}:${f.constructor.name}`),
    title: doc.getTitle() ?? null,
    author: doc.getAuthor() ?? null,
    subject: doc.getSubject() ?? null,
    keywords: doc.getKeywords() ?? null,
  };
}

async function viaPdfJs(bytes) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(
      repo,
      'node_modules/.pnpm/pdfjs-dist@6.4.299/node_modules/pdfjs-dist/standard_fonts/',
    ).replaceAll('\\', '/'),
    cMapUrl: path.join(
      repo,
      'node_modules/.pnpm/pdfjs-dist@6.4.299/node_modules/pdfjs-dist/cmaps/',
    ).replaceAll('\\', '/'),
    cMapPacked: true,
  });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);
  const texts = [];
  const limit = Math.min(doc.numPages, 3);
  for (let i = 1; i <= limit; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((it) => it.str).join('|'));
  }
  const annots = await (await doc.getPage(1)).getAnnotations().catch(() => []);
  const result = {
    pages: doc.numPages,
    view: (await doc.getPage(1)).view,
    rotate: (await doc.getPage(1)).rotate,
    texts,
    annots: annots.map((a) => a.subtype),
    meta: meta?.info ?? null,
  };
  await task.destroy();
  return result;
}

for (const file of files) {
  const bytes = await readFile(path.join(dir, file));
  console.log(`\n## ${file} (${bytes.length} bytes)`);
  try {
    console.log('pdf-lib:', JSON.stringify(await viaPdfLib(bytes)));
  } catch (err) {
    console.log('pdf-lib: ERROR', err.message);
  }
  try {
    console.log('pdfjs  :', JSON.stringify(await viaPdfJs(bytes)));
  } catch (err) {
    console.log('pdfjs  : ERROR', err.message);
  }
}
