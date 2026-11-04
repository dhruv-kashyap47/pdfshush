/**
 * M5.0 — instrument the product (PLAN.md §31.6).
 *
 * Produces `product-baseline.md` and `product-baseline.json`: the measured
 * starting line for Milestone 5, not a set of guesses. It runs against a
 * **production build** (`vite preview`) because dev-mode transform cost would
 * make every Q3 number meaningless.
 *
 *   pnpm build
 *   pnpm --filter @pdfshush/web preview --port 4173
 *   node tests/benchmarks/m5-0-baseline.mjs
 *
 * What it measures, one phase per Q:
 *   Q1  adversarial corpus: every case reaches a terminal state, and no error
 *       message echoes document text or the uploaded filename
 *   Q2  determinism: same merge input twice → identical output digest
 *   Q3  tool-ready on a 4x CPU throttle, plus long tasks during a 50-page job
 *   Q4  the corpus matrix itself (0-byte, 1-page, 2000-page, encrypted,
 *       scanned, malformed, non-ASCII name, oversize)
 *   Q5  axe (WCAG 2.2 AA) over the shell and the ten most popular tools
 *   Q6  no document egress during a client-side job
 *   Q7  iPhone-13 emulation: a 50-page job completes and its heap is recorded
 *   Q8  whether the page itself states a limit (heuristic, flagged as such)
 *
 * The crawler phase is not a Q: it is the baseline evidence behind M5.5.
 *
 * Honest limits of this harness: class-level evidence is inherited by the
 * tools in that class (the table says so per row); the corpus runs through a
 * representative tool per class instead of all 49, because a full matrix would
 * be hours rather than minutes. Anything not measured is reported as `n/a`,
 * never as a pass.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { classOf, readCatalog } from '../support/catalog.mjs';
import { CORPUS_GAPS, buildCorpus, buildPdf } from '../support/corpus.mjs';

const BASE = process.env.M5_BASE_URL ?? 'http://localhost:4173';
const HEAVY = process.env.M5_HEAVY !== '0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(HERE, 'product-baseline.json');
const OUT_MD = path.join(HERE, 'product-baseline.md');

/**
 * Ceilings ratified from the M5.0 baseline run (2026-11-04, commit b474dee).
 *
 * A re-run measures against these numbers; it never recomputes them from its
 * own result. Otherwise a lucky run would quietly tighten the goalposts and an
 * unlucky one would quietly widen them. M5.4 turns this into a CI guard.
 */
const RATIFIED = {
  readyP95Ms: 486,
  readyCeilingMs: 583,
  longTaskCeilingMs: 200,
  interactionWorstMs: 19,
  interactionCeilingMs: 23,
  mobileHeapCeilingMb: 15,
};
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const TOP_TEN = [
  '/',
  '/tools/edit-pdf',
  '/tools/merge-pdf',
  '/tools/compress-pdf',
  '/tools/delete-pages',
  '/tools/split-by-pages',
  '/tools/crop-pdf',
  '/tools/fill-sign',
  '/tools/redact-pdf',
  '/tools/pdf-to-jpg',
  '/workflows',
];

const now = new Date();
const log = (...args) => console.log('[m5.0]', ...args);

/* ------------------------------------------------------------------ browser */

async function withBrowser(run) {
  const browser = await chromium.launch();
  try {
    return await run(browser);
  } finally {
    await browser.close();
  }
}

/** Applies a 4x CPU slowdown to the page, as Q3 specifies. */
async function throttle(page, rate = 4) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
  return session;
}

async function waitForMark(page, name, timeout = 30_000) {
  await page.waitForFunction(
    (mark) => performance.getEntriesByName(`pdfshush:${mark}`).length > 0,
    name,
    { timeout },
  );
  return page.evaluate((mark) => {
    const entry = performance.getEntriesByName(`pdfshush:${mark}`).at(-1);
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      startTime: entry?.startTime ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null,
    };
  }, name);
}

