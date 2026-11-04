/**
 * Verifiable-privacy end-to-end suite (PLAN.md §31.6, M5.2).
 *
 * Unlike the other browser suites this one runs against a **production build**
 * behind `vite preview`, because the two things it checks do not exist on the
 * dev server:
 *
 *   - the Content-Security-Policy meta tag is injected at build time;
 *   - the service worker is emitted at `/sw.js` and only registers in prod.
 *
 *   pnpm build && pnpm preview     # terminal 1
 *   pnpm test:e2e:offline          # terminal 2
 *
 * What it proves, in the order the trust page claims it:
 *   1. the manifest and the policy are real, parseable artifacts;
 *   2. the worker activates and controls the page under a versioned cache;
 *   3. a client tool runs with the network *off* after one online use;
 *   4. no request during that job left the origin or carried a body;
 *   5. the trust page renders the policy it is actually running under, and its
 *      live proof reports zero uploads;
 *   6. the standalone verifier page loads.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const ORIGIN = new URL(BASE).origin;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const ARTIFACTS = path.join(HERE, 'artifacts');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function waitFor(fn, label, timeoutMs = 60_000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

/** Hand-built spec-valid PDF, same recipe as the other suites. */
function buildPdf(text) {
  const stream = `BT /F1 18 Tf 72 770 Td (${text}) Tj ET`;
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let n = 1; n <= 5; n += 1) {
    offsets[n] = Buffer.byteLength(body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, 'latin1');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n += 1) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(body, 'latin1'), Buffer.from(xref, 'latin1')]);
}

/** Ask the running build for the policy it injected. */
async function readPolicy(page) {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return meta?.content ?? null;
  });
}

function directive(policy, name) {
  return (
    policy
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? null
  );
}

