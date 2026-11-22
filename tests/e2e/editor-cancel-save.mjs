/**
 * Export cancellation E2E (X-06).
 *
 * Proves the cancel path actually tears the worker down instead of hiding the
 * progress UI, that the pool has no busy/queued work afterwards, and that the
 * user's edits are still in the document so a second save is possible.
 *
 * Needs the production preview (no API/Redis):
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:editor-cancel
 */

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'fixtures', 'pdf-audit', 'long-120page.pdf');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function poolStats(page) {
  return page.evaluate(() => window.__pdfshushPool?.stats() ?? null);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__PDFSHUSH_TEST__ = true;
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('a[href="/tools/edit-pdf"]').first().click();
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
    await page.locator('[data-testid="editor-page"]').first().waitFor({
      state: 'attached',
      timeout: 90_000,
    });
    const editorPage = page.locator('[data-testid="editor-page"]:visible').first();
    await editorPage.waitFor({ state: 'visible', timeout: 30_000 });

    // One object is enough to make the document dirty and enable Save.
    await editorPage.focus();
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    await page.getByTestId('editor-text-input').waitFor({ timeout: 10_000 });
    await page.keyboard.type('Cancel me');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.locator('[data-object-id]').last().waitFor({ timeout: 10_000 });

    // S-06: every leave path asks first.
    await page.getByRole('button', { name: 'Change file' }).click();
    await page.getByTestId('editor-confirm-change-file').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Keep editing' }).click();
    check('change file asks before discarding', true);

    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByTestId('editor-confirm-start-over').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Keep editing' }).click();
    check('start over asks before discarding', true);

    await page.evaluate(() => {
      const link = document.querySelector('header a[href="/"]');
      if (link instanceof HTMLElement) link.click();
    });
    await page.getByTestId('editor-confirm-navigate').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Keep editing' }).click();
    check('an in-app link asks before leaving', true);

    // S-06: browser Back cannot be prevented after the fact; the data-router
    // blocker must stop it and show the same sheet.
    await page.evaluate(() => window.history.back());
    await page.getByTestId('editor-confirm-history').waitFor({ timeout: 5_000 });
    check('browser Back asks before discarding', true);
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await page.waitForTimeout(150);
    check(
      'the document is still open after cancelling browser Back',
      (await page.locator('[data-object-id]').count()) > 0 &&
        (await page.getByTestId('editor').count()) === 1,
    );

    check('the document is still open after cancelling every dialog', (await page.locator('[data-object-id]').count()) > 0);

    await page.getByTestId('editor-save').click();
    // The export can finish quickly; click the cancel control through the DOM
    // the moment it exists instead of waiting for Playwright's stability check.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="editor-cancel-save"]') !== null,
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="editor-cancel-save"]');
      if (button instanceof HTMLElement) button.click();
    });
    const cancel = page.getByTestId('editor-cancel-save');
    await cancel.waitFor({ state: 'hidden', timeout: 20_000 });

    const stats = await poolStats(page);
    check('pool probe is installed for the test', stats !== null);
    check(
      'cancel stops the text-edit worker',
      Boolean(stats) && !stats.busySlugs.includes('text-edit'),
      JSON.stringify(stats),
    );
    check('cancel leaves no queued job', Boolean(stats) && stats.queued === 0, JSON.stringify(stats));
    await page.waitForTimeout(400);
    const objects = await page.locator('[data-object-id]').count();
    check('edits survive cancellation', objects > 0, `${objects} object(s)`);
    const save = page.getByTestId('editor-save');
    check('save is available again', await save.isEnabled());

    // S-06: confirming the blocked Back must actually leave, not strand the user.
    await page.evaluate(() => window.history.back());
    await page.getByTestId('editor-confirm-history').waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Discard and leave' }).click();
    await page.waitForFunction(
      () => !window.location.pathname.startsWith('/tools/edit-pdf'),
      undefined,
      { timeout: 10_000 },
    );
    check(
      'confirming browser Back leaves the editor',
      (await page.getByTestId('editor').count()) === 0 &&
        !new URL(page.url()).pathname.startsWith('/tools/edit-pdf'),
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n=== editor cancel-save e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
