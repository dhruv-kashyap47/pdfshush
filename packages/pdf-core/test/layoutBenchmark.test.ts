/**
 * Layout-intelligence benchmark: before/after numbers for Phase 3.
 *
 * This test is the *measurement instrument*, not the spec. It renders a
 * deterministic synthetic corpus (exact ground truth, dev + held-out seeds),
 * runs the extraction pipeline exactly as production does, and prints one
 * table of every metric the phase promised to move. It runs on the current
 * code so the same command yields a "before" row and an "after" row.
 *
 * Assertions here only prove the harness works (lines match, cases build);
 * accuracy targets live in `textModel.test.ts` / the phase record in PLAN.md,
 * so a weak model never makes this file "pass" by being weak.
 */

import { describe, expect, it } from 'vitest';

import { extractPageLayouts } from '../src/render/textLayout.js';
import { configurePdfjsRuntime, resetPdfCache } from '../src/render/pdfjsRuntime.js';
import {
  ALL_CASE_NAMES,
  DEV_SEEDS,
  HELD_OUT_SEEDS,
  buildCase,
  casePlan,
  type SyntheticCase,
} from './corpus/synthetic.js';
import { scoreCorpus, type CorpusScore } from './corpus/metrics.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href,
});

const DEV_PLAN = casePlan(DEV_SEEDS);
const HELD_OUT_PLAN = casePlan(HELD_OUT_SEEDS);

/**
 * pdf-core compiles with `types: []`, so node builtins are reached the same way
 * `textEditGates.test.ts` reaches them -- through the runtime's own loader.
 */
function nodeBuiltin<T>(name: string): T {
  const proc = (
    globalThis as unknown as { process: { getBuiltinModule(name: string): unknown } }
  ).process;
  return proc.getBuiltinModule(name) as T;
}

