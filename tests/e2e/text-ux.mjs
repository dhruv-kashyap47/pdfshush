/**
 * Sprint 3 browser E2E: text UX, revert/move/formatting, find & replace and
 * draft recovery.
 *
 * Every assertion is made from the downloaded PDF, not from the preview:
 * replaced text must be present/absent, a moved paragraph must change its text
 * origin, and a restored draft must survive a reload and the first undo.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/text-ux.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from '../../apps/web/node_modules/@cantoo/pdf-lib/es/index.js';
import { extractText, extractTextItems, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'text-ux');

let failures = 0;
let checks = 0;
function check(name, condition, detail = '') {
  checks += 1;
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function writeFixture(name, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = doc.addPage([595, 842]);
    for (const item of items) {
      page.drawText(item.text, { x: item.x ?? 72, y: item.y ?? 770, size: item.size ?? 18, font });
    }
  }
  const file = path.join(WORK, name);
  await writeFile(file, await doc.save({ useObjectStreams: false }));
  return file;
}

async function openEditor(page, fixture) {
  await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor');
  await waitFor(
    async () => (await page.getByTestId('editor-text-layer').count()) > 0,
    60_000,
    'text layer',
  );
}

/** Point inside the first detected paragraph, in CSS pixels. */
async function paragraphPoint(page) {
  const pageBox = await page.getByTestId('editor-page').first().boundingBox();
  if (!pageBox) throw new Error('page has no box');
  const zoom = pageBox.width / 595;
  await page.mouse.move(pageBox.x + 130 * zoom, pageBox.y + 62 * zoom);
  const hover = await waitFor(
    async () => {
      const element = page.getByTestId('editor-text-hover-paragraph').first();
      if ((await element.count()) === 0) return null;
      const box = await element.boundingBox();
      return box && box.width > 0 ? box : null;
    },
    15_000,
    'paragraph hover box',
  );
  return { point: { x: hover.x + hover.width / 2, y: hover.y + hover.height / 2 }, pageBox, zoom };
}

async function commitParagraph(page, replacement) {
  const { point } = await paragraphPoint(page);
  await page.mouse.dblclick(point.x, point.y, { delay: 60 });
  const input = page.getByTestId('editor-paragraph-input');
  await input.waitFor({ timeout: 15_000 });
  await input.fill(replacement);
  const pageBox = await page.getByTestId('editor-page').first().boundingBox();
  await page.mouse.click(pageBox.x + pageBox.width - 30, pageBox.y + pageBox.height - 30);
  await waitFor(
    async () => (await page.getByTestId('editor-paragraph-input').count()) === 0,
    10_000,
    'paragraph commit',
  );
}

async function downloadSaved(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);
  return readFile(await download.path());
}

async function saveAndDownload(page) {
  await page.getByTestId('editor-save').click();
  await waitFor(
    async () => (await page.getByText('-edited.pdf').count()) > 0,
    90_000,
    'saved result',
  );
  return downloadSaved(page);
}

async function revertScenario(browser) {
  const fixture = await writeFixture('revert.pdf', [[{ text: 'Original paragraph text' }]]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await commitParagraph(page, 'Replacement paragraph text');
    check(
      'edit created one replacement object',
      (await page.getByTestId('editor-object-text').count()) === 1,
    );

    // The block inspector stays selected after a commit; the details drawer is
    // reachable from it and is where Revert lives.
    await page.getByTestId('editor-paragraph-details-open').click();
    await page.getByTestId('editor-paragraph-details').waitFor({ timeout: 10_000 });
    const details = await page.getByTestId('editor-paragraph-details').innerText();
    check('detection details name the page', details.includes('Page'), details.split('\n')[0]);
    check('detection details report confidence', /\d+%/.test(details));
    check('detection details report the text layer', /text layer/i.test(details));
    check('detection details offer a copy action', (await page.getByTestId('editor-paragraph-details-copy').count()) === 1);

    await page.getByTestId('editor-paragraph-details-revert').click();
    await waitFor(
      async () => (await page.getByTestId('editor-object-text').count()) === 0,
      10_000,
      'objects removed by revert',
    );
    check(
      'revert also removes the covers',
      (await page.getByTestId('editor-object-whiteout').count()) === 0,
    );

    const saved = await saveAndDownload(page);
    const text = await extractText(saved);
    check('reverted export still contains the original', text.includes('Original paragraph text'), text.trim());
    check('reverted export no longer contains the replacement', !text.includes('Replacement paragraph text'));
  } finally {
    await page.close();
  }
}

