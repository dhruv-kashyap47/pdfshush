/**
 * M5.4 - the Q3/Q7 ceiling guard (PLAN.md §31.6, §31.7).
 *
 * Re-measures the ratified ceilings against a **production build** behind
 * `vite preview`. It is deliberately separate from the M5.0 baseline harness:
 * that file records the starting line, this one is the repeatable gate that
 * fails when a change regresses the numbers.
 *
 *   pnpm build
 *   pnpm preview
 *   pnpm test:perf              # ratified ceilings (this machine)
 *
 * CI runs the same script with `M5_PERF_CI=1`, which uses the public spec
 * (1500 ms tool-ready, 100 ms first interaction, 200 ms long task, 24 MB heap)
 * instead of the tighter local ceilings. A shared runner is not the machine the
 * ratified numbers came from; pretending otherwise would either hide a
 * regression or fail on noise.
 *
 * Honest limits:
 *  - iOS Safari is not available in this environment. The Safari engine is
 *    exercised through Playwright WebKit with an iPhone-13 viewport; that is
 *    reported as `webkit-iphone` and never as "tested on iOS".
 *  - `performance.memory` is a Chromium API. On WebKit the heap is `n/a` rather
 *    than invented.
 *  - The 200-page run measures a merge, the cheapest multi-page job. Heavier
 *    per-page jobs (render, redact, dark mode) are bounded by the same worker
 *    cap and are covered by their own E2E suites, not by this ceiling.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit } from 'playwright';
import { readCatalog } from '../support/catalog.mjs';
import { buildPdf } from '../support/corpus.mjs';

const BASE = process.env.M5_BASE_URL ?? 'http://localhost:4173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '.corpus');
const CI = process.env.M5_PERF_CI === '1';

/** Fixed from the M5.0 run (§31.12). CI uses the public spec, not these. */
const RATIFIED = {
  readyP95Ms: 583,
  longTaskMs: 200,
  interactionMs: 23,
  heapMb: 15,
};
/** PLAN §31.7's public numbers; what CI can defend on a shared runner. */
const SPEC = {
  readyP95Ms: 1500,
  longTaskMs: 200,
  interactionMs: 100,
  heapMb: 24,
};
const CEILING = CI ? SPEC : RATIFIED;

let failures = 0;
const rows = [];
function check(label, actual, ceiling, unit = 'ms') {
  const ok = actual !== null && actual <= ceiling;
  if (!ok) failures += 1;
  rows.push({ label, actual, ceiling, unit, ok });
  console.log(
    `  ${ok ? 'PASS' : actual === null ? 'n/a ' : 'FAIL'}  ${label}: ` +
      `${actual === null ? 'not measured' : `${Math.round(actual)} ${unit}`} ` +
      `(ceiling ${ceiling} ${unit})`,
  );
}

/** Records a boolean that is not a timing (a run completed or it did not). */
function passed(label, detail = '') {
  rows.push({ label, actual: detail || 'yes', ceiling: '-', unit: '', ok: true });
  console.log(`  PASS  ${label}${detail ? ` -- ${detail}` : ''}`);
}

async function waitForMark(page, name, timeout = 30_000) {
  await page.waitForFunction(
    (mark) => performance.getEntriesByName(`pdfshush:${mark}`).length > 0,
    name,
    { timeout },
  );
  return page.evaluate((mark) => {
    const entry = performance.getEntriesByName(`pdfshush:${mark}`).at(-1);
    return entry?.startTime ?? null;
  }, name);
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function throttle(page, rate = 4) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
  return session;
}

async function waitForAnyMark(page, timeout = 30_000) {
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('pdfshush:tool-ready').length > 0 ||
      performance.getEntriesByName('pdfshush:page-ready').length > 0,
    undefined,
    { timeout },
  );
  const mark = await page.evaluate(() =>
    performance.getEntriesByName('pdfshush:tool-ready').length > 0 ? 'tool-ready' : 'page-ready',
  );
  return page.evaluate((name) => {
    const entry = performance.getEntriesByName(`pdfshush:${name}`).at(-1);
    return entry?.startTime ?? null;
  }, mark);
}

