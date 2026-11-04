/**
 * Keyboard E2E (PLAN.md §31.6, M5.6).
 *
 * Two claims, both without a mouse:
 *  1. Every tool class can be started from the keyboard: Tab reaches a file
 *     input, the focused control has an accessible name.
 *  2. The canvas editor supports select/create, nudge, delete and undo from the
 *     keyboard alone. A text object is placed with T + Enter, typed, nudged with
 *     ArrowRight, deleted with Delete and restored with Ctrl+Z.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:keyboard
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'alpha.pdf');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function ready(page) {
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('pdfshush:tool-ready').length > 0 ||
      performance.getEntriesByName('pdfshush:page-ready').length > 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(100);
}

async function tabToPicker(page, limit = 60) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      return {
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute('type'),
        name:
          element.getAttribute('aria-label') ??
          element.getAttribute('title') ??
          element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60) ??
          '',
        hidden: element.offsetParent === null && element.tagName !== 'BODY',
      };
    });
    if (!focused) continue;
    if (focused.tag === 'input' && focused.type === 'file') return { focused, tabs: index + 1 };
    if (
      focused.tag === 'button' &&
      !focused.hidden &&
      /choose|select|upload|drop|browse|pick/i.test(focused.name)
    ) {
      return { focused, tabs: index + 1 };
    }
  }
  return { focused: null, tabs: limit };
}

const browser = await chromium.launch();
try {
  const classes = [
    ['merge', '/tools/merge-pdf'],
    ['split', '/tools/split-by-pages'],
    ['page-ops', '/tools/delete-pages'],
    ['security', '/tools/redact-pdf'],
    ['raster', '/tools/pdf-to-jpg'],
    ['stamp', '/tools/watermark'],
  ];
  for (const [name, route] of classes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await ready(page);
      // `tool-ready` marks the React commit; give layout a beat so the picker is
      // actually in the tab order (the same pause a user makes).
      await page.locator('button.dropzone').first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      const { focused, tabs } = await tabToPicker(page);
      check(`${name}: Tab reaches the file picker`, Boolean(focused), `${tabs} stops`);
      check(`${name}: the picker has an accessible name`, Boolean(focused?.name), focused?.name ?? 'no name');
    } finally {
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await ready(page);
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    await page.getByTestId('editor-page').first().waitFor({ timeout: 90_000 });

    const pageBox = page.getByTestId('editor-page').first();
    await pageBox.focus();
    check('editor page is keyboard-focusable', await pageBox.evaluate((element) => element === document.activeElement));

    // Create a text object without a pointer: T selects the text tool, Enter
    // places the default box at the page centre and opens its editor.
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    const input = page.getByTestId('editor-text-input');
    await input.waitFor({ timeout: 10_000 });
    check('T + Enter creates and opens a text object', true);
    await page.keyboard.type('Keyboard path');
    await page.keyboard.press('Escape');
    await page.getByTestId('editor-inspector').waitFor({ timeout: 10_000 });
    check('the created object is selected', true);

    const before = await page.locator('[data-object-id]').last().boundingBox();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowRight');
    const after = await page.locator('[data-object-id]').last().boundingBox();
    check(
      'ArrowRight nudges the selected object',
      Boolean(before && after && after.x > before.x),
      before && after ? `${Math.round(before.x)} -> ${Math.round(after.x)}` : 'no box',
    );

    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);
    check(
      'Delete removes the selected object',
      (await page.locator('[data-object-id]').count()) === 0,
    );

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    check(
      'Ctrl+Z restores the deleted object',
      (await page.locator('[data-object-id]').count()) > 0,
    );

    // Select mode: Enter on the page selects the topmost object, so the
    // keyboard path does not depend on the text tool staying active.
    await page.keyboard.press('s');
    await pageBox.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    check(
      'Enter in Select mode selects an object',
      (await page.getByTestId('editor-inspector').count()) === 1,
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n=== keyboard e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
