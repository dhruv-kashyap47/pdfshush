/**
 * Focused browser E2E for genuine in-place text editing.
 *
 * The full smoke suite stops at a pre-existing editor-interaction failure before
 * it reaches the save assertions (reproduced with this work reverted), so this
 * script drives just the new path: open the editor, click an existing run, retype
 * it, save, and prove from the downloaded bytes that the replacement is real.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/text-edit.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf, extractText, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'text-edit');
const ORIGINAL = 'Replace me now';
const REPLACEMENT = 'Edited in place';

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'replace-me.pdf');
  await writeFile(fixture, buildPdf(ORIGINAL));

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    // A failed resource load is the optional API being absent (the app's
    // designed offline posture through the dev proxy), not an app error.
    if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor');

    // Pick the text tool and click the existing run's overlay.
    await page.getByTestId('editor-tool-text').click();
    const run = await waitFor(
      async () => {
        const box = await page.getByTestId('editor-run').first().boundingBox();
        return box && box.width > 0 ? box : null;
      },
      30_000,
      'text run overlay',
    );
    check('existing run is offered for replacement', run.width > 0, `${Math.round(run.width)}px`);

    await page.mouse.click(run.x + run.width / 2, run.y + run.height / 2);
    await page.getByTestId('editor-text-input').waitFor({ timeout: 15_000 });
    check(
      'seed-replace prefills the original text',
      (await page.getByTestId('editor-text-input').inputValue()) === ORIGINAL,
    );

    await page.getByTestId('editor-text-input').fill(REPLACEMENT);
    await page.getByTestId('editor-tool-select').click(); // commit

    await page.getByTestId('editor-save').click();
    await page.getByText('-edited.pdf').first().waitFor({ timeout: 90_000 });

    // The toast must claim a genuine rewrite, not an overlay.
    const toast = await waitFor(
      async () => {
        const text = await page.locator('[data-sonner-toast]').allInnerTexts();
        return text.find((entry) => entry.includes('replaced in place')) ?? null;
      },
      10_000,
      'in-place toast',
    );
    check('save reports a genuine in-place rewrite', toast.includes('replaced in place'), toast);
    check('save does not claim an overlay', !toast.includes('overlay'), toast);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const bytes = await readFile(await download.path());
    check('download is a valid PDF', bytes.subarray(0, 5).toString('latin1') === '%PDF-');

    const text = await extractText(bytes);
    check('replacement is present in the exported PDF', text.includes(REPLACEMENT), text.trim());
    check('original text is gone from the exported PDF', !text.includes(ORIGINAL), text.trim());

    check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await page.screenshot({ path: path.join(WORK, 'result.png') }).catch(() => undefined);
    await browser.close();
  }

  console.log(`\n=== text-edit E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('text-edit E2E crashed:', error);
  process.exit(1);
});
