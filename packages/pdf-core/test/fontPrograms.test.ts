/**
 * Document-font embedding (F-01).
 *
 * Proves the overlay draw path can re-embed a font programme taken from the
 * source PDF, so text with glyphs outside WinAnsi survives export instead of
 * being refused or mangled. The fixture uses pdf.js' Liberation Sans, which
 * carries Greek and Cyrillic; the replacement text uses glyphs the source
 * already embeds, so subsetting stays deterministic.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';
import {
  applyEdits,
  collectFontPrograms,
  configurePdfjsRuntime,
  editPdfText,
  extractTextRuns,
  validateEditObjects,
  DocumentFontResolver,
  type EditorObject,
} from '../src/index.js';
import { testContext } from './fixtures.js';

function readBytes(url: URL): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
  return fs.readFileSync(url);
}

const LIBERATION = new URL(
  '../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
  import.meta.url,
);

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

async function sourceWithGreek(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readBytes(LIBERATION), { subset: false });
  const page = doc.addPage([400, 300]);
  page.drawText('Ωμέγα', { x: 40, y: 240, size: 24, font });
  return doc.save({ useObjectStreams: false });
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const runs = await extractTextRuns(bytes, [0]);
  return runs[0]!.map((run) => run.text).join('\n');
}

function overlay(fontKey: string | undefined, text: string): EditorObject {
  return {
    id: 'doc-font',
    kind: 'text',
    role: 'content',
    pageIndex: 0,
    x: 40,
    y: 36,
    width: 260,
    height: 40,
    text,
    fontSize: 24,
    ...(fontKey ? { fontKey } : {}),
  };
}

describe('document font programmes', () => {
  it('finds the embedded programme and resolves aliases', async () => {
    const source = await sourceWithGreek();
    const doc = await PDFDocument.load(source);
    const programs = collectFontPrograms(doc);
    expect(programs.size).toBeGreaterThan(0);
    const names = [...programs.values()].map((program) => program.baseName.toLowerCase());
    expect(names.some((name) => name.includes('liberation'))).toBe(true);
    const resolver = new DocumentFontResolver(doc, programs);
    const program = [...programs.values()][0]!;
    expect(resolver.has(program.baseName)).toBe(true);
    expect(await resolver.embed(program.baseName)).not.toBeNull();
  });

  it('draws non-WinAnsi text with the document font instead of refusing it', async () => {
    const source = await sourceWithGreek();
    const doc = await PDFDocument.load(source);
    const programs = collectFontPrograms(doc);
    const fontKey = [...programs.values()][0]!.baseName;

    const out = await PDFDocument.load(source);
    await applyEdits(out, [overlay(fontKey, 'Ωμέγα 2')], testContext());
    const bytes = await out.save({ useObjectStreams: false });
    expect(await pageText(bytes)).toContain('Ωμέγα 2');
    expect(await pageText(bytes)).not.toContain('????');
  });

  it('still refuses non-WinAnsi text when no document font is named', async () => {
    expect(() => validateEditObjects([overlay(undefined, 'Ωμέγα')], 1)).toThrow(
      /cannot be drawn with the standard font/,
    );
    const source = await sourceWithGreek();
    const doc = await PDFDocument.load(source);
    const programs = collectFontPrograms(doc);
    const fontKey = [...programs.values()][0]!.baseName;
    expect(() => validateEditObjects([overlay(fontKey, 'Ωμέγα')], 1)).not.toThrow();
  });

  it('works through the text-edit job and survives its verification gate', async () => {
    const source = await sourceWithGreek();
    const doc = await PDFDocument.load(source);
    const programs = collectFontPrograms(doc);
    const fontKey = [...programs.values()][0]!.baseName;
    const result = await editPdfText(
      source,
      {
        edits: [],
        objects: [overlay(fontKey, 'Ωμέγα 3')],
      },
      testContext(),
    );
    expect(await pageText(result.bytes)).toContain('Ωμέγα 3');
    expect(await pageText(result.bytes)).not.toContain('????');
  });
});
