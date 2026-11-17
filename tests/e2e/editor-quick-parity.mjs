/**
 * Sprint 2 browser E2E: quick-parity editing tools.
 *
 * Proves the new object kinds and viewport controls end to end: draw a pen
 * stroke, place check/cross/date/stamp objects, copy/paste one with the
 * keyboard, type a 400% zoom and fit the page, toggle the detected-text debug
 * outline, and read the saved bytes back to confirm the stamp and date survive
 * as real text.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/editor-quick-parity.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf, extractText, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'editor-quick-parity');

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

function expectedDate() {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'quick-parity.pdf');
  await writeFile(fixture, buildPdf('Quick parity fixture'));

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor');

    const canvas = await waitFor(
      async () => {
        const box = await page.getByTestId('editor-page-0').boundingBox();
        return box && box.width > 200 ? box : null;
      },
      30_000,
      'page box',
    );
    // Recompute after any zoom change: the page box is scaled by zoom, and a
    // fraction of the *old* box can land under the status bar.
    const at = async (fx, fy) => {
      const box = await page.getByTestId('editor-page-0').boundingBox();
      return { x: box.x + box.width * fx, y: box.y + box.height * fy };
    };
    const visibleAt = async (fx, fy) => {
      const point = await at(fx, fy);
      // Keep clicks above the status bar (the page is taller than the viewport
      // at fit-width zoom) and inside the horizontal canvas.
      return {
        x: point.x,
        y: Math.min(point.y, (await page.evaluate(() => window.innerHeight)) - 100),
      };
    };
    check('page is visible', canvas.width > 0);

    // ---- pen: freehand stroke survives as one ink object -------------------
    await page.getByTestId('editor-tool-pen').click();
    const strokeStart = await visibleAt(0.2, 0.2);
    await page.mouse.move(strokeStart.x, strokeStart.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(strokeStart.x + step * 6, strokeStart.y + Math.sin(step) * 8);
    }
    await page.mouse.up();
    await waitFor(
      async () => (await page.getByTestId('editor-object-ink').count()) === 1,
      10_000,
      'ink object',
    );
    check('pen places a single ink object', true);

    // One gesture is one undo step, and redo restores the same stroke.
    await page.getByTestId('editor-undo').click();
    await waitFor(
      async () => (await page.getByTestId('editor-object-ink').count()) === 0,
      5_000,
      'ink removed by one undo',
    );
    await page.getByTestId('editor-redo').click();
    await waitFor(
      async () => (await page.getByTestId('editor-object-ink').count()) === 1,
      5_000,
      'ink restored by redo',
    );
    check('a stroke is one undo step', true);

    // ---- check and cross marks --------------------------------------------
    const checkPoint = await visibleAt(0.62, 0.18);
    await page.getByTestId('editor-tool-check').click();
    await page.mouse.click(checkPoint.x, checkPoint.y);
    await waitFor(
      async () => (await page.getByTestId('editor-object-check').count()) === 1,
      10_000,
      'check mark',
    );
    check('check mark places as one check object', true);

    const crossPoint = await visibleAt(0.72, 0.18);
    await page.getByTestId('editor-tool-cross').click();
    await page.mouse.click(crossPoint.x, crossPoint.y);
    await waitFor(
      async () => (await page.getByTestId('editor-object-cross').count()) === 1,
      10_000,
      'cross mark',
    );
    check('cross mark places as one cross object', true);

    // ---- date stamp --------------------------------------------------------
    const datePoint = await visibleAt(0.3, 0.42);
    await page.getByTestId('editor-tool-date').click();
    await page.mouse.click(datePoint.x, datePoint.y);
    const dateText = await waitFor(
      async () => {
        const texts = await page.getByTestId('editor-object-text').allInnerTexts();
        return texts.find((value) => value.includes(String(new Date().getFullYear()))) ?? null;
      },
      10_000,
      'date text object',
    );
    check('date stamp places today as editable text', dateText.includes(expectedDate()), dateText);

    // ---- stamp preset, then object clipboard ------------------------------
    const stampPoint = await visibleAt(0.72, 0.5);
    await page.getByTestId('editor-tool-stamp').click();
    await page.getByTestId('editor-stamp-preset-confidential').click();
    await page.mouse.click(stampPoint.x, stampPoint.y);
    const stamp = page.getByTestId('editor-object-stamp').first();
    await stamp.waitFor({ timeout: 10_000 });
    check('stamp preset places a labelled stamp', (await stamp.innerText()).includes('CONFIDENTIAL'));

    const before = await stamp.boundingBox();
    await page.getByTestId('editor-tool-select').click();
    await stamp.click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const stamps = page.getByTestId('editor-object-stamp');
    await waitFor(async () => (await stamps.count()) === 2, 10_000, 'pasted stamp');
    const after = await stamps.nth(1).boundingBox();
    check('Ctrl+C / Ctrl+V copies the object onto the page', after !== null);
    check(
      'paste offsets the copy instead of stacking it exactly',
      after !== null && before !== null && after.x > before.x && after.y > before.y,
      `${Math.round(before?.x ?? 0)} → ${Math.round(after?.x ?? 0)}`,
    );

    // ---- keyboard path + accessible names ---------------------------------
    check(
      'the stamp tool has an accessible name',
      ((await page.getByTestId('editor-tool-stamp').getAttribute('aria-label')) ?? '').length > 0,
      (await page.getByTestId('editor-tool-stamp').getAttribute('aria-label')) ?? '',
    );
    await page.getByTestId('editor-page').first().focus();
    await page.keyboard.press('m');
    await page.keyboard.press('Enter');
    await waitFor(
      async () => (await page.getByTestId('editor-object-stamp').count()) === 3,
      10_000,
      'stamp placed from the keyboard',
    );
    check('M + Enter places a stamp without a mouse', true);

    // ---- zoom: typed 400%, then fit page ----------------------------------
    const zoom = page.getByTestId('editor-zoom-level');
    await zoom.fill('400');
    await zoom.press('Enter');
    check('typed zoom accepts 400%', (await zoom.inputValue()) === '400', await zoom.inputValue());
    await page.getByTestId('editor-fit-page').click();
    const fitted = Number(await zoom.inputValue());
    check('fit page leaves 400% for a whole-page zoom', fitted > 0 && fitted < 400, `${fitted}%`);

    // ---- detected-text outline --------------------------------------------
    await page.getByTestId('editor-tool-select').click();
    await page.getByTestId('editor-text-layer').first().waitFor({ timeout: 20_000 });
    // Deselect so the Document panel (which owns the debug toggle) is visible.
    const emptySpot = await visibleAt(0.08, 0.5);
    await page.mouse.click(emptySpot.x, emptySpot.y);
    await page.getByTestId('editor-outline-toggle').check();
    await page.getByTestId('editor-text-outline-layer').first().waitFor({ timeout: 10_000 });
    const paragraphs = await page.getByTestId('editor-text-outline-paragraph').count();
    check('outline toggle draws detected paragraph outlines', paragraphs > 0, `${paragraphs}`);
    await page.getByTestId('editor-outline-toggle').uncheck();
    check(
      'outline layer disappears when switched off',
      (await page.getByTestId('editor-text-outline-layer').count()) === 0,
    );

    // The same overlay must hold at the maximum zoom, where every rect is four
    // times its 100% size.
    await zoom.fill('400');
    await zoom.press('Enter');
    await page.getByTestId('editor-outline-toggle').check();
    await page.getByTestId('editor-text-outline-layer').first().waitFor({ timeout: 10_000 });
    const linesAt400 = await page.getByTestId('editor-text-outline-line').count();
    check('outline works at 400%', linesAt400 > 0, `${linesAt400} lines`);
    await page.getByTestId('editor-outline-toggle').uncheck();
    await page.getByTestId('editor-fit-page').click();

    // ---- redaction isolation ---------------------------------------------
    await page.getByTestId('editor-mode-redact').click();
    const redactCount = await page.getByTestId('redact-mark-count').innerText();
    check('stamps are not counted as redaction marks', /0 marks/.test(redactCount), redactCount);
    await page.getByTestId('editor-mode-edit').click();

    // ---- save + reopen ----------------------------------------------------
    await page.getByTestId('editor-save').click();
    await page.getByText('-edited.pdf').first().waitFor({ timeout: 90_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const bytes = await readFile(await download.path());
    check('download is a valid PDF', bytes.subarray(0, 5).toString('latin1') === '%PDF-');
    const text = await extractText(bytes);
    const date = expectedDate();
    check('date stamp survives export as text', text.includes(date), text.trim());
    check('stamp label survives export as text', text.includes('CONFIDENTIAL'), text.trim());

    check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await page.screenshot({ path: path.join(WORK, 'result.png') }).catch(() => undefined);
    await browser.close();
  }

  console.log(
    `\n=== editor-quick-parity E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('editor-quick-parity E2E crashed:', error);
  process.exit(1);
});
