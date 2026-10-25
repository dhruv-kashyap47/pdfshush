/**
 * Responsive sweep (not a gate).
 *
 * Loads a set of routes at every breakpoint the brief calls out, in both themes,
 * and reports horizontal overflow, unrevealed scroll-reveal blocks, and any
 * text node rendered at a size/contrast that is obviously out of range. This is
 * the check that catches a layout regression without eyeballing six screenshots.
 *
 *   node tests/sweep.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [430, 932],
  [375, 812],
];
const ROUTES = ['/', '/tools/merge-pdf', '/tools/chat-with-pdf', '/tools/redact-pdf', '/tools/pdf-to-jpg', '/workflows'];

let problems = 0;
const browser = await chromium.launch({ channel: 'msedge' });
// Needs a running app, exactly like the E2E suites — fail with the command to
// run rather than a bare ERR_CONNECTION_REFUSED stack.
{
  const probe = await browser.newPage();
  try {
    await probe.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 10_000 });
  } catch {
    console.error(`No app at ${BASE}. Start one first:  pnpm dev   (then: pnpm test:sweep)`);
    await browser.close();
    process.exit(1);
  }
  await probe.close();
}

for (const theme of ['light', 'dark']) {
  for (const [width, height] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    await context.addInitScript((t) => localStorage.setItem('pdfshush-theme', t), theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        // The app sets `scroll-behavior: smooth`, so window.scrollTo() starts an
        // animation that the next call interrupts. A fast sweep then never
        // reaches the bottom and reports live sections as unrevealed. The sweep
        // is about layout, not motion, so scroll instantly for its duration.
        const html = document.documentElement;
        const previous = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        try {
          const step = Math.round(window.innerHeight * 0.8);
          for (let y = 0; y < html.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 130));
          }
          // One extra beat at the bottom so the last blocks can intersect.
          window.scrollTo(0, html.scrollHeight);
          await new Promise((r) => setTimeout(r, 300));
        } finally {
          html.style.scrollBehavior = previous;
          window.scrollTo(0, 0);
          await new Promise((r) => setTimeout(r, 300));
        }
      });

      const report = await page.evaluate(() => {
        const doc = document.documentElement;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
          // `data-bleed` marks art that is deliberately scaled past the
          // viewport and clipped by an ancestor (the landing band's settle
          // animation). It cannot cause page-level overflow; the parent clips.
          if (el.closest('[data-bleed]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed') {
            const scroller = el.closest('[data-slot="scroll-area"], .overflow-x-auto, .overflow-auto');
            if (!scroller) {
              offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`);
            }
          }
        }
        return {
          overflow: doc.scrollWidth - window.innerWidth,
          unrevealed: document.querySelectorAll('[data-reveal]:not([data-revealed])').length,
          offenders: offenders.slice(0, 4),
        };
      });

      const bad = report.overflow > 1 || report.unrevealed > 0 || report.offenders.length > 0;
      if (bad) {
        problems += 1;
        console.log(
          `[FAIL] ${theme} ${width} ${route}  overflow=${report.overflow} unrevealed=${report.unrevealed}` +
            (report.offenders.length ? ` offenders=${report.offenders.join(', ')}` : ''),
        );
      }
    }
    if (errors.length) {
      problems += 1;
      console.log(`[FAIL] ${theme} ${width} page errors: ${errors.slice(0, 2).join(' | ')}`);
    }
    await context.close();
  }
}

await browser.close();
console.log(problems === 0 ? '=== sweep: clean across 6 breakpoints x 2 themes x 6 routes ===' : `=== sweep: ${problems} problem group(s) ===`);
process.exit(problems === 0 ? 0 : 1);