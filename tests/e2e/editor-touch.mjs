/**
 * H-06 touch/mobile editor pass.
 *
 * Emulates a phone with real touch input: the document must scroll in Select,
 * stop scrolling while the pen owns the gesture, reject a second palm contact,
 * open Find as a bottom sheet, and open properties as a dismissible sheet.
 *
 *   pnpm build && pnpm preview
 *   pnpm test:e2e:editor-touch
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { waitFor } from '../support/e2e-util.mjs';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'alpha.pdf');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  acceptDownloads: false,
});
const page = await context.newPage();
try {
  await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator('input[type=file]').first().setInputFiles(FIXTURE);
  await page.getByTestId('editor-page').first().waitFor({ timeout: 90_000 });
  await waitFor(
    async () => ((await page.getByTestId('editor-text-layer').count()) > 0 ? true : null),
    30_000,
    'text layer',
  );

  check('phone navigation is present', await page.getByTestId('editor-mobile-nav').isVisible());
  check('find is reachable without a keyboard', await page.getByTestId('editor-find-open').isVisible());

  const pageBox = await page.getByTestId('editor-page').first().boundingBox();
  check('page is sized for the phone', Boolean(pageBox && pageBox.width <= 390), pageBox ? `${Math.round(pageBox.width)}px` : 'no box');

  const selectTouch = await page.getByTestId('editor-page').first().evaluate((element) => getComputedStyle(element).touchAction);
  check('select mode leaves vertical scrolling to the browser', selectTouch === 'pan-y', selectTouch);

  // Find: a bottom sheet over the canvas, not a squeezed toolbar row.
  await page.getByTestId('editor-find-open').tap();
  const findPanel = page.getByTestId('editor-find-panel');
  await findPanel.waitFor({ timeout: 5_000 });
  const findBox = await findPanel.boundingBox();
  check('find opens as a bottom sheet', Boolean(findBox && findBox.width >= 380 && findBox.y > 300), findBox ? `y=${Math.round(findBox.y)}` : 'no box');
  await page.getByTestId('editor-find-query').fill('PDFShush');
  await waitFor(
    async () => {
      const text = await page.getByTestId('editor-find-count').innerText();
      return /match/i.test(text) ? text : null;
    },
    20_000,
    'find result',
  );
  check('find works on a touch viewport', true);
  await page.getByTestId('editor-find-close').tap();

  // Pen: touch-action becomes none, and a second contact is rejected as a palm.
  await page.getByTestId('editor-tool-pen').tap();
  const penTouch = await page.getByTestId('editor-page').first().evaluate((element) => getComputedStyle(element).touchAction);
  check('pen owns the touch gesture', penTouch === 'none', penTouch);

  const pageBox2 = await page.getByTestId('editor-page').first().boundingBox();
  const sx = pageBox2.x + pageBox2.width * 0.25;
  const sy = pageBox2.y + pageBox2.height * 0.35;
  await page.getByTestId('editor-page').first().evaluate(
    (element, coords) => {
      const fire = (type, pointerId, x, y, width = 10) => {
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'touch',
            isPrimary: pointerId === 1,
            clientX: x,
            clientY: y,
            buttons: type === 'pointerup' ? 0 : 1,
            width,
            height: width,
            pressure: 0.5,
          }),
        );
      };
      fire('pointerdown', 1, coords.x, coords.y);
      // A palm lands mid-stroke with a wide contact. It must be ignored.
      fire('pointerdown', 2, coords.x + 40, coords.y + 40, 90);
      fire('pointermove', 2, coords.x + 80, coords.y + 80, 90);
      for (let step = 1; step <= 8; step += 1) {
        fire('pointermove', 1, coords.x + step * 10, coords.y + step * 6);
      }
      fire('pointerup', 1, coords.x + 80, coords.y + 48);
      fire('pointerup', 2, coords.x + 80, coords.y + 80, 90);
    },
    { x: sx, y: sy },
  );
  await page.waitForTimeout(300);
  check(
    'one finger paints one stroke; the palm is ignored',
    (await page.getByTestId('editor-object-ink').count()) === 1,
    `${await page.getByTestId('editor-object-ink').count()} ink object(s)`,
  );

  // Properties: Select the ink object, then open the sheet from the context bar.
  await page.getByTestId('editor-tool-select').tap();
  await page.getByTestId('editor-object-ink').first().tap();
  await page.getByTestId('editor-toggle-inspector').tap();
  await page.getByTestId('editor-inspector').waitFor({ timeout: 5_000 });
  check('properties open as a bottom sheet', await page.getByTestId('editor-inspector').isVisible());
  await page.getByTestId('inspector-close').tap();
  await page.waitForTimeout(200);
  check(
    'properties sheet dismisses without losing the selection',
    !(await page.getByTestId('editor-inspector').isVisible()) &&
      (await page.getByTestId('editor-object-ink').count()) === 1,
  );

  // No horizontal page scrollbar from the mobile chrome.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone chrome has no horizontal overflow', overflow <= 1, `${overflow}px`);
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n=== editor touch e2e: ${failures === 0 ? 'all checks passed' : `${failures} failed`} ===`);
process.exit(failures === 0 ? 0 : 1);