async function main() {
  await mkdir(FIXTURES, { recursive: true });
  await mkdir(ARTIFACTS, { recursive: true });
  const fileA = path.join(FIXTURES, 'offline-a.pdf');
  const fileB = path.join(FIXTURES, 'offline-b.pdf');
  await writeFile(fileA, buildPdf('Offline proof page A'));
  await writeFile(fileB, buildPdf('Offline proof page B'));

  // Fail early with the fix, not a stack trace from inside Playwright.
  let root;
  try {
    root = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    console.error(
      `[offline] ${BASE} is not reachable. This suite needs a production build:\n` +
        '  pnpm build\n  pnpm preview\n  pnpm test:e2e:offline',
    );
    process.exitCode = 1;
    return;
  }
  const sw = await fetch(`${BASE}/sw.js`, { signal: AbortSignal.timeout(5_000) });
  const html = await root.text();
  if (!sw.ok || !html.includes('Content-Security-Policy')) {
    console.error(
      '[offline] this build has no service worker or no CSP meta tag. Build first:\n' +
        '  pnpm build\n  pnpm preview\n  pnpm test:e2e:offline',
    );
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  /**
   * Console errors are collected for the online phases only. The offline phase
   * deliberately removes the network, so every `/api` call and every resource
   * the cache missed produces a browser error by design; asserting on those
   * would make the suite pass only if the app never tried to work.
   */
  let offlinePhase = false;
  page.on('console', (message) => {
    if (offlinePhase) return;
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (offlinePhase) return;
    consoleErrors.push(String(error));
  });

  /** Requests observed during the online merge. */
  const seen = [];
  page.on('request', (request) => {
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    seen.push({ url, method: request.method(), hasBody: request.postData() !== null });
  });

  try {
    /* ------------------------------------------------------------ manifest */
    console.log('\n1. Manifest and policy');
    const manifestResponse = await fetch(`${BASE}/manifest.webmanifest`);
    const manifest = await manifestResponse.json().catch(() => null);
    check('manifest is served', manifestResponse.ok, `${manifestResponse.status}`);
    check('manifest parses as JSON', manifest !== null);
    check('manifest has a name and start_url', Boolean(manifest?.name && manifest?.start_url));
    const sizes = (manifest?.icons ?? []).map((icon) => icon.sizes);
    check('manifest ships 192, 512 and maskable icons', sizes.includes('192x192') && sizes.includes('512x512') && (manifest?.icons ?? []).some((icon) => icon.purpose === 'maskable'), sizes.join(', '));

    const iconResponse = await fetch(`${BASE}/icons/icon-192.png`);
    check('192px icon is a real PNG', iconResponse.ok && iconResponse.headers.get('content-type') === 'image/png');

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const policy = await readPolicy(page);
    check('CSP meta is present in the built HTML', Boolean(policy));
    const connect = directive(policy, 'connect-src');
    check('connect-src is an allowlist, not "https:"', Boolean(connect) && !connect.split(/\s+/).includes('https:') && !connect.split(/\s+/).includes('*'), connect?.slice(0, 80));
    check("connect-src includes 'self'", connect?.includes("'self'") === true);
    check("form-action is 'self' (no off-origin POST)", directive(policy, 'form-action') === "form-action 'self'");
    check("object-src is 'none'", directive(policy, 'object-src') === "object-src 'none'");
    check('the manifest is linked', (await page.locator('link[rel=manifest]').count()) === 1);

    /* -------------------------------------------------- service worker live */
    console.log('\n2. Service worker');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const controlled = await waitFor(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      'service worker control',
      20_000,
    );
    check('a service worker controls the page', controlled);

    const swSource = await sw.text();
    const cacheVersion = /const BUILD_ID = '([^']+)'/.exec(swSource)?.[1];
    check('sw.js carries a build id (versioned cache)', Boolean(cacheVersion), cacheVersion ?? 'missing');
    check('sw.js precaches the shell', swSource.includes("'/index.html'"));

    /* -------------------------------------------------------- online merge */
    console.log('\n3. Online run (warms the cache, records egress)');
    await page.goto(`${BASE}/tools/merge-pdf`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Merge PDF files' }).waitFor({ timeout: 30_000 });

    const merge = async () => {
      await page.locator('input[type=file]').first().setInputFiles([fileA, fileB]);
      await waitFor(
        async () => (await page.getByRole('button', { name: /^Merge \d+ files?$/ }).count()) > 0,
        'merge button',
        30_000,
      );
      // Record only what happens around the job itself.
      seen.length = 0;
      await page.getByRole('button', { name: /^Merge \d+ files?$/ }).click();
      await waitFor(
        async () => (await page.getByRole('button', { name: 'Download' }).count()) > 0,
        'merge result',
        120_000,
      );
    };
    await merge();
    check('online merge completes', true);

    const duringOnline = [...seen];
    const external = duringOnline.filter((request) => request.url.origin !== ORIGIN);
    const bodyBearing = duringOnline.filter(
      (request) => request.hasBody && request.method !== 'GET' && request.method !== 'HEAD',
    );
    check(
      'no request left the origin during a client job',
      external.length === 0,
      external.map((request) => request.url.href).slice(0, 3).join(', ') || 'none',
    );
    check(
      'no request carried a body (no upload)',
      bodyBearing.length === 0,
      bodyBearing.map((request) => `${request.method} ${request.url.pathname}`).slice(0, 3).join(', ') || 'none',
    );

    /* ---------------------------------------------------------- offline run */
    console.log('\n4. Offline run (network actually disabled)');
    offlinePhase = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const heading = await waitFor(
      async () => (await page.getByRole('heading', { name: 'Merge PDF files' }).count()) > 0,
      'cached shell + tool chunk',
      60_000,
    );
    check('the tool route reloads from the service worker with the network off', heading);

    await merge();
    check('a real client-side merge completes with no network', true);
    await page.screenshot({ path: path.join(HERE, 'artifacts', 'offline-merge.png') });

    await context.setOffline(false);
    offlinePhase = false;

    /* ------------------------------------------------------------ trust UI */
    console.log('\n5. Trust page');
    await page.goto(`${BASE}/trust`, { waitUntil: 'networkidle' });
    const chips = await page.locator('[data-testid=trust-connect-src] span').allInnerTexts();
    check('the trust page renders the live connect-src list', chips.length > 3 && chips.includes("'self'"), `${chips.length} entries`);
    check('the trust page lists no wildcard origin', !chips.includes('*') && !chips.includes('https:'));

    await page.getByTestId('trust-prove-run').click();
    await waitFor(
      async () => (await page.getByTestId('trust-proof-result').count()) > 0,
      'proof result',
      60_000,
    );
    const proof = await page.getByTestId('trust-proof-result').evaluate((node) => ({
      uploads: node.dataset.uploads,
      crossOrigin: node.dataset.crossOrigin,
      crossOriginResources: node.dataset.crossOriginResources,
      requests: node.dataset.requests,
    }));
    check('the live proof reports zero body-bearing requests', proof.uploads === '0', JSON.stringify(proof));
    check('the live proof reports zero cross-origin traffic', proof.crossOrigin === '0' && proof.crossOriginResources === '0');

    const status = await page.getByTestId('trust-sw-status').getAttribute('data-active');
    check('the trust page shows the service worker as active', status === 'true', String(status));

    /* ---------------------------------------------------------- verifier UI */
    console.log('\n6. Verifier page');
    await page.goto(`${BASE}/verify`, { waitUntil: 'networkidle' });
    check('the verifier page loads with a drop target', (await page.locator('input[type=file]').count()) === 1);
    check('the verifier explains what it cannot check', await page.getByText(/does not claim|not checked/iu).first().isVisible());
  } finally {
    const errors = consoleErrors.filter((text) => {
      if (text.includes('favicon')) return false;
      // `/api` is not served by `vite preview`; a 502 is the absence of the API,
      // not a privacy or CSP regression.
      if (text.includes('502')) return false;
      if (text.includes('Failed to load resource') && text.includes('404')) return false;
      return true;
    });
    if (errors.length > 0) {
      console.log('\nBrowser console errors:');
      for (const text of errors) console.log(`  ${text}`);
      check('no unexpected console error', false, `${errors.length} error(s)`);
    }
    await browser.close();
  }

  console.log(
    failures === 0
      ? '\n=== offline/privacy e2e: ok ==='
      : `\n=== offline/privacy e2e: ${failures} failed ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
