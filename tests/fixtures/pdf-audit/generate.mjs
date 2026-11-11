/**
 * PDF audit fixture generator (read-only audit scaffolding).
 *
 * Every fixture is deterministic: same bytes on every run, no timestamps, no
 * randomness. Generated PDFs are committed next to this script so repro tests
 * do not need a build step.
 *
 *   node tests/fixtures/pdf-audit/generate.mjs
 *
 * Reused (not copied) fixtures live elsewhere in the repo; see FIXTURES.md for
 * the provenance table.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const require = createRequire(path.join(repo, 'packages/pdf-core/package.json'));

const {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} = require('@cantoo/pdf-lib');

/** Fixed creation dates so `doc.save()` stays byte-identical across runs. */
const EPOCH = new Date('2020-01-01T00:00:00Z');

async function save(doc, name) {
  const bytes = await doc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
  await writeFile(path.join(here, name), bytes);
  return `${name} (${bytes.length} bytes)`;
}

async function baseDoc(pages = 1) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`pdfshush audit fixture — page ${i + 1} of ${pages}`, {
      x: 72,
      y: 760,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return { doc, font };
}

/* ------------------------------------------------------------------ */
/* Generated with pdf-lib high-level API                               */
/* ------------------------------------------------------------------ */

async function tiny() {
  const { doc } = await baseDoc(1);
  return save(doc, 'tiny-1page.pdf');
}

async function multi() {
  const { doc, font } = await baseDoc(5);
  doc.getPages().forEach((page, i) => {
    page.drawText(`Distinct marker ${String.fromCharCode(65 + i)}${i + 1}`, {
      x: 72,
      y: 700,
      size: 24,
      font,
      color: rgb(0.7, 0.1, 0.1),
    });
  });
  return save(doc, 'multi-5page.pdf');
}

async function long() {
  const { doc, font } = await baseDoc(120);
  doc.getPages().forEach((page, i) => {
    page.drawText(`PAGE-NUMBER-${i + 1}`, {
      x: 72,
      y: 700,
      size: 12,
      font,
      color: rgb(0, 0, 0.8),
    });
  });
  return save(doc, 'long-120page.pdf');
}

async function rotated() {
  const { doc, font } = await baseDoc(2);
  const [square, portrait] = doc.getPages();
  // Rotated 90°: a probe drawn at a known display position must round-trip
  // through the rotation when the editor maps canvas ↔ PDF coordinates.
  square.setRotation(degrees(90));
  square.drawRectangle({ x: 40, y: 40, width: 60, height: 30, color: rgb(1, 0, 0) });
  square.drawText('ROTATED-90', { x: 50, y: 50, size: 12, font, color: rgb(1, 1, 1) });
  portrait.setRotation(degrees(0));
  portrait.drawText('UNROTATED', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  return save(doc, 'rotated-90.pdf');
}

async function cropbox() {
  const { doc, font } = await baseDoc(1);
  const [page] = doc.getPages();
  // MediaBox is the full letter sheet; CropBox starts at (50, 40) and is
  // 500x700. Coordinate mapping must use CropBox, not MediaBox.
  page.setMediaBox(0, 0, 612, 792);
  page.setCropBox(50, 40, 500, 700);
  page.drawText('CROPBOX-ORIGIN-50-40', { x: 60, y: 60, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText('CROPBOX-TOP-RIGHT', { x: 400, y: 700, size: 12, font, color: rgb(0, 0, 0) });
  return save(doc, 'cropbox-offset.pdf');
}

async function metadata() {
  const { doc } = await baseDoc(1);
  doc.setTitle('pdfshush metadata fixture');
  doc.setAuthor('pdfshush audit');
  doc.setSubject('Metadata preservation probe');
  doc.setKeywords(['pdf-audit', 'metadata', 'FIXTURE']);
  doc.setCreator('generate.mjs');
  doc.setProducer('pdfshush audit fixture generator');
  return save(doc, 'metadata.pdf');
}

async function acroform() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('ACROFORM FIXTURE', { x: 72, y: 780, size: 16, font, color: rgb(0, 0, 0) });

  const form = doc.getForm();

  const name = form.createTextField('person.name');
  name.setText('Ada Lovelace');
  name.addToPage(page, { x: 72, y: 700, width: 240, height: 24 });

  const agree = form.createCheckBox('person.agree');
  agree.check();
  agree.addToPage(page, { x: 72, y: 660, width: 18, height: 18 });

  const color = form.createRadioGroup('person.color');
  color.addOptionToPage('red', page, { x: 72, y: 620, width: 18, height: 18 });
  color.addOptionToPage('blue', page, { x: 120, y: 620, width: 18, height: 18 });
  color.select('red');

  const country = form.createDropdown('person.country');
  country.setOptions(['India', 'Japan', 'United States']);
  country.select('Japan');
  country.addToPage(page, { x: 72, y: 570, width: 180, height: 24 });

  const tags = form.createOptionList('person.tags');
  tags.setOptions(['alpha', 'beta', 'gamma']);
  tags.select('beta');
  tags.addToPage(page, { x: 72, y: 500, width: 180, height: 60 });

  return save(doc, 'acroform.pdf');
}

async function annotations() {
  const { doc, font } = await baseDoc(2);
  const { context } = doc;
  const [page] = doc.getPages();

  const rect = (x, y, w, h) => context.obj([x, y, x + w, y + h]);
  const quad = (x, y, w, h) =>
    context.obj([x, y + h, x + w, y + h, x, y, x + w, y]);

  const annots = [
    context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: rect(72, 700, 240, 18),
      QuadPoints: quad(72, 700, 240, 18),
      C: [1, 0.92, 0.2],
      CA: 0.5,
      F: 4,
    }),
    context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: rect(72, 600, 120, 60),
      C: [0.1, 0.3, 0.9],
      Border: [0, 1, 2],
      F: 4,
    }),
    context.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: rect(72, 520, 220, 40),
      Contents: PDFHexString.fromText('Free-text annotation body'),
      DA: PDFString.of('/Helv 12 Tf 0 g'),
      F: 4,
    }),
    context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect(72, 460, 200, 18),
      A: { Type: 'Action', S: 'URI', URI: PDFHexString.fromText('https://example.com/pdfshush') },
      Border: [0, 0, 0],
      F: 4,
    }),
  ].map((obj) => context.register(obj));

  page.node.set(PDFName.of('Annots'), context.obj(annots));
  page.drawText('Annotation host page', { x: 72, y: 740, size: 14, font, color: rgb(0, 0, 0) });
  return save(doc, 'annotations.pdf');
}

