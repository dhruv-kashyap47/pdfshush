/**
 * Baseline diagnostic (read-only): names the element the responsive sweep sees
 * as an unrevealed `[data-reveal]` block on every route except `/`.
 *
 *   node docs/pdf-audit/.baseline/probe-reveal.mjs
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const route of ['/', '/tools/merge-pdf', '/workflows']) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = 'auto';
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < html.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 130));
    }
    window.scrollTo(0, html.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  const found = await page.evaluate(() =>
    [...document.querySelectorAll('[data-reveal]:not([data-revealed])')]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 160),
        text: (el.textContent ?? '').trim().slice(0, 80),
        rect: el.getBoundingClientRect().toJSON(),
      })),
  );
  console.log(route, JSON.stringify(found, null, 2));
}
await browser.close();
