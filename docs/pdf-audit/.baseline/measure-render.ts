/**
 * Page-render probe for the PDF audit (docs/pdf-audit/METRICS.md, session 3).
 *
 * Measures the real render pipeline over the 120-page fixture:
 *   - cold first-page render time (load + parse + paint + encode)
 *   - per-page time for a warm 20-page editor-width scroll window
 *   - peak RSS while that window is rendered
 *   - the same for a full 120-page thumbnail pass (grid-tool path)
 *
 * Browser frame timing is not available in Node; the per-page number is the
 * cost each page adds to the worker queue, and it is compared against the
 * 16.7 ms frame budget. The browser scroll probe lives in METRICS.md.
 *
 *   pnpm --filter @pdfshush/pdf-core exec tsx \
 *     ../../docs/pdf-audit/.baseline/measure-render.ts
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  configurePdfjsRuntime,
  loadPdfForRender,
  resetPdfCache,
} from '../../../packages/pdf-core/src/render/pdfjsRuntime.js';
import { renderPageToImage } from '../../../packages/pdf-core/src/render/renderPage.js';
import type { CanvasFactory, RenderCanvas } from '../../../packages/pdf-core/src/render/canvas.js';

// The probe lives outside the package, so resolve the polyfill from pdf-core
// (its own devDependency) rather than from this directory.
const requirePdfCore = createRequire(
  new URL('../../../packages/pdf-core/package.json', import.meta.url),
);
const { createCanvas } = requirePdfCore('@napi-rs/canvas') as typeof import('@napi-rs/canvas');

configurePdfjsRuntime({
  workerSrc: new URL(
    '../../../packages/pdf-core/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.resolve(here, '../../../tests/fixtures/pdf-audit/long-120page.pdf');
const bytes = new Uint8Array(readFileSync(fixture));

function factory(width: number, height: number): RenderCanvas {
  const canvas = createCanvas(width, height);
  return {
    width,
    height,
    context: canvas.getContext('2d'),
    async toBlob(type: string, quality?: number) {
      const buffer =
        type === 'image/jpeg'
          ? await canvas.encode('jpeg', quality ? Math.round(quality * 100) : 90)
          : await canvas.encode('png');
      return new Blob([new Uint8Array(buffer)], { type });
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

const canvasFactory: CanvasFactory = factory;

interface Peak {
  rss: number;
  heap: number;
}

function sample(peak: Peak): void {
  const usage = process.memoryUsage();
  peak.rss = Math.max(peak.rss, usage.rss);
  peak.heap = Math.max(peak.heap, usage.heapUsed);
}

async function firstPage(targetWidthPx: number, label: string): Promise<void> {
  const runs: number[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await resetPdfCache();
    const started = performance.now();
    const { doc, destroy } = await loadPdfForRender(bytes);
    try {
      const page = await doc.getPage(1);
      await renderPageToImage(page, { targetWidthPx, format: 'png', canvasFactory });
      page.cleanup();
    } finally {
      await destroy();
    }
    runs.push(performance.now() - started);
  }
  runs.sort((a, b) => a - b);
  console.log(JSON.stringify({ metric: 'first-page', label, targetWidthPx, runsMs: runs.map(round), medianMs: round(runs[1] ?? runs[0] ?? 0) }));
}

async function sweep(
  label: string,
  targetWidthPx: number,
  pages: number[],
  format: 'png' | 'jpeg',
): Promise<void> {
  await resetPdfCache();
  const peak: Peak = { rss: 0, heap: 0 };
  const pageTimes: number[] = [];
  const started = performance.now();
  const { doc, destroy } = await loadPdfForRender(bytes);
  try {
    for (const index of pages) {
      const pageStarted = performance.now();
      const page = await doc.getPage(index + 1);
      try {
        await renderPageToImage(page, {
          targetWidthPx,
          format,
          ...(format === 'jpeg' ? { quality: 0.72 } : {}),
          canvasFactory,
        });
      } finally {
        page.cleanup();
      }
      pageTimes.push(performance.now() - pageStarted);
      sample(peak);
    }
  } finally {
    await destroy();
  }
  const total = performance.now() - started;
  const sorted = [...pageTimes].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      metric: 'sweep',
      label,
      targetWidthPx,
      format,
      pages: pages.length,
      totalMs: round(total),
      meanPageMs: round(total / pages.length),
      medianPageMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      p95PageMs: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0),
      maxPageMs: round(sorted[sorted.length - 1] ?? 0),
      peakRssMb: round(peak.rss / (1024 * 1024)),
      peakHeapMb: round(peak.heap / (1024 * 1024)),
    }),
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

await firstPage(1600, 'pdf-to-images default');
await firstPage(2560, 'pdf-to-images print');
await sweep('editor window (20 pages, fit-width ~1339px)', 1339, Array.from({ length: 20 }, (_, i) => i), 'jpeg');
await sweep('thumbnail grid (120 pages, 160px)', 160, Array.from({ length: 120 }, (_, i) => i), 'jpeg');
