/**
 * Accessibility E2E (PLAN.md §31.6, M5.6).
 *
 * Runs axe (WCAG 2.2 AA tags) over the shell and the ten highest-traffic tools
 * and fails on **critical or serious** violations. It also checks that keyboard
 * focus enters the page in a sane order and that every focused control has an
 * accessible name; the canvas editor's full keyboard path lives in
 * `keyboard.mjs`.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:a11y
 *
 * The budget is zero critical/serious. `moderate` and `minor` are printed with
 * their nodes so they are visible, but they do not turn the gate red; claiming
 * zero total violations would be a different (and unmeasured) promise.
 */

import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const ROUTES = [
  '/',
  '/tools/edit-pdf',
  '/tools/merge-pdf',
  '/tools/compress-pdf',
  '/tools/delete-pages',
  '/tools/split-by-pages',
  '/tools/crop-pdf',
  '/tools/fill-sign',
  '/tools/redact-pdf',
  '/tools/pdf-to-jpg',
  '/tools/alternate-mix',
  '/tools/organize-pdf',
  '/tools/summarize-pdf',
  '/tools/chat-with-pdf',
  '/workflows',
];

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function ready(page) {
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('pdfshush:tool-ready').length > 0 ||
      performance.getEntriesByName('pdfshush:page-ready').length > 0,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(120);
}

const browser = await chromium.launch();
try {
  for (const route of ROUTES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await ready(page);
      await page.addScriptTag({ path: AXE_PATH });
      const result = await page.evaluate(async () => {
        // @ts-expect-error axe is injected at runtime
        return await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
          resultTypes: ['violations'],
        });
      });
      const violations = result.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      );
      check(`${route} has zero critical/serious axe violations`, violations.length === 0,
        violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`).join(', ') || 'clean');
      for (const violation of violations) {
        console.log(`         ${violation.help}`);
        for (const node of violation.nodes.slice(0, 4)) {
          console.log(`           ${node.target.join(' ')}`);
          console.log(`           ${node.html.slice(0, 180)}`);
        }
      }
      const others = result.violations.filter(
        (violation) => violation.impact !== 'critical' && violation.impact !== 'serious',
      );
      if (others.length > 0) {
        console.log(
          `         note: ${others.length} moderate/minor rule(s): ${others
            .map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`)
            .join(', ')}`,
        );
      }
    } finally {
      await context.close();
    }
  }

  // Keyboard entry: the first Tab must land on a real control, and the focus
  // ring must be visible (the engine sets a 3px ring in `:focus-visible`).
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    const seen = [];
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab');
      seen.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          if (!(element instanceof HTMLElement)) return null;
          const style = getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            name:
              element.getAttribute('aria-label') ??
              element.textContent?.trim().slice(0, 60) ??
              element.getAttribute('title') ??
              '',
            outline: style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
            hidden: element.offsetParent === null && element.tagName !== 'BODY',
          };
        }),
      );
    }
    const usable = seen.filter((entry) => entry && !entry.hidden && entry.name);
    check('Tab moves focus through the shell', usable.length >= 5, `${usable.length} stops`);
    check(
      'focused controls have an accessible name',
      seen.every((entry) => !entry || entry.name),
      seen.map((entry) => entry?.name || entry?.tag).join(' -> '),
    );
    check(
      'the focus ring is visible on the first stop',
      Boolean(seen[0]?.outline),
      seen[0] ? `${seen[0].tag} ${seen[0].name}` : 'no focus',
    );
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n=== accessibility e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
