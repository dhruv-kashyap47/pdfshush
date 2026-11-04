/**
 * Standalone verifier E2E (PLAN.md §31.6, M5.2/M5.8).
 *
 * The verifier moved into a worker in M5.8; this proves the page still runs the
 * real engine, not just that it renders. A text PDF must report "content
 * remains"; an image-only PDF must produce a receipt with a SHA-256 digest.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:verify
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEXT_PDF = path.join(HERE, 'fixtures', 'alpha.pdf');
const IMAGE_PDF = path.join(HERE, 'fixtures', 'imaged.pdf');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto(`${BASE}/verify`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('verify-result').waitFor({ state: 'detached', timeout: 5000 }).catch(() => null);

    await page.locator('input[type=file]').setInputFiles(TEXT_PDF);
    const result = page.getByTestId('verify-result');
    await result.waitFor({ timeout: 90_000 });
    check(
      'a text PDF is reported as content remaining',
      (await result.getAttribute('data-ok')) === 'false',
      await page.getByTestId('verify-verdict').innerText(),
    );
    const digest = await page.getByTestId('verify-digest').innerText();
    check('the receipt carries a SHA-256 digest', /[0-9a-f]{64}/.test(digest), digest.slice(0, 24));

    await page.locator('input[type=file]').setInputFiles(IMAGE_PDF);
    await page.waitForFunction(
      (previous) => {
        const element = document.querySelector('[data-testid="verify-digest"]');
        return Boolean(element && element.textContent !== previous);
      },
      digest,
      { timeout: 90_000 },
    );
    const checks = await page.getByTestId('verify-checks').innerText();
    check('an image-only PDF returns a check list', checks.length > 20, `${checks.length} chars`);
    check('no page error while the worker runs', errors.length === 0, errors.join(' | ').slice(0, 200));
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n=== verifier e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
