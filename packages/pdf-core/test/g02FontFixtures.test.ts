import { beforeAll, describe, expect, it } from 'vitest';
import {
  PDFDict,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import {
  applyEdits,
  collectFontPrograms,
  configurePdfjsRuntime,
  DocumentFontResolver,
  extractTextRuns,
  parseOperations,
  planGlyphRemoval,
  readPageFontMetrics,
  scanPageText,
  tokenizeContentStream,
  type EditorObject,
} from '../src/index.js';
import { FONT_FIXTURE_MANIFEST, VENDORED_FONT_SHA256, buildFontFixture, type FontFixtureKind } from './corpus/fontFixtures.js';
import { testContext } from './fixtures.js';

function readBytes(url: URL): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
  return fs.readFileSync(url);
}

function sha256(bytes: Uint8Array): string {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const crypto = proc.getBuiltinModule('node:crypto') as {
    createHash(name: string): { update(data: Uint8Array): { digest(encoding: string): string } };
  };
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

async function loaded(kind: FontFixtureKind) {
  const fixture = await buildFontFixture(kind);
  const doc = await PDFDocument.load(fixture.bytes);
  const page = doc.getPages()[0]!;
  const entries = page.node.normalizedEntries();
  const resources = entries.Resources
    ? doc.context.lookup(entries.Resources as never)
    : undefined;
  if (!(resources instanceof PDFDict)) throw new Error(`${kind}: page has no resources`);
  const fonts = readPageFontMetrics(resources);
  const content = entries.Contents;
  if (!content) throw new Error(`${kind}: page has no content`);
  const parts: string[] = [];
  for (let index = 0; index < content.size(); index += 1) {
    const value = content.lookup(index);
    if (!(value instanceof PDFRawStream)) continue;
    try {
      parts.push(new TextDecoder('latin1').decode(decodePDFRawStream(value).decode()));
    } catch {
      parts.push(new TextDecoder('latin1').decode(value.getContents()));
    }
  }
  const source = new TextEncoder().encode(parts.join('\n'));
  return { fixture, doc, page, resources, fonts, source };
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const runs = await extractTextRuns(bytes, [0]);
  return runs.flat().map((run) => run.text).join('\n');
}

describe('font-shape corpus (G-02/F-01)', () => {
  it('declares a unique kind, a failure and a readable shape for every fixture', () => {
    const kinds = FONT_FIXTURE_MANIFEST.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const entry of FONT_FIXTURE_MANIFEST) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.guards).toMatch(/^[CF]-\d+/);
      expect(Boolean(entry.expectText) || entry.expectStreamRefusal).toBe(true);
    }
  });

  it('pins the vendored CFF font and builds every font fixture deterministically', async () => {
    const font = readBytes(
      new URL('./fixtures/fonts/SourceCodePro-Regular.otf', import.meta.url),
    );
    expect(sha256(font)).toBe(VENDORED_FONT_SHA256);
    for (const entry of FONT_FIXTURE_MANIFEST) {
      const first = await buildFontFixture(entry.kind as FontFixtureKind);
      const second = await buildFontFixture(entry.kind as FontFixtureKind);
      expect(second.bytes, `${entry.kind} must be byte-stable`).toEqual(first.bytes);
    }
  });

  it('reads Type3 widths through FontMatrix and reports the shape as unsupported for rewriting', async () => {
    const { fixture, fonts, resources, source } = await loaded('type3');
    const metrics = fonts.get('F1');
    expect(metrics?.subtype).toBe('Type3');
    expect(metrics?.reliable).toBe(true);
    expect(metrics?.widthFor(0)).toBeCloseTo(500, 3);
    expect(metrics?.unicodeFor(1)).toBe('b');
    expect(await pageText(fixture.bytes)).toContain('abc');

    const operations = parseOperations(tokenizeContentStream(source));
    const scan = scanPageText(operations, fonts, resources);
    expect(scan.type3).toBe(true);
    expect(scan.unsupported.some((reason) => /Type3/i.test(reason))).toBe(true);
  });

  it('trusts Identity-H Type0 widths and refuses a non-Identity CMap', async () => {
    const identity = await loaded('type0-identity');
    const identityMetrics = identity.fonts.get('F1');
    expect(identityMetrics?.subtype).toBe('Type0');
    expect(identityMetrics?.codeByteLength).toBe(2);
    expect(identityMetrics?.reliable).toBe(true);
    expect(identityMetrics?.widthFor(65)).toBeCloseTo(500, 3);
    expect(identityMetrics?.widthFor(66)).toBeCloseTo(600, 3);
    expect(await pageText(identity.fixture.bytes)).toContain('AB');

    const nonIdentity = await loaded('type0-nonidentity');
    const metrics = nonIdentity.fonts.get('F1');
    expect(metrics?.reliable).toBe(false);
    expect(metrics?.reason ?? '').toMatch(/non-Identity/i);
    const operations = parseOperations(tokenizeContentStream(nonIdentity.source));
    const scan = scanPageText(operations, nonIdentity.fonts, nonIdentity.resources);
    const run = scan.runs[0];
    if (run) {
      const refusal = planGlyphRemoval(run, { start: 0, end: 1 }, nonIdentity.source);
      expect('reason' in refusal ? refusal.reason : '').toMatch(/non-Identity|not reliable/i);
    }
  });

  it('extracts and re-embeds a CFF/OpenType document font', async () => {
    const { fixture, doc, page } = await loaded('cff-otf');
    const programs = collectFontPrograms(doc, [page]);
    expect(programs.size).toBeGreaterThan(0);
    const program = [...programs.values()].find(
      (entry) => entry.format === 'cff' || entry.format === 'opentype',
    );
    expect(program, 'CFF/OpenType programme').toBeDefined();
    const resolver = new DocumentFontResolver(doc, programs);
    expect(await resolver.embed(program!.baseName)).not.toBeNull();

    const overlay: EditorObject = {
      id: 'cff-overlay',
      kind: 'text',
      role: 'content',
      pageIndex: 0,
      x: 40,
      y: 40,
      width: 260,
      height: 40,
      text: 'CFF \u03a9',
      fontSize: 20,
      fontKey: program!.baseName,
    };
    const out = await PDFDocument.load(fixture.bytes);
    await applyEdits(out, [overlay], testContext());
    const bytes = await out.save({ useObjectStreams: false });
    expect(await pageText(bytes)).toContain('CFF \u03a9');
    expect(
      [...collectFontPrograms(await PDFDocument.load(bytes)).values()].some(
        (entry) => entry.format === 'cff' || entry.format === 'opentype',
      ),
    ).toBe(true);
  });
});