async function moveScenario(browser) {
  const fixture = await writeFixture('move.pdf', [[{ text: 'Move me across the page' }]]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await commitParagraph(page, 'Moved paragraph text');
    const object = page.getByTestId('editor-object-text').first();
    const before = await object.boundingBox();
    if (!before) throw new Error('replacement has no box');
    const pageBox = await page.getByTestId('editor-page').first().boundingBox();
    const zoom = pageBox.width / 595;
    const dx = 70 * zoom;
    const dy = 55 * zoom;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + dx, before.y + before.height / 2 + dy, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await object.boundingBox();
    const attrs = await object.evaluate((element) => ({
      objectX: Number(element.getAttribute('data-object-x')),
      nativeX: Number(element.getAttribute('data-native-x')),
      objectY: Number(element.getAttribute('data-object-y')),
      nativeBaseline: Number(element.getAttribute('data-native-baseline')),
    }));
    check(
      'dragging moves the replacement on screen',
      Boolean(after && after.x > before.x + dx * 0.5 && after.y > before.y + dy * 0.5),
      after ? `${Math.round(after.x - before.x)}, ${Math.round(after.y - before.y)} px` : 'missing',
    );
    check(
      'native reflow origin tracks the object',
      Number.isFinite(attrs.nativeX) && Math.abs(attrs.nativeX - attrs.objectX) < 1,
      JSON.stringify(attrs),
    );

    const saved = await saveAndDownload(page);
    const text = await extractText(saved);
    check('moved replacement survives the export', text.includes('Moved paragraph text'), text.trim());
    const items = await extractTextItems(saved);
    const moved = items.find((item) => item.text.includes('Moved paragraph text'));
    check('moved paragraph exists in the PDF text layer', Boolean(moved));
    if (moved) {
      const originalX = 72;
      check(
        'native reflow follows the move (x origin moved right)',
        moved.x > originalX + 20,
        `x=${moved.x.toFixed(1)} (was ${originalX})`,
      );
      check(
        'native reflow follows the move (baseline moved down)',
        moved.y < 770 - 20,
        `y=${moved.y.toFixed(1)} (was 770)`,
      );
    }
  } finally {
    await page.close();
  }
}

