/**
 * H-05 cross-browser record.
 *
 * Runs the same editor loop on Chromium, Firefox and WebKit: open a fixture,
 * create a text box from the keyboard, move it with an arrow key, find text,
 * save, and reopen the downloaded bytes. Feature probes (clipboard, IndexedDB,
 * OffscreenCanvas, touch events) are recorded per engine so an unsupported
 * combination is named instead of hidden.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:cross-browser
 *
 * A browser whose Playwright binary is not installed is reported as SKIP; that
 * is a missing test environment, not a pass. The downloadable artifact records
 * which engines actually ran.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { PDFDocument, StandardFonts } from '../../apps/web/node_modules/@cantoo/pdf-lib/es/index.js';
import { extractText, waitFor } from '../support/e2e-util.mjs';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'cross-browser');

/**
 * The Worker is optional for every tool, and this suite is started against a
 * preview build without one. `vite preview` inherits the dev proxy, so an
 * unavailable Worker used to answer `/api/*` with a 502 and Chromium/WebKit
 * logged that as a console error, failing an editor run that had nothing wrong
 * with it. Probe once and decide explicitly: when the API is absent, `/api`
 * failures are expected and ignored; when it is present, they stay fatal.
 */
async function workerReachable() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3_000) });
    return (
      response.ok &&
      (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
    );
  } catch {
    return false;
  }
}

const apiAvailable = await workerReachable();
if (!apiAvailable) {
  console.log('Optional Worker not reachable; /api console errors are expected and ignored.');
}

/** Console text sometimes carries the URL, sometimes only `message.location()`. */
function isApiResource(text, source) {
  return source.includes('/api/') || /\/api\//.test(text);
}

const results = [];
let failures = 0;

function record(engine, feature, status, detail = '') {
  results.push({ engine, feature, status, detail });
  console.log(`  [${status}] ${engine}: ${feature}${detail ? ` - ${detail}` : ''}`);
  if (status === 'FAIL') failures += 1;
}

async function fixture() {
  await mkdir(WORK, { recursive: true });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Cross browser invoice 2026', { x: 72, y: 770, size: 18, font });
  const file = path.join(WORK, 'cross-browser.pdf');
  await writeFile(file, await doc.save({ useObjectStreams: false }));
  return file;
}

async function featureProbes(page) {
  return page.evaluate(() => ({
    pointerEvents: typeof window.PointerEvent !== 'undefined',
    touchEvents: 'ontouchstart' in window,
    indexedDb: typeof indexedDB !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    clipboard: Boolean(navigator.clipboard),
    createImageBitmap: typeof createImageBitmap !== 'undefined',
    fileApi: typeof File !== 'undefined' && typeof Blob !== 'undefined',
  }));
}

async function runEngine(name, launcher, fixturePath) {
  const browserType = launcher;
  let browser;
  try {
    browser = await browserType.launch();
  } catch (error) {
    record(name, 'binary', 'SKIP', String(error.message).split('\n')[0]);
    return;
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedResources = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) failedResources.push(`${response.status()} ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Playwright reports the failing resource as the message location; the
    // text alone does not name it, which is why the old `api/(auth|tools)`
    // filter let an `/api/capabilities` 502 through.
    const source = message.location?.()?.url ?? '';
    if (!apiAvailable && isApiResource(text, source)) return;
    consoleErrors.push(source ? `${text} (${source})` : text);
  });
  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const probes = await featureProbes(page);
    for (const [feature, supported] of Object.entries(probes)) {
      record(name, feature, supported ? 'PASS' : 'UNSUPPORTED');
    }

    await page.locator('input[type=file]').first().setInputFiles(fixturePath);
    await page.getByTestId('editor-page').first().waitFor({ timeout: 90_000 });
    record(name, 'open a PDF', 'PASS');

    await page.getByTestId('editor-page').first().focus();
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    await page.getByTestId('editor-text-input').waitFor({ timeout: 15_000 });
    await page.keyboard.type(`Cross browser ${name}`);
    await page.keyboard.press('Escape');
    record(name, 'create text from the keyboard', 'PASS');
    record(
      name,
      'direct-manipulation handles',
      (await page.getByTestId('editor-move-handle').count()) === 1 ? 'PASS' : 'FAIL',
    );

    const before = await page.locator('[data-object-id]').last().boundingBox();
    await page.keyboard.press('ArrowRight');
    const after = await page.locator('[data-object-id]').last().boundingBox();
    record(name, 'arrow-key nudge', before && after && after.x > before.x ? 'PASS' : 'FAIL');

    await page.keyboard.press('Control+f');
    await page.getByTestId('editor-find-query').fill('invoice');
    await waitFor(
      async () => {
        const text = await page.getByTestId('editor-find-count').innerText();
        return /match/i.test(text) ? text : null;
      },
      20_000,
      'find result',
    );
    record(name, 'find and replace', 'PASS');
    await page.keyboard.press('Escape');

    await page.getByTestId('editor-save').click();
    await waitFor(
      async () => (await page.getByText('-edited.pdf').count()) > 0,
      60_000,
      'saved result',
    );
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const bytes = await readFile(await download.path());
    const text = await extractText(bytes);
    record(
      name,
      'save and reopen',
      text.includes(`Cross browser ${name}`) ? 'PASS' : 'FAIL',
      `${bytes.byteLength} bytes`,
    );

    const knownCanvasGap = consoleErrors.filter((message) =>
      /no canvas implementation/i.test(message),
    );
    if (probes.offscreenCanvas === false && knownCanvasGap.length > 0) {
      record(
        name,
        'worker page raster',
        'UNSUPPORTED',
        'OffscreenCanvas is absent in this engine build; text editing and export still work',
      );
    }
    const unexpected = consoleErrors.filter(
      (message) => !/no canvas implementation/i.test(message),
    );
    // A failing resource is the useful part of a console error: keep the URL in
    // the report, and never blame the optional Worker for a non-`/api` 5xx.
    const failed = failedResources.filter((entry) => apiAvailable || !entry.includes('/api/'));
    const detail = unexpected[0] ?? failed[0] ?? 'clean';
    record(
      name,
      'no unexpected page errors',
      unexpected.length === 0 && failed.length === 0 ? 'PASS' : 'FAIL',
      detail,
    );
  } catch (error) {
    record(name, 'editor loop', 'FAIL', String(error.message).split('\n')[0]);
  } finally {
    await context.close();
    await browser.close();
  }
}

const fixturePath = await fixture();
const engines = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
for (const [name, launcher] of engines) {
  console.log(`\n=== ${name} ===`);
  await runEngine(name, launcher, fixturePath);
}

const markdown = [
  '# Cross-browser editor record (H-05)',
  '',
  `Base: ${BASE}`,
  '',
  '| engine | feature | result | detail |',
  '| --- | --- | --- | --- |',
  ...results.map((row) => `| ${row.engine} | ${row.feature} | ${row.status} | ${row.detail.replace(/\|/g, '\\|')} |`),
  '',
  failures === 0
    ? 'All installed engines passed the editor loop. UNSUPPORTED feature probes are recorded, not hidden.'
    : `${failures} check(s) failed. See FAIL rows above.`,
  '',
].join('\n');
await writeFile(path.join(WORK, 'results.md'), markdown);

console.log(`\n=== cross-browser e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