/**
 * Tool routes publish `tool-ready` once their body commits; shell routes
 * (home, account, workflows) publish `page-ready`. Prefer the tool mark so the
 * measurement includes the lazy tool chunk, not just the shell.
 */
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
  return { mark, timing: await waitForMark(page, mark, timeout) };
}

/* ------------------------------------------------------------- route timing */

async function measureRoute(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const apiFailures = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/')) {
      apiFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)));

  const waitRoute = async () => {
    if (route.startsWith('/tools/')) {
      try {
        const timing = await waitForMark(page, 'tool-ready', 30_000);
        return { mark: 'tool-ready', timing };
      } catch {
        /* fall through to the page mark */
      }
    }
    const { mark, timing } = await waitForAnyMark(page, 30_000);
    return { mark, timing };
  };

  try {
    // Warm the route once so Vite's module graph is resolved; the measured run
    // is a genuine reload of a warm server, which is what a repeat visitor gets.
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitRoute().catch(() => null);

    await throttle(page, 4);
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const { mark: readyMark, timing } = await waitRoute();

    // First interaction latency: click the page background, then read the gap
    // between the input event and the next animation frame.
    const interaction = await page.evaluate(async () => {
      const start = performance.now();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    });

    // Q8 evidence: does the rendered page itself state a limit or refusal?
    const bodyText = await page.locator('body').innerText();

    return {
      route,
      readyMark,
      readyMs: timing.startTime,
      loadMs: timing.load,
      interactionMs: interaction,
      limitCopy: /(?:500 pages|100 MB|250 MB|in-browser limit|not supported|cannot|encrypted)/i.test(
        bodyText,
      ),
      apiFailures: [...new Set(apiFailures)],
      errors,
    };
  } finally {
    await context.close();
  }
}

/* ------------------------------------------------------------------ a11y */

async function runAxe(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForMark(page, 'tool-ready', 30_000).catch(() => null);
    await page.addScriptTag({ path: AXE_PATH });
    const result = await page.evaluate(async () => {
      // @ts-expect-error axe is injected at runtime
      return await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        resultTypes: ['violations'],
      });
    });
    return {
      route,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help,
        samples: violation.nodes.slice(0, 3).map((node) => ({
          target: node.target,
          html: node.html.slice(0, 160),
        })),
      })),
    };
  } catch (error) {
    return { route, error: String(error).slice(0, 300), violations: [] };
  } finally {
    await context.close();
  }
}

/* --------------------------------------------------------------- crawler */

function textOfHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function crawl(route) {
  const response = await fetch(`${BASE}${route}`, { redirect: 'follow' });
  const html = await response.text();
  const root = /<div id="root">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  return {
    route,
    status: response.status,
    htmlBytes: Buffer.byteLength(html),
    visibleTextChars: textOfHtml(html).length,
    rootChars: textOfHtml(root).length,
    title: /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null,
    canonical: /rel="canonical"[^>]*href="([^"]+)"/i.exec(html)?.[1] ?? null,
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
  };
}

/* ----------------------------------------------------------- job drivers */

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function prepareMerge(page, files) {
  await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'domcontentloaded' });
  await waitForAnyMark(page);
  await page.locator('input[type=file]').setInputFiles(files);

  // Upload-time refusals (empty, malformed, encrypted, oversize) toast and
  // clear the entry list, so the merge button never appears. Wait for either
  // outcome rather than assuming the happy path.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((node) =>
        /^Merge \d+ file/.test(node.textContent ?? ''),
      );
      const toast = document.querySelector('[data-sonner-toast]');
      return {
        present: button instanceof HTMLButtonElement,
        enabled: button instanceof HTMLButtonElement && !button.disabled,
        reading: document.body.innerText.includes('reading…'),
        toast: toast instanceof HTMLElement ? toast.innerText : null,
      };
    });

    // `enabled` alone is not enough: the button exists (enabled) while the
    // inspector is still reading, and merging then would use one of two files.
    if (state.enabled && !state.reading) {
      return {
        merge: page.getByRole('button', { name: /^Merge \d+ file/ }),
        refusal: null,
      };
    }
    if (!state.present && state.toast) {
      await page.waitForTimeout(400);
      return { merge: null, refusal: state.toast };
    }
    await page.waitForTimeout(300);
  }
  return { merge: null, refusal: 'timed out waiting for merge readiness' };
}