async function formattingScenario(browser) {
  const fixture = await writeFixture('format.pdf', [[{ text: 'Format this paragraph' }]]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await commitParagraph(page, 'Styled paragraph text');

    // Select the replacement object and apply a style that differs from the
    // document's own. The object sits above the (covered) original.
    const object = page.getByTestId('editor-object-text').first();
    const box = await object.boundingBox();
    if (!box) throw new Error('replacement has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('editor-inspector').waitFor({ timeout: 10_000 });
    const size = page.getByTestId('inspector-font-size');
    await size.fill('24');
    await size.press('Enter');
    await page.getByTestId('inspector-bold').click();
    await page.getByTestId('inspector-swatch-#ef4444').click();
    await waitFor(
      async () => (await page.getByTestId('inspector-native-style-note').count()) === 1,
      10_000,
      'honest native-style note',
    );
    check('inspector says styled paragraph exports as an overlay', true);

    await page.getByTestId('editor-save').click();
    await waitFor(
      async () => (await page.getByText('-edited.pdf').count()) > 0,
      90_000,
      'styled saved result',
    );
    const toast = await page.locator('[data-sonner-toast]').allInnerTexts();
    check(
      'save reports the styled edit as an overlay',
      toast.some((entry) => /drawn as an overlay/i.test(entry)),
      toast.join(' | '),
    );
    const receipt = await page.getByTestId('edit-receipt').innerText();
    check('receipt names the overlay', /Drawn over the original/i.test(receipt), receipt.slice(0, 180));
    check('receipt warns the original remains', /Original text remains/i.test(receipt));

    const saved = await downloadSaved(page);
    const text = await extractText(saved);
    check('styled replacement text is present', text.includes('Styled paragraph text'), text.trim());
  } finally {
    await page.close();
  }
}

async function findReplaceScenario(browser) {
  const fixture = await writeFixture('find.pdf', [
    [{ text: 'alpha beta' }],
    [{ text: 'alpha gamma' }],
  ]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await page.keyboard.press('Control+f');
    const panel = page.getByTestId('editor-find-panel');
    await panel.waitFor({ timeout: 10_000 });
    await page.getByTestId('editor-find-query').fill('alpha');
    await waitFor(
      async () => {
        const text = await page.getByTestId('editor-find-count').innerText();
        return /of 2 matches/i.test(text);
      },
      30_000,
      'two matches across two pages',
    );
    check('find counts matches across pages', true);
    check(
      'find highlights the active match',
      (await page.getByTestId('editor-text-selection').count()) >= 1,
    );

    await page.getByTestId('editor-find-next').click();
    const second = await page.getByTestId('editor-find-count').innerText();
    check('next moves to the second match', /2 of 2 matches/i.test(second), second);

    // Case and whole-word toggles are real options, not decoration.
    await page.getByTestId('editor-find-case').click();
    await page.waitForTimeout(400);
    check(
      'case-sensitive search keeps the same lowercase matches',
      /of 2 matches/i.test(await page.getByTestId('editor-find-count').innerText()),
    );
    await page.getByTestId('editor-find-case').click();
    await page.waitForTimeout(400);

    await page.getByTestId('editor-find-replace').fill('omega');
    await page.getByTestId('editor-find-replace-all').click();
    await waitFor(
      async () => (await page.getByTestId('editor-find-count').innerText()).includes('No matches'),
      30_000,
      'post-replace search refresh',
    );
    check('replace-all updates the search list', true);
    await page.getByTestId('editor-find-close').click();

    const saved = await saveAndDownload(page);
    const text = await extractText(saved);
    check('both replacements are in the export', (text.match(/omega/g) ?? []).length === 2, text.trim());
    check('no query text remains in the export', !text.includes('alpha'));
  } finally {
    await page.close();
  }
}

async function legibilityScenario(browser) {
  const fixture = await writeFixture('legibility.pdf', [[{ text: 'Preview the page while typing' }]]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const difference = async (clip, before, after) =>
    page.evaluate(
      async ({ before, after }) => {
        const load = async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height);
        };
        const first = await load(before);
        const second = await load(after);
        if (first.width !== second.width || first.height !== second.height) {
          return { mean: 255, changed: 1 };
        }
        const { width, height } = first;
        let best = { mean: 255, changed: 1 };
        // The textarea and the committed text object share the same metrics, but
        // browsers can land a baseline one device pixel apart. Comparing the
        // best 3x3 sub-pixel alignment keeps that from being reported as a real
        // visual difference while still catching a font, colour or offset change.
        for (let shiftX = -1; shiftX <= 1; shiftX += 1) {
          for (let shiftY = -1; shiftY <= 1; shiftY += 1) {
            let sum = 0;
            let changed = 0;
            let pixels = 0;
            for (let y = 1; y < height - 1; y += 1) {
              const otherY = y + shiftY;
              if (otherY < 0 || otherY >= height) continue;
              for (let x = 1; x < width - 1; x += 1) {
                const otherX = x + shiftX;
                if (otherX < 0 || otherX >= width) continue;
                const a = (y * width + x) * 4;
                const b = (otherY * width + otherX) * 4;
                const delta =
                  (Math.abs(first.data[a] - second.data[b]) +
                    Math.abs(first.data[a + 1] - second.data[b + 1]) +
                    Math.abs(first.data[a + 2] - second.data[b + 2])) /
                  3;
                sum += delta;
                if (delta > 24) changed += 1;
                pixels += 1;
              }
            }
            const mean = sum / Math.max(1, pixels);
            if (mean < best.mean) best = { mean, changed: changed / Math.max(1, pixels) };
          }
        }
        return best;
      },
      { before: before.toString('base64'), after: after.toString('base64') },
    );
  const setZoom = async (percent) => {
    const input = page.getByTestId('editor-zoom-level');
    await input.fill(String(percent));
    await input.press('Enter');
    await page.waitForTimeout(500);
  };
  try {
    await openEditor(page, fixture);
    await setZoom(100);
    const point = await paragraphPoint(page);
    await page.mouse.dblclick(point.point.x, point.point.y, { delay: 60 });
    const input = page.getByTestId('editor-paragraph-input');
    await input.waitFor({ timeout: 15_000 });
    await input.fill('Editing looks like the page');
    await input.press('End');

    check(
      'the original lines are masked while editing',
      (await page.getByTestId('editor-paragraph-cover').count()) > 0,
    );
    const styles = await input.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, caret: computed.caretColor };
    });
    check('the inline editor is transparent over the page', styles.background === 'rgba(0, 0, 0, 0)', styles.background);
    check('the inline editor has a visible caret colour', styles.caret !== 'rgba(0, 0, 0, 0)', styles.caret);

    const box = await input.boundingBox();
    if (!box) throw new Error('inline editor has no box');
    const clip = {
      x: box.x + 4,
      y: box.y + 4,
      width: Math.max(1, box.width - 8),
      height: Math.max(1, box.height - 8),
    };
    const during = await page.screenshot({ clip });
    await writeFile(path.join(WORK, 'legibility-during.png'), during);

    const pageBox = await page.getByTestId('editor-page').first().boundingBox();
    await page.mouse.click(pageBox.x + pageBox.width - 30, pageBox.y + pageBox.height - 30);
    await waitFor(
      async () => (await page.getByTestId('editor-object-text').count()) === 1,
      10_000,
      'committed replacement',
    );
    const after = await page.screenshot({ clip });
    await writeFile(path.join(WORK, 'legibility-after.png'), after);
    const diff = await difference(clip, during, after);
    check(
      'the editing surface matches the committed page at 100%',
      diff.mean < 12 && diff.changed < 0.3,
      `mean ${diff.mean.toFixed(1)}, changed ${(diff.changed * 100).toFixed(1)}%`,
    );

    // 400%: the same layer must mask and edit without losing its position.
    await page.reload({ waitUntil: 'networkidle' });
    await openEditor(page, fixture);
    await setZoom(400);
    await page.getByTestId('editor-scroll').evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await page.waitForTimeout(500);
    const layer = await page.getByTestId('editor-text-layer').first().boundingBox();
    if (!layer) throw new Error('text layer has no box at 400%');
    await page.mouse.dblclick(layer.x + 100 * 4, layer.y + 66 * 4, { delay: 60 });
    const zoomedInput = page.getByTestId('editor-paragraph-input');
    await zoomedInput.waitFor({ timeout: 15_000 });
    check(
      'the paragraph editor exists at 400%',
      (await zoomedInput.count()) === 1,
    );
    check(
      'the 400% editor still masks the original lines',
      (await page.getByTestId('editor-paragraph-cover').count()) > 0,
    );
    const zoomedStyle = await zoomedInput.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { background: computed.backgroundColor, height: element.getBoundingClientRect().height };
    });
    check('the 400% editor stays transparent', zoomedStyle.background === 'rgba(0, 0, 0, 0)');
    check('the 400% editor has a usable height', zoomedStyle.height > 40, `${zoomedStyle.height.toFixed(0)} px`);
    await zoomedInput.press('Escape');
    await waitFor(
      async () => (await page.getByTestId('editor-paragraph-input').count()) === 0,
      10_000,
      '400% editor closed',
    );
    check('Escape closes the 400% editor without committing', true);
  } finally {
    await page.close();
  }
}

