/**
 * Login -> profile photo, in a real browser.
 *
 * The unit test pins the field mapping and the CSP; this drives the actual
 * sequence: `/api/auth/me` answers with a Google `picture`, the header renders
 * it, and the image request is allowed by the production Content-Security
 * Policy. It also proves the two fallbacks: no picture at all, and a picture
 * URL that fails to load. A regression in any of those used to leave a broken
 * image or an empty circle where the account control should be.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:account-avatar
 */

import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const PICTURE = 'https://lh3.googleusercontent.com/a/ACg8oc-profile-photo=s96-c';

/** A 1x1 transparent PNG; enough for `naturalWidth > 0` without a real avatar. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const account = (picture) => ({
  account: {
    id: 'acct-avatar',
    email: 'ada@example.com',
    emailVerified: true,
    name: 'Ada Lovelace',
    picture,
    plan: 'free',
  },
});

let failures = 0;

function check(engine, name, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${engine}: ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function apiRoutes(page, picture) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(account(picture)),
      });
    }
    if (path === '/api/tools') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: { enabled: true }, ai: { enabled: false } }),
      });
    }
    if (path === '/api/account/preferences') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: { syncHistory: false } }),
      });
    }
    if (path === '/api/capabilities') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: true,
          managedAi: false,
          serverJobs: false,
          workflows: false,
          publicApi: false,
          mcp: false,
        }),
      });
    }
    if (path === '/api/sponsors') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ slots: [], billing: { enabled: false } }),
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not found', code: 'not_found' }),
    });
  });
}

async function avatarState(page) {
  await page.getByTestId('account-avatar').first().waitFor({ timeout: 15_000 });
  return page.getByTestId('account-avatar').first().evaluate((element) => ({
    tag: element.tagName,
    text: element.textContent ?? '',
    src: element instanceof HTMLImageElement ? element.currentSrc || element.src : '',
    loaded: element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : false,
  }));
}

async function runPictureCase(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location?.()?.url ?? '';
      errors.push(source ? `${message.text()} (${source})` : message.text());
    }
  });
  await apiRoutes(page, PICTURE);
  await page.route('https://lh3.googleusercontent.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="account-avatar"]');
      return (
        element instanceof HTMLImageElement &&
        element.complete &&
        element.naturalWidth > 0
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  const state = await avatarState(page);
  check('chromium', 'login response renders the Google photo', state.tag === 'IMG' && state.loaded, state.src);
  check('chromium', 'the picture URL is the one the API returned', state.src === PICTURE, state.src);
  check('chromium', 'no page errors while loading the photo', errors.length === 0, errors[0] ?? 'clean');

  await context.close();
}

async function runFallbackCase(browser, label, picture, fulfillImage) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await apiRoutes(page, picture);
  if (fulfillImage) {
    await page.route('https://lh3.googleusercontent.com/**', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }),
    );
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByTestId('account-avatar').first().waitFor({ timeout: 15_000 });
  // The fallback is a span; the broken-image path starts as an img and swaps
  // after onError, so wait for the swap rather than racing it.
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-testid="account-avatar"]');
      return element instanceof HTMLElement && element.tagName === 'SPAN';
    },
    undefined,
    { timeout: 10_000 },
  );
  const state = await avatarState(page);
  check('chromium', label, state.tag === 'SPAN' && state.text === 'AL', `${state.tag} "${state.text}"`);

  await context.close();
}

const browser = await chromium.launch();
try {
  await runPictureCase(browser);
  await runFallbackCase(browser, 'missing picture falls back to initials', null, false);
  await runFallbackCase(
    browser,
    'a failed picture request falls back to initials',
    PICTURE,
    true,
  );
} finally {
  await browser.close();
}

console.log(`\n=== account avatar e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
