/**
 * H-03 editor ceilings.
 *
 * The product baseline measures routes. This instrument measures the work an
 * edit session actually pays for: opening a 100-page document, inspecting text
 * capabilities, exporting a 10,000-point ink stroke, and tokenising a large
 * content stream. It prints one table so `tests/benchmarks/editor-ceilings.md`
 * records numbers from a command, not prose.
 *
 * Ceilings are deliberately generous: this catches order-of-magnitude
 * regressions on a shared runner, not a few milliseconds of noise. Set
 * `EDITOR_BENCH_CI=1` for the wider public-runner budget.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';

import { applyEdits, type EditorObject } from '../src/ops/edit.js';
import { inspectPdf } from '../src/ops/pages.js';
import { inspectDocumentCapabilities } from '../src/textedit/capabilities.js';
import {
  configurePdfiumRuntime,
  loadPdfiumModule,
} from '../src/textedit/runtime.js';
import {
  emitContentStream,
  parseOperations,
  tokenizeContentStream,
} from '../src/textedit/stream/lexer.js';
import { makeFixturePdf, testContext } from './fixtures.js';

const CI = (globalThis as unknown as { process: { env: Record<string, string> } }).process.env
  .EDITOR_BENCH_CI === '1';

const CEILING = CI
  ? {
      inspect100Pages: 8_000,
      capabilities100Pages: 20_000,
      ink10kExport: 5_000,
      contentStream: 4_000,
      onePageEdit: 3_000,
    }
  : {
      inspect100Pages: 4_000,
      capabilities100Pages: 10_000,
      ink10kExport: 2_500,
      contentStream: 2_000,
      onePageEdit: 1_500,
    };

const measurements: Array<{ label: string; ms: number; detail: string }> = [];

function record(label: string, ms: number, detail: string) {
  measurements.push({ label, ms, detail });
  console.log(`  ${label}: ${ms.toFixed(0)} ms -- ${detail}`);
}

function readPdfiumWasm(): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
  return fs.readFileSync(
    new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm', import.meta.url),
  );
}

beforeAll(async () => {
  configurePdfiumRuntime({ wasmBinary: readPdfiumWasm() });
  await loadPdfiumModule();
});

describe('editor ceilings', () => {
  it('opens and inspects a 100-page document within the ceiling', async () => {
    const bytes = await makeFixturePdf({ pages: 100, label: 'Bench' });
    const started = performance.now();
    const info = await inspectPdf(bytes);
    const ms = performance.now() - started;
    expect(info.pageCount).toBe(100);
    record('open/inspect 100 pages', ms, `${info.pageCount} pages, ${(bytes.byteLength / 1024).toFixed(0)} kB`);
    expect(ms).toBeLessThan(CEILING.inspect100Pages);
  }, 60_000);

  it('walks 100 pages of PDFium text capabilities within the ceiling', async () => {
    const bytes = await makeFixturePdf({ pages: 100, label: 'Capabilities' });
    const module = await loadPdfiumModule();
    const started = performance.now();
    const result = inspectDocumentCapabilities(bytes, { module });
    const ms = performance.now() - started;
    expect(result.pages).toHaveLength(100);
    record('capabilities 100 pages', ms, `${result.pages.filter((page) => page.textLayer === 'native').length} native pages`);
    expect(ms).toBeLessThan(CEILING.capabilities100Pages);
  }, 90_000);

  it('exports 10,000 ink points (two capped strokes) within the ceiling', async () => {
    const bytes = await makeFixturePdf({ pages: 1 });
    const doc = await PDFDocument.load(bytes);
    const points = Array.from({ length: 5_000 }, (_, index) => ({
      x: 10 + (index % 100),
      y: 10 + Math.floor(index / 100),
    }));
    const strokes: EditorObject[] = [0, 1].map((index) => ({
      id: `bench-ink-${index}`,
      kind: 'ink',
      pageIndex: 0,
      x: 40 + index * 140,
      y: 80,
      width: 120,
      height: 120,
      points,
      stroke: '#1f293b',
      strokeWidth: 2,
    }));
    const started = performance.now();
    await applyEdits(doc, strokes, testContext());
    const saved = await doc.save({ useObjectStreams: false });
    const ms = performance.now() - started;
    expect(saved.byteLength).toBeGreaterThan(bytes.byteLength);
    record('10k ink points export', ms, `${(points.length * 2).toLocaleString()} points, 2 capped strokes`);
    expect(ms).toBeLessThan(CEILING.ink10kExport);
  }, 60_000);

  it('applies one text edit on a 100-page document within the ceiling', async () => {
    const bytes = await makeFixturePdf({ pages: 100 });
    const doc = await PDFDocument.load(bytes);
    const started = performance.now();
    await applyEdits(
      doc,
      [
        {
          id: 'bench-text',
          kind: 'text',
          pageIndex: 0,
          x: 40,
          y: 120,
          width: 220,
          height: 28,
          text: 'Bench replacement text',
          fontSize: 16,
          fontFamily: 'helvetica',
          color: '#111827',
        },
      ],
      testContext(),
    );
    const saved = await doc.save({ useObjectStreams: false });
    const ms = performance.now() - started;
    expect(saved.byteLength).toBeGreaterThan(0);
    record('one text edit, 100-page doc', ms, 'one overlay object');
    expect(ms).toBeLessThan(CEILING.onePageEdit);
  }, 60_000);

  it('round-trips a large content stream within the ceiling', () => {
    const line = 'BT /F1 12 Tf 1 0 0 1 72 720 Tm (Invoice line 00001) Tj ET\n';
    const source = new TextEncoder().encode(line.repeat(20_000));
    const started = performance.now();
    const tokens = tokenizeContentStream(source);
    const operations = parseOperations(tokens);
    const emitted = emitContentStream(source, tokens);
    const ms = performance.now() - started;
    expect(operations.length).toBe(100_000);
    expect(emitted.byteLength).toBe(source.byteLength);
    const mb = source.byteLength / (1024 * 1024);
    record('content-stream tokenise/emit', ms, `${mb.toFixed(1)} MB, ${operations.length.toLocaleString()} ops`);
    expect(ms).toBeLessThan(CEILING.contentStream);
  }, 60_000);

  it('prints the table consumed by the benchmark record', () => {
    console.log('\n| measurement | result | ceiling | detail |');
    console.log('| --- | --- | --- | --- |');
    for (const row of measurements) {
      const ceiling =
        row.label.startsWith('open')
          ? CEILING.inspect100Pages
          : row.label.startsWith('capabilities')
            ? CEILING.capabilities100Pages
            : row.label.startsWith('10k')
              ? CEILING.ink10kExport
              : row.label.startsWith('one text')
                ? CEILING.onePageEdit
                : CEILING.contentStream;
      console.log(`| ${row.label} | ${row.ms.toFixed(0)} ms | ${ceiling} ms | ${row.detail} |`);
    }
    expect(measurements.length).toBe(5);
  });
});
