/**
 * Browser check for the SEO surface (not a crawl test).
 *
 * Verifies that the React app mounts on the home, guide and tool routes, that
 * the SPA head hook updates the title after a client-side navigation, and that
 * there are no console errors. Run against a preview server:
 *
 *   pnpm --filter @pdfshush/web preview --port 4173
 *   node tests/e2e/seo-smoke.mjs
 */

import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function visit(route, expectedTitlePart) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1');
  const title = await page.title();
  const h1 = await page.locator('h1').first().innerText();
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  check(`${route} renders`, Boolean(h1), h1.slice(0, 60));
  check(`${route} title`, title.includes(expectedTitlePart), title);
  check(`${route} canonical`, canonical === `https://pdfshush.com${route === '/' ? '/' : route}`, canonical ?? 'missing');
}

await visit('/', 'Free Online PDF Tools');
await visit('/compress-pdf', 'PDF Compressor');
await visit('/pdf-under-200kb', '200 KB');
await visit('/tools/compress-pdf', 'Compress PDF');
await visit('/about', 'About PDFShush');

// A tool page must carry exactly one FAQPage block after React mounts: the
// prerendered script is reused, not duplicated by the client.
await page.goto(`${BASE}/tools/compress-pdf`, { waitUntil: 'networkidle' });
const faqSchemas = await page.evaluate(() =>
  [...document.querySelectorAll('script[type="application/ld+json"]')].filter((script) =>
    script.textContent?.includes('"@type":"FAQPage"'),
  ).length,
);
check('tool page has one FAQPage schema', faqSchemas === 1, `${faqSchemas} blocks`);
const toolSchemas = await page.locator('script[type="application/ld+json"]').count();
check('tool page replaces static JSON-LD', toolSchemas === 4, `${toolSchemas} schema blocks`);

// The JSON-LD the hook manages must survive a client-side navigation and be
// replaced, not duplicated.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
const link = page.locator('a[href="/pdf-under-200kb"]').first();
if (await link.count()) {
  await link.click();
  await page.waitForURL('**/pdf-under-200kb');
  await page.waitForFunction(() => document.title.includes('200 KB'), null, { timeout: 10000 });
  const title = await page.title();
  check('SPA navigation updates the title', title.includes('200 KB'), title);
  const schemas = await page.locator('script[data-seo-jsonld]').count();
  check('SPA navigation replaces JSON-LD', schemas === 3, `${schemas} schema blocks`);
  const totalSchemas = await page.locator('script[type="application/ld+json"]').count();
  check('guide has no duplicate JSON-LD', totalSchemas === 3, `${totalSchemas} total blocks`);
  const faq = await page.locator('details').count();
  check('guide FAQ is in the DOM', faq >= 4, `${faq} details`);
} else {
  check('home links the 200 KB guide', false);
}

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n=== seo smoke: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