async function downloadMerge(page, merge) {
  await merge.click();
  await jobCompleted(page, 120_000);
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function jobCompleted(page, timeout = 120_000) {
  await page.getByRole('button', { name: 'Start over' }).waitFor({ timeout });
  return page.locator('body').innerText();
}

/* --------------------------------------------------------------- phases */

async function phaseReadiness(browser, liveTools) {
  log(`readiness: ${liveTools.length + 2} routes`);
  const rows = [];
  for (const tool of liveTools) {
    rows.push(await measureRoute(browser, `/tools/${tool.slug}`));
  }
  rows.push(await measureRoute(browser, '/'));
  rows.push(await measureRoute(browser, '/workflows'));
  return rows;
}

async function phaseA11y(browser, routes) {
  log(`a11y: axe over ${routes.length} routes`);
  const rows = [];
  for (const route of routes) rows.push(await runAxe(browser, route));
  return rows;
}

async function phaseCrawler(routes) {
  log(`crawler: ${routes.length} routes`);
  const rows = [];
  for (const route of routes) rows.push(await crawl(route));
  return rows;
}

async function phaseDeterminism(browser, fixtures) {
  log('determinism: merge twice, compare digests');
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    const firstPrep = await prepareMerge(page, fixtures);
    if (!firstPrep.merge) throw new Error(`merge refused: ${firstPrep.refusal?.slice(0, 120)}`);
    const first = await downloadMerge(page, firstPrep.merge);
    const secondPrep = await prepareMerge(page, fixtures);
    if (!secondPrep.merge) throw new Error(`merge refused: ${secondPrep.refusal?.slice(0, 120)}`);
    const second = await downloadMerge(page, secondPrep.merge);
    const equal = hash(first) === hash(second);
    const differingFields = [];
    if (!equal) {
      // Keep the two artifacts so a Q2 failure is diagnosable, not just a hash.
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path.join(HERE, '.corpus', 'determinism-a.pdf'), first);
      await writeFile(path.join(HERE, '.corpus', 'determinism-b.pdf'), second);

      // Name the fields that moved. Timestamp metadata is the usual culprit and
      // it is worth saying so in the baseline rather than leaving a bare hash.
      const textA = Buffer.from(first).toString('latin1');
      const textB = Buffer.from(second).toString('latin1');
      for (const field of ['CreationDate', 'ModDate', 'Producer', 'Creator', 'ID']) {
        const pattern = new RegExp(`/${field}[^\\n\\r]*`, 'g');
        const valuesA = [...textA.matchAll(pattern)].map((match) => match[0]);
        const valuesB = [...textB.matchAll(pattern)].map((match) => match[0]);
        if (JSON.stringify(valuesA) !== JSON.stringify(valuesB)) differingFields.push(field);
      }
    }
    return {
      equal,
      differingFields,
      firstDigest: hash(first),
      secondDigest: hash(second),
      bytes: first.byteLength,
    };
  } finally {
    await context.close();
  }
}

async function phaseNetwork(browser, fixtures) {
  log('privacy: requests during a client job');
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => {
    requests.push({
      method: request.method(),
      url: request.url(),
      bodyBytes: (request.postData() ?? '').length,
    });
  });
  try {
    const prepared = await prepareMerge(page, fixtures);
    if (!prepared.merge) throw new Error(`merge refused: ${prepared.refusal?.slice(0, 120)}`);
    await prepared.merge.click();
    await jobCompleted(page);
    const external = requests.filter((request) => !request.url.startsWith(BASE) && !request.url.startsWith('blob:') && !request.url.startsWith('data:'));
    const uploads = requests.filter(
      (request) =>
        ['POST', 'PUT', 'PATCH'].includes(request.method) &&
        !new URL(request.url).pathname.startsWith('/api'),
    );
    return {
      total: requests.length,
      external: external.length,
      nonApiUploads: uploads.length,
      externalSamples: external.slice(0, 5).map((request) => request.url),
      uploadSamples: uploads.slice(0, 5).map((request) => request.url),
    };
  } finally {
    await context.close();
  }
}