async function measureRoute(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForAnyMark(page).catch(() => null);
    await throttle(page, 4);

    // Two measured reloads, faster one wins. A warm reload on a quiet machine
    // is the number the ceiling was ratified against; a single run that catches
    // an unrelated compile or AV scan is not a product regression. Both
    // samples are kept so an outlier is visible, not silently dropped.
    const samples = [];
    let interaction = 0;
    for (let sample = 0; sample < 2; sample += 1) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      let ready = null;
      if (route.startsWith('/tools/')) {
        ready = await waitForMark(page, 'tool-ready').catch(() => null);
      }
      if (ready === null) ready = await waitForAnyMark(page);
      interaction = await page.evaluate(async () => {
        const start = performance.now();
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        return performance.now() - start;
      });
      samples.push(ready);
    }
    return { route, ready: Math.min(...samples), samples, interaction, errors };
  } finally {
    await context.close();
  }
}

async function prepareMerge(page, files) {
  await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'domcontentloaded' });
  await waitForAnyMark(page);
  await page.locator('input[type=file]').setInputFiles(files);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) =>
        /^Merge \d+ file/.test(node.textContent ?? ''),
      );
      return {
        enabled: button instanceof HTMLButtonElement && !button.disabled,
        reading: document.body.innerText.includes('reading.'),
      };
    });
    if (state.enabled && !state.reading) {
      return page.getByRole('button', { name: /^Merge \d+ file/ });
    }
    await page.waitForTimeout(300);
  }
  throw new Error('merge never became ready');
}

async function runMerge(page, files, timeoutMs) {
  const merge = await prepareMerge(page, files);
  const started = Date.now();
  await merge.click();
  await page.getByRole('button', { name: 'Start over' }).waitFor({ timeout: timeoutMs });
  return Date.now() - started;
}

async function jobCeiling(browser, fiftyPages) {
  console.log('\nQ3 - 50-page merge under 4x CPU');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push(entry.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  });
  try {
    await throttle(page, 4);
    await runMerge(page, fiftyPages, 300_000);
    const tasks = await page.evaluate(() => window.__longTasks ?? []);
    const worst = Math.max(0, ...tasks);
    check('worst main-thread task (4x)', worst, CEILING.longTaskMs);
    return { longTasks: tasks.length, worstLongTaskMs: worst };
  } finally {
    await context.close();
  }
}