async function imageOnly() {
  const doc = await PDFDocument.create();
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const png = await readFile(path.join(repo, 'tests/e2e/fixtures/photo-a.png'));
  const image = await doc.embedPng(png);
  const page = doc.addPage([595, 842]);
  page.drawImage(image, { x: 72, y: 300, width: 400, height: 240 });
  return save(doc, 'image-only.pdf');
}

/* ------------------------------------------------------------------ */
/* Hand-built: non-embedded CJK and RTL fonts with a ToUnicode CMap     */
/* ------------------------------------------------------------------ */

/**
 * Builds a one-page PDF whose text uses a Type0/CIDFontType0 font that is
 * *not* embedded (the common real-world CJK case). A ToUnicode CMap carries
 * the codepoints so extraction is deterministic even when the viewer has no
 * matching font and must fall back for rendering.
 */
async function nonEmbedded({ name, baseFont, text, rightAligned = false }) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(EPOCH);
  doc.setModificationDate(EPOCH);
  const page = doc.addPage([595, 842]);
  const { context } = doc;

  const codepoints = [...text].map((ch) => ch.codePointAt(0));
  const hex = codepoints.map((cp) => cp.toString(16).padStart(4, '0')).join('').toUpperCase();

  const bfchar = codepoints
    .map((cp) => {
      const h = cp.toString(16).padStart(4, '0').toUpperCase();
      return `<${h}> <${h}>`;
    })
    .join('\n');

  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${codepoints.length} beginbfchar`,
    bfchar,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');

  const toUnicodeRef = context.register(context.flateStream(cmap));

  const descriptorRef = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: baseFont,
      Flags: 4,
      FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0,
      Ascent: 880,
      Descent: -120,
      CapHeight: 880,
      StemV: 80,
    }),
  );

  const descendantRef = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType0',
      BaseFont: baseFont,
      CIDSystemInfo: { Registry: 'Adobe', Ordering: 'Identity', Supplement: 0 },
      FontDescriptor: descriptorRef,
      DW: 1000,
    }),
  );

  const fontRef = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: [descendantRef],
      ToUnicode: toUnicodeRef,
    }),
  );

  const x = rightAligned ? 320 : 72;
  const content = `BT /F1 28 Tf ${x} 700 Td <${hex}> Tj ET`;
  const contentRef = context.register(context.flateStream(content));

  page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: fontRef } }));
  page.node.set(PDFName.of('Contents'), contentRef);

  return save(doc, name);
}

async function cjk() {
  return nonEmbedded({
    name: 'nonembedded-cjk.pdf',
    baseFont: 'STSong-Light',
    text: '你好，世界',
  });
}

async function rtl() {
  // Arabic in logical order. With Identity-H + ToUnicode the codepoints survive
  // extraction; shaping/bidi is the viewer's job.
  return nonEmbedded({
    name: 'nonembedded-rtl-arabic.pdf',
    baseFont: 'Tahoma',
    text: 'مرحبا بالعالم',
    rightAligned: true,
  });
}

/* ------------------------------------------------------------------ */
/* Derived: truncated copy of multi-5page.pdf                          */
/* ------------------------------------------------------------------ */

async function truncated() {
  const full = await readFile(path.join(here, 'multi-5page.pdf'));
  const cut = full.subarray(0, Math.floor(full.length * 0.6));
  await writeFile(path.join(here, 'corrupt-truncated.pdf'), cut);
  return `corrupt-truncated.pdf (${cut.length} bytes)`;
}

/* ------------------------------------------------------------------ */

const steps = [
  tiny,
  multi,
  long,
  rotated,
  cropbox,
  metadata,
  acroform,
  annotations,
  imageOnly,
  cjk,
  rtl,
];
const results = [];
for (const step of steps) results.push(await step());
results.push(await truncated());
console.log(results.join('\n'));