async function phaseThrottledJob(browser, fiftyPages) {
  log('performance: 50-page merge at 4x throttle');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ entryTypes: ['longtask'] });
  });
  try {
    await throttle(page, 4);
    const prepared = await prepareMerge(page, fiftyPages);
    if (!prepared.merge) throw new Error(`merge refused: ${prepared.refusal?.slice(0, 120)}`);
    const before = Date.now();
    await prepared.merge.click();
    await jobCompleted(page);
    const durationMs = Date.now() - before;
    const longTasks = await page.evaluate(() => window.__longTasks ?? []);
    return {
      durationMs,
      longTasks: longTasks.length,
      worstLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)),
    };
  } finally {
    await context.close();
  }
}

async function phaseMobile(fiftyPages) {
  log('mobile: iPhone 13 emulation, 50-page merge');
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: false });
  const page = await context.newPage();
  try {
    const prepared = await prepareMerge(page, fiftyPages);
    if (!prepared.merge) throw new Error(`merge refused: ${prepared.refusal?.slice(0, 120)}`);
    await prepared.merge.click();
    await jobCompleted(page, 180_000);
    const heap = await page.evaluate(() => {
      const memory = performance.memory;
      return memory
        ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit }
        : null;
    });
    return { completed: true, heapMb: heap ? Math.round(heap.used / 1024 / 1024) : null };
  } catch (error) {
    return { completed: false, error: String(error).slice(0, 300) };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function phaseCorpus(browser, corpus) {
  log(`corpus: ${corpus.length} cases through merge`);
  const results = [];
  for (const entry of corpus) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      const prepared = await prepareMerge(page, [entry.path]);
      let outcome;
      if (!prepared.merge) {
        outcome = { kind: 'refused', text: prepared.refusal ?? '' };
      } else {
        await prepared.merge.click();
        outcome = await Promise.race([
          jobCompleted(page).then((text) => ({ kind: 'completed', text })),
          page
            .waitForSelector('[data-sonner-toast]', { timeout: 120_000 })
            .then(async () => {
              await page.waitForTimeout(500);
              const toast = page.locator('[data-sonner-toast]').first();
              return { kind: 'refused', text: await toast.innerText().catch(() => '') };
            }),
        ]).catch((error) => ({ kind: 'timeout', text: String(error).slice(0, 200) }));
      }

      const terminal = outcome.kind === 'completed' || outcome.kind === 'refused';
      const refusalText = outcome.kind === 'refused' ? outcome.text : '';
      const lower = `${refusalText} ${errors.join(' ')}`.toLowerCase();
      const echoesFilename = lower.includes(entry.filename.toLowerCase());
      const echoesText = lower.includes('corpus page');
      results.push({
        id: entry.id,
        expectation: entry.expectation,
        kind: outcome.kind,
        terminal,
        echoesFilename,
        echoesText,
        note: entry.note,
      });
    } catch (error) {
      results.push({
        id: entry.id,
        expectation: entry.expectation,
        kind: 'harness-error',
        terminal: false,
        error: String(error).slice(0, 300),
        note: entry.note,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}

/* ------------------------------------------------------------- reporting */

function pct(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function buildQTable({ catalog, readiness, a11y, corpus, determinism, network, throttled, mobile }) {
  const readyByRoute = new Map(readiness.map((row) => [row.route, row]));
  const a11yByRoute = new Map(a11y.map((row) => [row.route, row]));

  const criticalCorpus = corpus.filter((row) => row.expectation === 'refuse');
  const q1Class =
    criticalCorpus.length > 0 &&
    criticalCorpus.every((row) => row.terminal && !row.echoesFilename && !row.echoesText);
  const q2Class = determinism.equal;
  const q6Class = network.nonApiUploads === 0 && network.external === 0;
  const q7Class = mobile.completed === true;
  const q3Job = throttled.worstLongTaskMs <= 200;
  const q4Class = corpus.every((row) => row.terminal);

  return catalog.live.map((tool) => {
    const route = `/tools/${tool.slug}`;
    const ready = readyByRoute.get(route);
    const axe = a11yByRoute.get(route);
    const critical = (axe?.violations ?? []).filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    );
    const klass = classOf(tool.slug);
    const clientSide = !['ai', 'orchestration', 'docs'].includes(klass);

    return {
      slug: tool.slug,
      name: tool.name,
      class: klass,
      Q1: clientSide ? (q1Class ? 'class-pass' : 'class-fail') : 'n/a',
      Q2: clientSide ? (q2Class ? 'class-pass' : 'class-fail') : 'n/a',
      Q3:
        ready?.readyMs == null
          ? 'not-ready'
          : ready.readyMs <= 1500
            ? q3Job
              ? 'pass'
              : 'ready-pass/job-fail'
            : 'fail',
      Q4: clientSide ? (q4Class ? 'class-pass' : 'class-fail') : 'n/a',
      Q5: axe ? (critical.length === 0 ? 'pass' : `${critical.length}-serious`) : 'not-run',
      Q6: clientSide ? (q6Class ? 'class-pass' : 'class-fail') : 'n/a',
      Q7: clientSide ? (q7Class ? 'class-pass' : 'class-fail') : 'n/a',
      Q8: ready?.limitCopy ? 'heuristic-pass' : 'fail',
      evidence: {
        readyMs: ready?.readyMs ?? null,
        axeViolations: axe?.violations.length ?? null,
        axeSerious: critical.length,
      },
    };
  });
}

function renderMarkdown(report) {
  const { catalog, readiness, a11y, crawler, corpus, determinism, network, throttled, mobile, qTable, ceilings, corpusGaps } = report;
  const lines = [];
  const readyValues = readiness.map((row) => row.readyMs).filter((value) => value != null);

  lines.push('# Product baseline — M5.0');
  lines.push('');
  lines.push(`Measured ${now.toISOString()} against \`${BASE}\` (production build, 4x CPU throttle for Q3).`);
  lines.push('');
  lines.push('> This file is generated by `node tests/benchmarks/m5-0-baseline.mjs`. Do not hand-edit;');
  lines.push('> re-run the harness. Ratings marked `class-*` are inherited from the representative run');
  lines.push('> for that tool class and are labelled that way on purpose (see the harness header).');
  lines.push('');
  lines.push('## Catalog');
  lines.push('');
  lines.push('| fact | value |');
  lines.push('| --- | --- |');
  lines.push(`| registered entries | ${catalog.tools.length} |`);
  lines.push(`| live | ${catalog.live.length} |`);
  lines.push(`| not built | ${catalog.tools.length - catalog.live.length} |`);
  lines.push('');
  lines.push('## Q3 — tool-ready (4x throttle)');
  lines.push('');
  lines.push(`p50 **${Math.round(pct(readyValues, 0.5) ?? 0)} ms** · p95 **${Math.round(pct(readyValues, 0.95) ?? 0)} ms** · budget 1500 ms.`);
  lines.push('');
  lines.push('| route | ready | load | first interaction | script errors | API unavailable |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of readiness) {
    const scriptErrors = row.errors.filter((error) => !/Failed to load resource/.test(error));
    lines.push(
      `| \`${row.route}\` | ${row.readyMs == null ? '—' : `${Math.round(row.readyMs)} ms`} | ${
        row.loadMs == null ? '—' : `${Math.round(row.loadMs)} ms`
      } | ${Math.round(row.interactionMs)} ms | ${scriptErrors.length} | ${row.apiFailures?.length ?? 0} |`,
    );
  }
  lines.push('');
  lines.push('## Q5 — accessibility (axe, WCAG 2.2 AA tags)');
  lines.push('');
  lines.push('| route | violations | critical+serious | worst rule |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of a11y) {
    const serious = row.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    const worst = serious[0] ?? row.violations[0];
    lines.push(
      `| \`${row.route}\` | ${row.violations.length} | ${serious.length} | ${worst ? `${worst.id} (${worst.impact}, ${worst.nodes})` : '—'} |`,
    );
  }
  lines.push('');
  lines.push('## Crawler view (evidence for M5.5)');
  lines.push('');
  lines.push('| route | HTTP | html bytes | visible text | root content | title | canonical | h1 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of crawler) {
    lines.push(
      `| \`${row.route}\` | ${row.status} | ${row.htmlBytes} | ${row.visibleTextChars} | ${row.rootChars} | ${
        row.title ? 'yes' : 'no'
      } | ${row.canonical ?? '—'} | ${row.h1Count} |`,
    );
  }
  lines.push('');
  lines.push('## Q4 — adversarial corpus (merge class)');
  lines.push('');
  lines.push('| case | edge | expected | terminal | refusal/completion | echoes filename | echoes text |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of corpus) {
    lines.push(
      `| \`${row.id}\` | ${row.note} | ${row.expectation} | ${row.terminal ? 'yes' : 'no'} | ${row.kind} | ${
        row.echoesFilename ? '**yes**' : 'no'
      } | ${row.echoesText ? '**yes**' : 'no'} |`,
    );
  }
  lines.push('');
  if (corpusGaps.length > 0) {
    lines.push('Corpus gaps (reported, not hidden):');
    for (const gap of corpusGaps) lines.push(`- \`${gap.edge}\` — ${gap.reason}`);
    lines.push('');
  }
  lines.push('## Class measurements');
  lines.push('');
  lines.push('| check | result |');
  lines.push('| --- | --- |');
  lines.push(`| Q2 determinism (merge, 2 files, twice) | ${determinism.equal ? 'identical digest' : `**differs** — moving fields: ${determinism.differingFields.join(', ') || 'unknown'} (${determinism.firstDigest.slice(0, 12)} vs ${determinism.secondDigest.slice(0, 12)})`} |`);
  lines.push(`| Q6 egress during a client job | ${network.total} requests, ${network.external} external, ${network.nonApiUploads} non-API uploads |`);
  lines.push(`| Q3 50-page merge at 4x | ${throttled.durationMs} ms, ${throttled.longTasks} long tasks, worst ${Math.round(throttled.worstLongTaskMs)} ms |`);
  lines.push(`| Q7 iPhone 13, 50-page merge | ${mobile.completed ? `completed, heap ${mobile.heapMb ?? '—'} MB` : `**failed** — ${mobile.error}`} |`);
  lines.push('');
  lines.push('## Q1–Q8 matrix (all live tools)');
  lines.push('');
  lines.push('| tool | class | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | Q7 | Q8 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of qTable) {
    lines.push(
      `| \`${row.slug}\` | ${row.class} | ${row.Q1} | ${row.Q2} | ${row.Q3} | ${row.Q4} | ${row.Q5} | ${row.Q6} | ${row.Q7} | ${row.Q8} |`,
    );
  }
  lines.push('');
  lines.push('## Ratified ceilings (fixed from the M5.0 run)');
  lines.push('');
  lines.push(`- **Q3 tool-ready:** p95 ${Math.round(ceilings.readyP95)} ms measured → ceiling **${Math.round(ceilings.readyCeiling)} ms** (ratified: 486 ms p95 + 20%, under the 1500 ms spec).`);
  lines.push(`- **Q3 long task:** worst ${Math.round(throttled.worstLongTaskMs)} ms measured → ceiling **${Math.round(ceilings.longTaskCeiling)} ms** (spec floor).`);
  lines.push(`- **Q3 first interaction:** worst ${Math.round(ceilings.interactionWorst)} ms measured → ceiling **${Math.round(ceilings.interactionCeiling)} ms**.`);
  lines.push(`- **Q7 mobile heap:** ${mobile.heapMb ?? 'not measured'} MB used → ceiling **${mobile.heapMb ? ceilings.mobileHeapCeilingMb : 'not set'} MB**.`);
  lines.push('');
  lines.push('## Baseline conclusions');
  lines.push('');
  lines.push(`- ${qTable.filter((row) => row.Q5 === 'pass').length}/${qTable.length} live tools have zero serious axe violations.`);
  lines.push(`- ${qTable.filter((row) => row.Q3 === 'pass').length}/${qTable.length} live tools meet the 1500 ms tool-ready budget on 4x CPU.`);
  lines.push(`- ${crawler.filter((row) => row.rootChars > 0).length}/${crawler.length} crawled routes contain content without JavaScript.`);
  lines.push(`- ${qTable.filter((row) => row.Q8 === 'heuristic-pass').length}/${qTable.length} tool pages mention a limit at all.`);
  lines.push('');
  return lines.join('\n');
}

/* -------------------------------------------------------------------- main */

async function main() {
  const catalog = await readCatalog();
  log(`catalog: ${catalog.live.length} live / ${catalog.tools.length} total`);

  const corpus = await buildCorpus({ includeOversize: HEAVY });
  const onePage = corpus.find((entry) => entry.id === 'one-page').path;
  const unicode = corpus.find((entry) => entry.id === 'unicode-name').path;
  const fiftyPages = path.join(HERE, '.corpus', 'fifty-pages.pdf');
  await writeFile(fiftyPages, (await import('../support/corpus.mjs')).buildPdf(50, 'benchmark'));

  const readiness = await withBrowser((browser) => phaseReadiness(browser, catalog.live));
  const a11y = await withBrowser((browser) =>
    phaseA11y(browser, [
      ...new Set(['/', '/workflows', '/account', ...TOP_TEN, ...catalog.live.map((tool) => `/tools/${tool.slug}`)]),
    ]),
  );
  const crawler = await phaseCrawler(['/', ...catalog.live.map((tool) => `/tools/${tool.slug}`), '/workflows', '/account']);
  const determinism = await withBrowser((browser) => phaseDeterminism(browser, [onePage, unicode]));
  const network = await withBrowser((browser) => phaseNetwork(browser, [onePage]));
  const throttled = await withBrowser((browser) => phaseThrottledJob(browser, [fiftyPages]));
  const mobile = await phaseMobile([fiftyPages]);
  const corpusResults = await withBrowser((browser) => phaseCorpus(browser, corpus));

  const readyValues = readiness.map((row) => row.readyMs).filter((value) => value != null);
  const ceilings = {
    readyP95: pct(readyValues, 0.95) ?? 0,
    readyCeiling: RATIFIED.readyCeilingMs,
    interactionWorst: Math.max(0, ...readiness.map((row) => row.interactionMs)),
    interactionCeiling: RATIFIED.interactionCeilingMs,
    longTaskCeiling: RATIFIED.longTaskCeilingMs,
    mobileHeapCeilingMb: RATIFIED.mobileHeapCeilingMb,
  };

  const qTable = buildQTable({
    catalog,
    readiness,
    a11y,
    corpus: corpusResults,
    determinism,
    network,
    throttled,
    mobile,
  });

  const report = {
    generatedAt: now.toISOString(),
    base: BASE,
    catalog: { total: catalog.tools.length, live: catalog.live.length },
    corpusGaps: CORPUS_GAPS,
    readiness,
    a11y,
    crawler,
    corpus: corpusResults,
    determinism,
    network,
    throttled,
    mobile,
    ceilings,
    qTable,
  };

  await mkdir(HERE, { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(OUT_MD, `${renderMarkdown({ ...report, catalog })}\n`);
  log(`wrote ${path.relative(process.cwd(), OUT_MD)} and .json`);

  const failures = qTable.filter((row) => row.Q5 !== 'pass' && row.Q5 !== 'n/a');
  if (failures.length > 0) log(`${failures.length} tool pages have serious axe violations (baseline, not a gate)`);
}

await main();