async function find40Scenario(browser) {
  const pages = Array.from({ length: 40 }, (_, index) => [
    { text: `page ${index + 1} needle`, x: 72, y: 770, size: 16 },
  ]);
  const fixture = await writeFixture('find-40.pdf', pages);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await page.keyboard.press('Control+f');
    await page.getByTestId('editor-find-panel').waitFor({ timeout: 10_000 });
    const started = Date.now();
    await page.getByTestId('editor-find-query').fill('needle');
    await waitFor(
      async () => /of 40 matches/i.test(await page.getByTestId('editor-find-count').innerText()),
      60_000,
      '40-page search',
    );
    const elapsed = Date.now() - started;
    check('find searches 40 pages', true, `${elapsed} ms`);
    check('find 40 pages stays inside 30 s', elapsed < 30_000, `${elapsed} ms`);
    await page.getByTestId('editor-find-result').nth(39).click();
    check(
      'jumping to the last result selects it',
      /40 of 40 matches/i.test(await page.getByTestId('editor-find-count').innerText()),
    );
  } finally {
    await page.close();
  }
}

async function draftScenario(browser) {
  const fixture = await writeFixture('draft.pdf', [[{ text: 'Draft me now' }]]);
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  try {
    await openEditor(page, fixture);
    await commitParagraph(page, 'Draft is restored');
    await waitFor(
      async () =>
        (await page.getByTestId('editor-draft-saved').innerText()).includes('Draft saved'),
      20_000,
      'autosave',
    );
    check('autosave reports a saved draft', true);

    await page.reload({ waitUntil: 'networkidle' });
    const banner = page.getByTestId('editor-draft-banner');
    await banner.waitFor({ timeout: 20_000 });
    const meta = await page.getByTestId('editor-draft-meta').innerText();
    check('reload offers the draft for the same file', meta.includes('draft.pdf'), meta);
    await page.getByTestId('editor-draft-restore').click();
    await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'restored editor');
    await waitFor(
      async () => (await page.getByTestId('editor-object-text').count()) === 1,
      20_000,
      'restored replacement object',
    );
    check('restore hydrates the overlay object', true);
    const restoredText = await page.getByTestId('editor-object-text').first().innerText();
    check('restore keeps the exact text', restoredText === 'Draft is restored', restoredText);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    check(
      'the first undo does not erase the restored draft',
      (await page.getByTestId('editor-object-text').count()) === 1,
    );

    // Let the restored session autosave again, reload, then discard it.
    await waitFor(
      async () =>
        (await page.getByTestId('editor-draft-saved').innerText()).includes('Draft saved'),
      20_000,
      'restored autosave',
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('editor-draft-banner').waitFor({ timeout: 20_000 });
    await page.getByTestId('editor-draft-discard').click();
    await waitFor(
      async () => (await page.getByTestId('editor-draft-banner').count()) === 0,
      10_000,
      'banner dismissed',
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    check(
      'discard clears the draft across reloads',
      (await page.getByTestId('editor-draft-banner').count()) === 0,
    );
  } finally {
    await page.close();
  }
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const only = process.env.TEXT_UX_ONLY?.split(',').map((entry) => entry.trim()).filter(Boolean);
  const want = (name) => !only || only.includes(name);
  const browser = await chromium.launch(process.env.CI ? {} : { channel: 'msedge' });
  try {
    if (want('revert')) {
      console.log('\n-- revert (T-01) --');
      await revertScenario(browser);
    }
    if (want('move')) {
      console.log('\n-- move (T-02) --');
      await moveScenario(browser);
    }
    if (want('format')) {
      console.log('\n-- formatting (T-06 UI half) --');
      await formattingScenario(browser);
    }
    if (want('find')) {
      console.log('\n-- find & replace (S-01/S-02) --');
      await findReplaceScenario(browser);
    }
    if (want('find40')) {
      console.log('\n-- find across 40 pages --');
      await find40Scenario(browser);
    }
    if (want('legibility') || want('text-ux')) {
      console.log('\n-- inline editing legibility (T-05) --');
      await legibilityScenario(browser);
    }
    if (want('draft')) {
      console.log('\n-- draft autosave/restore (S-03/S-04) --');
      await draftScenario(browser);
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\n=== text UX E2E: ${failures === 0 ? `all ${checks} checks passed` : `${failures} of ${checks} FAILED`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('text UX E2E crashed:', error);
  process.exit(1);
});
