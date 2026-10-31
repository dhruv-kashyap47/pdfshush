/**
 * Browser E2E for the structured text layer (Phase 1).
 *
 * Drives the Select tool: hover a paragraph, single-click selects its block,
 * double-click opens the inline editor, the commit becomes whiteout + text
 * objects, and the saved file re-parses successfully. This is the overlay path,
 * deliberately separate from `text-edit.mjs` (which proves genuine in-place
 * rewrites through the Text tool).
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/text-model.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from '../../apps/web/node_modules/@cantoo/pdf-lib/es/index.js';
import { extractText, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'text-model');
const ORIGINAL = 'Paragraph edit target';
const REPLACEMENT = 'Paragraph is editable';

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'paragraph.pdf');
  const fixtureDoc = await PDFDocument.create();
  const fixtureFont = await fixtureDoc.embedFont(StandardFonts.Helvetica);
  const fixturePage = fixtureDoc.addPage([595, 842]);
  fixturePage.drawText(ORIGINAL, { x: 72, y: 770, size: 18, font: fixtureFont });
  await writeFile(fixture, await fixtureDoc.save({ useObjectStreams: false }));

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
  const consoleErrors = [];
  const consoleNotes = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') consoleNotes.push(message.text());
    if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, 'editor');

    // The layout is fetched asynchronously; the layer only exists once it lands.
    await waitFor(
      async () => (await page.getByTestId('editor-text-layer').count()) === 1,
      60_000,
      'structured text layer',
    );

    const pageBox = await page.getByTestId('editor-page').first().boundingBox();
    if (!pageBox) throw new Error('page has no box');
    // buildPdf puts 18pt text at x=72, baseline y=770 on a 595x842 page. The
    // overlay is in display points, so derive the line centre from those
    // numbers instead of hard-coded pixels.
    const zoom = pageBox.width / 595;
    const textX = pageBox.x + (72 + 70) * zoom;
    const textY = pageBox.y + 66 * zoom;

    await page.mouse.move(textX, textY);
    const hovered = await waitFor(
      async () => (await page.getByTestId('editor-text-hover-paragraph').count()) === 1,
      10_000,
      'paragraph hover',
    );
    check('hover highlights a paragraph', Boolean(hovered));

    await page.mouse.click(textX, textY);
    await page.waitForTimeout(250);
    check(
      'single click selects the block',
      (await page.getByTestId('editor-text-block-selection').count()) === 1,
    );
    const inspector = await page.getByTestId('editor-text-inspector').innerText();
    check('inspector describes the text block', inspector.includes('Text block'));
    check('inspector previews the paragraph', inspector.includes(ORIGINAL));

    await page.mouse.dblclick(textX, textY, { delay: 60 });
    const input = page.getByTestId('editor-paragraph-input');
    await input.waitFor({ timeout: 10_000 });
    check('double click opens the inline editor', (await input.count()) === 1);
    check('editor is prefilled with the paragraph', (await input.inputValue()) === ORIGINAL);

    await input.fill(REPLACEMENT);
    // Click empty page space to blur/commit (Select keeps paragraph selection).
    await page.mouse.click(pageBox.x + pageBox.width - 30, pageBox.y + pageBox.height - 30);
    await page.waitForTimeout(300);
    check(
      'commit closes the editor',
      (await page.getByTestId('editor-paragraph-input').count()) === 0,
    );
    check(
      'commit creates a text object',
      (await page.getByTestId('editor-object-text').count()) === 1,
    );
    check(
      'commit covers the original line',
      (await page.getByTestId('editor-object-whiteout').count()) === 1,
    );
    const objectText = await page.getByTestId('editor-object-text').first().innerText();
    check('text object holds the replacement', objectText === REPLACEMENT);

    await page.getByTestId('editor-save').click();
    try {
      await page.getByText('-edited.pdf').first().waitFor({ timeout: 90_000 });
    } catch (error) {
      const toasts = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []);
      const status = await page.getByTestId('editor-save-status').innerText().catch(() => '');
      throw new Error(
        `save did not finish: ${toasts.join(' | ') || 'no toast'} / status: ${status} / console: ${consoleErrors.join(' | ')} / notes: ${consoleNotes.join(' | ')}`,
      );
    }

    const toastText = await page.locator('[data-sonner-toast]').allInnerTexts();
    check(
      'save reports a native in-place replacement',
      toastText.some((entry) => entry.includes('replaced in place')),
      toastText.join(' | '),
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const saved = await readFile(await download.path());
    const text = await extractText(saved);
    check('saved file re-parses', saved.byteLength > 0, `${saved.byteLength} bytes`);
    check('saved file contains the replacement', text.includes(REPLACEMENT));
    check(
      'native replacement removed the original glyphs',
      !text.includes(ORIGINAL),
      text.replace(/\s+/g, ' ').slice(0, 160),
    );
    check('no console errors during the run', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await browser.close();
  }

  console.log(
    failures === 0
      ? '\n=== structured text E2E: all checks passed ==='
      : `\n=== structured text E2E: ${failures} failure(s) ===`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