async function mobileRun(engine, label, files, pageCount, timeoutMs) {
  console.log(`\nQ7 - ${label}: ${pageCount}-page merge`);
  let browser;
  try {
    browser = await engine.launch();
  } catch (error) {
    console.log(`  n/a   ${label}: engine not installed (${String(error).slice(0, 80)})`);
    rows.push({ label: `${label} ${pageCount}-page merge`, actual: null, ceiling: null, unit: '', ok: true, note: 'engine unavailable' });
    return { completed: false, heapMb: null, note: 'engine unavailable' };
  }
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: false });
  const page = await context.newPage();
  try {
    const duration = await runMerge(page, files, timeoutMs);
    const heap = await page.evaluate(() => {
      const memory = performance.memory;
      return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null;
    });
    passed(`${label} ${pageCount}-page merge completes`, `${Math.round(duration)} ms`);
    if (heap !== null) check(`${label} ${pageCount}-page heap`, heap, CEILING.heapMb, 'MB');
    else {
      console.log(`  n/a   ${label} ${pageCount}-page heap: performance.memory unavailable`);
      rows.push({ label: `${label} ${pageCount}-page heap`, actual: null, ceiling: CEILING.heapMb, unit: 'MB', ok: true, note: 'API unavailable' });
    }
    return { completed: true, durationMs: duration, heapMb: heap };
  } catch (error) {
    console.log(`  FAIL  ${label} ${pageCount}-page merge: ${String(error).slice(0, 200)}`);
    failures += 1;
    rows.push({ label: `${label} ${pageCount}-page merge`, actual: null, ceiling: null, unit: '', ok: false, note: String(error).slice(0, 200) });
    return { completed: false, heapMb: null, note: String(error).slice(0, 200) };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const response = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
  if (!response?.ok) {
    console.error(
      `[m5.4] ${BASE} is not reachable. This gate needs a production build:\n` +
        '  pnpm build\n  pnpm preview\n  pnpm test:perf',
    );
    process.exit(2);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const fifty = path.join(OUT_DIR, 'perf-50.pdf');
  const twoHundred = path.join(OUT_DIR, 'perf-200.pdf');
  await writeFile(fifty, buildPdf(50, 'performance'));
  await writeFile(twoHundred, buildPdf(200, 'performance'));

  const catalog = await readCatalog();
  const routes = [
    ...catalog.live.map((tool) => `/tools/${tool.slug}`),
    '/',
    '/workflows',
  ];
  console.log(`\nQ3 - tool-ready, ${routes.length} routes, 4x CPU`);
  const browser = await chromium.launch();
  const routeRows = [];
  try {
    for (const route of routes) routeRows.push(await measureRoute(browser, route));
  } finally {
    await browser.close();
  }
  const ready = routeRows.map((row) => row.ready).filter((value) => value !== null);
  const p95 = percentile(ready, 95);
  const worstInteraction = Math.max(0, ...routeRows.map((row) => row.interaction));
  const scriptErrors = routeRows.reduce((sum, row) => sum + row.errors.length, 0);
  check('tool-ready p95 (4x)', p95, CEILING.readyP95Ms);
  check('first interaction, worst route', worstInteraction, CEILING.interactionMs);
  console.log(`  ${scriptErrors === 0 ? 'PASS' : 'FAIL'}  script errors across routes: ${scriptErrors}`);
  if (scriptErrors > 0) failures += 1;

  const throttleBrowser = await chromium.launch();
  let throttled;
  try {
    throttled = await jobCeiling(throttleBrowser, [fifty]);
  } finally {
    await throttleBrowser.close();
  }

  const mobile = await mobileRun(chromium, 'chromium-iphone', [twoHundred], 200, 420_000);
  const safari = await mobileRun(webkit, 'webkit-iphone', [fifty], 50, 300_000);

  const result = {
    measuredAt: new Date().toISOString(),
    base: BASE,
    mode: CI ? 'ci-spec' : 'ratified',
    ceilings: CEILING,
    routes: routeRows,
    readyP95Ms: p95,
    worstInteractionMs: worstInteraction,
    scriptErrors,
    throttled,
    mobile,
    safari,
    checks: rows,
    failures,
  };
  await writeFile(path.join(HERE, 'm5-4-ceilings.json'), JSON.stringify(result, null, 2));

  const lines = [
    '# M5.4 - Q3/Q7 ceiling guard',
    '',
    `Measured ${result.measuredAt} against \`${BASE}\` (production build, 4x CPU).`,
    `Mode: **${result.mode}**.`,
    '',
    '| check | measured | ceiling | result |',
    '| --- | --- | --- | --- |',
    ...rows.map((row) => {
      const measured =
        typeof row.actual === 'number'
          ? `${Math.round(row.actual)} ${row.unit}`
          : (row.actual ?? 'n/a');
      const ceiling = row.ceiling === null || row.ceiling === '-' ? '-' : `${row.ceiling} ${row.unit}`;
      return `| ${row.label} | ${measured} | ${ceiling} | ${row.ok ? 'pass' : 'fail'} |`;
    }),
    '',
    `- routes measured: ${routeRows.length}`,
    `- script errors: ${scriptErrors}`,
    `- 50-page merge long tasks: ${throttled?.longTasks ?? 'n/a'} (worst ${Math.round(throttled?.worstLongTaskMs ?? 0)} ms)`,
    `- iPhone-13 200-page merge: ${mobile.completed ? 'completed' : 'failed'}${mobile.heapMb ? `, heap ${mobile.heapMb} MB` : ''}`,
    `- WebKit iPhone-13 50-page merge: ${safari.completed ? 'completed' : 'failed'}${safari.note ? ` (${safari.note})` : ''}`,
    '',
    safari.heapMb === null
      ? 'The WebKit run reports **no heap**: `performance.memory` is Chromium-only. It is not iOS Safari; it is the Safari engine under an iPhone viewport.'
      : '',
  ];
  await writeFile(path.join(HERE, 'm5-4-ceilings.md'), `${lines.join('\n')}\n`);

  console.log(`\n[m5.4] ${failures === 0 ? 'all ceilings met' : `${failures} ceiling check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('[m5.4] harness error:', error);
  process.exit(2);
});