interface FsLike {
  writeFileSync(path: string, data: string, encoding: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
}

async function runCases(
  plan: readonly { name: (typeof ALL_CASE_NAMES)[number]; seed: number }[],
): Promise<{ testCase: SyntheticCase; layouts: Awaited<ReturnType<typeof extractPageLayouts>>; ms: number }[]> {
  const out = [];
  for (const { name, seed } of plan) {
    const testCase = await buildCase(name, seed);
    const started = performance.now();
    const layouts = await extractPageLayouts(testCase.bytes);
    const ms = performance.now() - started;
    out.push({ testCase, layouts, ms });
  }
  return out;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(score: CorpusScore, label: string, latencies: number[]): string {
  const t = score.totals;
  const lines = [
    `### ${label}`,
    '',
    '| metric | value |',
    '| --- | --- |',
    `| paragraph grouping P / R / F1 | ${pct(t.grouping.precision)} / ${pct(t.grouping.recall)} / ${pct(t.grouping.f1)} |`,
    `| reading-order accuracy | ${pct(t.readingOrder.accuracy)} (${t.readingOrder.correct}/${t.readingOrder.pairs}) |`,
    `| role accuracy | ${pct(t.roles.accuracy)} (${t.roles.correct}/${t.roles.total}) |`,
    `| heading-level accuracy | ${pct(t.headingLevels.accuracy)} (${t.headingLevels.correct}/${t.headingLevels.total}) |`,
    `| list-level accuracy | ${pct(t.listLevels.accuracy)} (${t.listLevels.correct}/${t.listLevels.total}) |`,
    `| column accuracy | ${pct(t.columns.accuracy)} (${t.columns.correct}/${t.columns.total}) |`,
    `| font family / bold / italic | ${pct(t.fonts.family.accuracy)} / ${pct(t.fonts.bold.accuracy)} / ${pct(t.fonts.italic.accuracy)} |`,
    `| table cell P / R | ${pct(t.tables.precision)} / ${pct(t.tables.recall)} (${t.tables.matchedCells}/${t.tables.gtCells} in ${t.tables.detectedTables}/${t.tables.gtTables} tables) |`,
    `| line recall | ${pct(t.lineRecall)} |`,
    `| confidence AUROC | ${t.confidence.auroc === null ? 'n/a' : t.confidence.auroc.toFixed(3)} |`,
    `| confidence spread (sd) | ${t.confidence.spread.toFixed(4)} |`,
    `| mean conf correct / wrong | ${t.confidence.meanCorrect.toFixed(3)} / ${t.confidence.meanIncorrect.toFixed(3)} |`,
    `| flagged wrong / unflagged wrong | ${t.confidence.flaggedWrong}/${t.confidence.flaggedTotal} / ${t.confidence.unflaggedWrong} |`,
    `| reflow accuracy (false-safe / false-refuse) | ${pct(t.reflow.accuracy)} (${t.reflow.falseSafe} / ${t.reflow.falseRefuse}) |`,
    `| extraction latency per page | ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)} ms |`,
    '',
  ];
  return lines.join('\n');
}

function caseTable(score: CorpusScore): string {  const rows = score.cases.map(
    (c) =>
      `| ${c.name} | ${pct(c.totals.grouping.f1)} | ${pct(c.totals.readingOrder.accuracy)} | ${pct(
        c.totals.roles.accuracy,
      )} | ${pct(c.totals.tables.recall)} | ${pct(c.totals.confidence.spread)} | ${pct(
        c.reflow.accuracy,
      )} |`,
  );
  return [
    '| case | grouping F1 | reading order | roles | table recall | conf spread | reflow |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * Scroll-shaped access: fetch pages one at a time, the way the editor does when
 * the user moves through a document. With `dropCache` the parsed document is
 * evicted between reads, which is exactly what the pre-Phase-3 code did on every
 * call (a fresh parse and a fresh pdf.js worker per page read).
 */
async function measureScroll(
  bytes: Uint8Array,
  pageCount: number,
  dropCache = false,
): Promise<number> {
  const started = performance.now();
  for (let index = 0; index < pageCount; index += 1) {
    if (dropCache) await resetPdfCache();
    await extractPageLayouts(bytes, { pageIndexes: [index] });
  }
  return performance.now() - started;
}

describe('layout intelligence benchmark', () => {
  it(
    'scores the synthetic corpus (dev + held-out) and reports every metric',
    { timeout: 600_000 },
    async () => {
      const dev = await runCases(DEV_PLAN);
      const heldOut = await runCases(HELD_OUT_PLAN);

      // Harness sanity: every case must produce one layout per page and the
      // matcher must find nearly all drawn lines, otherwise the metrics below
      // would be scoring a broken harness rather than the model.
      for (const { testCase, layouts } of [...dev, ...heldOut]) {
        expect(layouts).toHaveLength(testCase.truth.pages.length);
      }

      const devScore = scoreCorpus(dev);
      const heldOutScore = scoreCorpus(heldOut);
      expect(devScore.totals.lineRecall).toBeGreaterThan(0.95);
      expect(heldOutScore.totals.lineRecall).toBeGreaterThan(0.95);

      // Repeated single-page reads must return the same model (the cache must
      // never change what the caller sees).
      const repeatCase = await buildCase('prose', 11);
      const firstPass = await extractPageLayouts(repeatCase.bytes, { pageIndexes: [0] });
      const secondPass = await extractPageLayouts(repeatCase.bytes, { pageIndexes: [0] });
      expect(secondPass[0]!.paragraphs.map((paragraph) => paragraph.id)).toEqual(
        firstPass[0]!.paragraphs.map((paragraph) => paragraph.id),
      );

      const denseCase = await buildCase('dense', 181);
      const bulkStarted = performance.now();
      const denseLayouts = await extractPageLayouts(denseCase.bytes);
      const bulkMs = performance.now() - bulkStarted;
      const scrollMs = await measureScroll(denseCase.bytes, denseLayouts.length);
      await resetPdfCache();
      const coldScrollMs = await measureScroll(denseCase.bytes, denseLayouts.length, true);
      await resetPdfCache();

      const report = [
        '## Layout benchmark (synthetic corpus)',
        '',
        formatScore(devScore, 'DEV seeds (tuning set)', dev.map((entry) => entry.ms)),
        formatScore(heldOutScore, 'HELD-OUT seeds (scored set)', heldOut.map((entry) => entry.ms)),
        '### per-case (held-out)',
        '',
        caseTable(heldOutScore),
        '### latency (24-page dense document)',
        '',
        `| access pattern | total | per page |`,
        `| --- | --- | --- |`,
        `| one bulk extraction | ${bulkMs.toFixed(0)} ms | ${(bulkMs / denseLayouts.length).toFixed(1)} ms |`,
        `| page-by-page (scroll, cached document) | ${scrollMs.toFixed(0)} ms | ${(scrollMs / denseLayouts.length).toFixed(1)} ms |`,
        `| page-by-page (re-parse every call = pre-Phase-3) | ${coldScrollMs.toFixed(0)} ms | ${(coldScrollMs / denseLayouts.length).toFixed(1)} ms |`,
      ].join('\n');
      console.log(report);

      // Persist the report so a before/after comparison is a file diff.
      const fs = nodeBuiltin<FsLike>('node:fs');
      fs.mkdirSync('../../tests/benchmarks', { recursive: true });
      fs.writeFileSync('../../tests/benchmarks/layout-benchmark-latest.md', report, 'utf8');
    },
  );
});
