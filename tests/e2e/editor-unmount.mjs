/**
 * Editor window-listener lifecycle E2E.
 *
 * Regression for the mid-gesture unmount leak: `editor-page` attaches five
 * window listeners when a gesture starts (pointermove/pointerup/pointercancel/
 * blur/keydown) and used to remove them through a closure whose function
 * identities did not match the ones attached -- every render recreated the
 * handlers, and the unmount cleanup ran the first render's closure. Leaving
 * the editor while the pointer was still down therefore kept all five
 * listeners (and the page subtree) alive for the rest of the session.
 *
 * This suite instruments `window.addEventListener`/`removeEventListener`,
 * starts a real drag on an editor object, navigates away mid-drag, and asserts
 * the listeners are gone. It needs only Chromium and the production preview --
 * no API, no Redis.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:editor-unmount
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'alpha.pdf');
const WATCHED = ['pointermove', 'pointerup', 'pointercancel', 'blur', 'keydown'];

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/** Counts live window listeners added by the editor chunk; runs before every document script. */
function installListenerProbe() {
  // Self-contained: Playwright serializes this function into the page, so it
  // cannot close over module scope. Only listeners registered from the lazy
  // `edit-pdf-tool-*.js` chunk are counted: Playwright's own hit-target
  // interceptor and the destination page's decorations attach window listeners
  // too, and they are not what this suite is about.
  const watched = ['pointermove', 'pointerup', 'pointercancel', 'blur', 'keydown'];
  const live = new Map(watched.map((type) => [type, new Set()]));
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  window.__gestureListeners = () =>
    Object.fromEntries([...live].map(([type, set]) => [type, set.size]));
  window.addEventListener = function (type, listener, options) {
    if (live.has(type) && listener && (new Error().stack ?? '').includes('edit-pdf-tool')) {
      live.get(type).add(listener);
    }
    return add(type, listener, options);
  };
  window.removeEventListener = function (type, listener, options) {
    if (live.has(type) && listener) live.get(type).delete(listener);
    return remove(type, listener, options);
  };
}

async function counts(page) {
  return page.evaluate(() => window.__gestureListeners());
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(installListenerProbe);
  const page = await context.newPage();
  try {
    // SPA-navigate from the home page so `history.back()` stays in the app;
    // a full page load would destroy the document (and its listeners) itself.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('a[href="/tools/edit-pdf"]').first().click();
    // Same beat the keyboard suite takes: wait for the route to commit before
    // pointing the file input at a fixture, so the change handler is attached.
    await page.waitForFunction(
      () =>
        performance.getEntriesByName('pdfshush:tool-ready').length > 0 ||
        performance.getEntriesByName('pdfshush:page-ready').length > 0,
      undefined,
      { timeout: 30_000 },
    );
    await page.locator('button.dropzone').first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.locator('input[type=file]').setInputFiles(FIXTURE);
    // One `editor-page` exists per rendered page; the first one is not always
    // the visible page, so wait for attachment and then pick a visible page.
    await page.locator('[data-testid="editor-page"]').first().waitFor({
      state: 'attached',
      timeout: 90_000,
    });
    const editorPage = page.locator('[data-testid="editor-page"]:visible').first();
    await editorPage.waitFor({ state: 'visible', timeout: 30_000 });

    // Create a text object (same keyboard path as the keyboard suite), then
    // switch to Select so a pointerdown on it starts a move gesture.
    await editorPage.focus();
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    await page.getByTestId('editor-text-input').waitFor({ timeout: 10_000 });
    await page.keyboard.type('Drag me');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.locator('[data-object-id]').last().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);

    const baseline = await counts(page);
    const object = await page.locator('[data-object-id]').last().boundingBox();
    check('the editor object has a box to drag', Boolean(object));

    await page.mouse.move(object.x + object.width / 2, object.y + object.height / 2);
    await page.mouse.down();
    const during = await counts(page);

    const attached = WATCHED.every((type) => during[type] > baseline[type]);
    check(
      'a drag attaches the window listeners',
      attached,
      WATCHED.map((type) => `${type} ${baseline[type]}->${during[type]}`).join(', '),
    );

    // Keep the gesture live, then unmount the editor while the button is still
    // down: the exact scenario the cleanup bug missed.
    await page.mouse.move(object.x + object.width / 2 + 24, object.y + object.height / 2 + 24);
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.pathname === '/', undefined, { timeout: 10_000 });
    await page.getByTestId('editor-page').first().waitFor({ state: 'detached', timeout: 10_000 });
    await page.waitForTimeout(300);

    const after = await counts(page);
    const released = WATCHED.every((type) => after[type] === 0);
    check(
      'a mid-drag unmount releases every editor window listener',
      released,
      WATCHED.map((type) => `${type} ${after[type]}`).join(', '),
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(
  `\n=== editor unmount e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`,
);
process.exit(failures === 0 ? 0 : 1);
