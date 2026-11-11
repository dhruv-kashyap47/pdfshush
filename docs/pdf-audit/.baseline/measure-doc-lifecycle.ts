/**
 * Document lifecycle probe for the PDF audit (docs/pdf-audit/METRICS.md).
 *
 * Opens and closes the 120-page fixture 20 times through the real pdf.js
 * runtime and reports peak memory, worker count and live document objects.
 *
 * Two modes:
 *   cached   -- the production path: load, read a page, destroy. The LRU cache
 *               is allowed to keep the last parsed document (that is its job),
 *               so exactly one document object should remain.
 *   cold     -- the same cycle with `resetPdfCache()` each time. Nothing may
 *               survive the final reset; this is the leak check for the
 *               loading task / worker destruction path.
 *
 * Run with GC exposed so "leaked" means "still reachable after collection":
 *
 *   pnpm --filter @pdfshush/pdf-core exec tsx --expose-gc \
 *     ../../docs/pdf-audit/.baseline/measure-doc-lifecycle.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import v8 from 'node:v8';
import {
  configurePdfjsRuntime,
  loadPdfForRender,
  resetPdfCache,
} from '../../../packages/pdf-core/src/render/pdfjsRuntime.js';

/** Attached to each loaded proxy; a live marker means a live document. */
class DocMarker {}

const CYCLES = 20;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, '../../../tests/fixtures/pdf-audit/long-120page.pdf');
const bytes = new Uint8Array(readFileSync(fixturePath));

configurePdfjsRuntime({
  workerSrc: new URL(
    '../../../packages/pdf-core/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href,
});

const collect = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) {
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const workerCount = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;

const liveDocuments = (): number => v8.queryObjects(DocMarker) as unknown as number;

interface Sample {
  heapUsedMb: number;
  rssMb: number;
  workerPorts: number;
  liveDocuments: number;
}

const mb = (value: number): number => Math.round((value / (1024 * 1024)) * 10) / 10;

async function sample(): Promise<Sample> {
  await collect();
  const memory = process.memoryUsage();
  return {
    heapUsedMb: mb(memory.heapUsed),
    rssMb: mb(memory.rss),
    workerPorts: workerCount(),
    liveDocuments: liveDocuments(),
  };
}

/**
 * One open/read/close cycle. Kept in its own function so the last iteration's
 * local bindings cannot be mistaken for a leak when `sample()` runs.
 */
async function cycle(mode: 'cached' | 'cold', first: boolean): Promise<void> {
  const loaded = await loadPdfForRender(bytes);
  // The marker is reachable only through the document proxy: a live marker
  // after a collection is a document the runtime did not release.
  (loaded.doc as unknown as { __auditMarker?: DocMarker }).__auditMarker = new DocMarker();
  if (first) console.log('resources during first load:', process.getActiveResourcesInfo());
  try {
    const page = await loaded.doc.getPage(1);
    try {
      await page.getTextContent();
    } finally {
      page.cleanup();
    }
  } finally {
    await loaded.destroy();
  }
  if (mode === 'cold') await resetPdfCache();
}

async function run(mode: 'cached' | 'cold'): Promise<{
  mode: string;
  before: Sample;
  after: Sample;
  peakRssMb: number;
  peakHeapUsedMb: number;
  peakLiveHeapMb: number;
  checkpoints: { cycle: number; heapUsedMb: number; rssMb: number; liveDocuments: number }[];
}> {
  await resetPdfCache();
  await collect();
  const before = await sample();
  let peakRss = before.rssMb;
  let peakHeap = before.heapUsedMb;
  let peakLiveHeap = before.heapUsedMb;
  const checkpoints: { cycle: number; heapUsedMb: number; rssMb: number; liveDocuments: number }[] = [];

  for (let i = 0; i < CYCLES; i += 1) {
    await cycle(mode, i === 0);

    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, mb(memory.rss));
    peakHeap = Math.max(peakHeap, mb(memory.heapUsed));
    await collect();
    const live = mb(process.memoryUsage().heapUsed);
    peakLiveHeap = Math.max(peakLiveHeap, live);
    if (i === 0 || (i + 1) % 5 === 0) {
      checkpoints.push({
        cycle: i + 1,
        heapUsedMb: live,
        rssMb: mb(process.memoryUsage().rss),
        liveDocuments: liveDocuments(),
      });
    }
  }

  const after = await sample();
  await resetPdfCache();
  return {
    mode,
    before,
    after,
    peakRssMb: peakRss,
    peakHeapUsedMb: peakHeap,
    peakLiveHeapMb: peakLiveHeap,
    checkpoints,
  };
}

const results = [await run('cold'), await run('cached')];
console.log(
  JSON.stringify(
    {
      fixture: 'long-120page.pdf',
      fixtureBytes: bytes.byteLength,
      cycles: CYCLES,
      results,
    },
    null,
    2,
  ),
);
