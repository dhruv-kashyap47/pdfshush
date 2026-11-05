/**
 * Stale-build recovery E2E.
 *
 * A hashed app can outlive its own assets after a rebuild. Two failure modes
 * used to strand the page:
 *
 *  1. The stylesheet request is answered by the SPA fallback (or a 404), so the
 *     page renders unstyled but no `error` event fires.
 *  2. A lazy route chunk is gone / served as HTML, so the route boundary opens.
 *
 * This suite simulates both against the production preview and asserts that
 * `lib/build-recovery.ts` fetches a fresh shell once, rather than leaving the
 * user on a broken screen.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:stale-build
 */

import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
let failures = 0;

function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function missingStylesheet(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  let mutated = false;

  await page.route('**/tools/edit-pdf*', async (route) => {
    if (mutated) {
      await route.continue();
      return;
    }
    mutated = true;
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /href="\/assets\/index-[^"]+\.css"/,
      'href="/assets/missing-build.css"',
    );
    await route.fulfill({ response, body });
  });

  await page.goto(`${BASE}/tools/edit-pdf#main`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/__build=/, { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')];
    return {
      url: location.href,
      error: document.body.innerText.includes('Something went wrong on this page'),
      loadedRules: sheets.reduce((total, link) => {
        try {
          return total + (link.sheet?.cssRules.length ?? 0);
        } catch {
          return total;
        }
      }, 0),
      hasMissingLink: sheets.some((link) => link.href.includes('missing-build.css')),
    };
  });

  check('missing CSS triggers a fresh build reload', /__build=/.test(state.url), state.url);
  check('the recovered page has real style rules', state.loadedRules > 0, `${state.loadedRules} rules`);
  check('the recovered page has no error boundary', state.error === false);
  check('the stale stylesheet link is gone', state.hasMissingLink === false);
  await context.close();
}

async function missingLazyChunk(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let blocked = false;

  await page.route('**/assets/edit-pdf-tool-*.js', async (route) => {
    if (blocked) {
      await route.continue();
      return;
    }
    blocked = true;
    await route.abort('failed');
  });

  await page.goto(`${BASE}/tools/edit-pdf#main`, { waitUntil: 'networkidle' });
  await page.waitForURL(/__build=/, { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => ({
    url: location.href,
    error: document.body.innerText.includes('Something went wrong on this page'),
    heading: document.querySelector('h1')?.textContent ?? '',
    fileInputs: document.querySelectorAll('input[type="file"]').length,
  }));

  check('missing lazy chunk triggers a fresh build reload', /__build=/.test(state.url), state.url);
  check('the recovered route is the tool page', state.heading.includes('Edit PDF'), state.heading);
  check('the recovered page can accept a file', state.fileInputs > 0);
  check('the recovered page has no error boundary', state.error === false);
  await context.close();
}

const browser = await chromium.launch();
try {
  console.log('1. Missing stylesheet');
  await missingStylesheet(browser);
  console.log('\n2. Missing lazy route chunk');
  await missingLazyChunk(browser);
} finally {
  await browser.close();
}

console.log(`\n=== stale-build e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
if (failures > 0) process.exitCode = 1;
