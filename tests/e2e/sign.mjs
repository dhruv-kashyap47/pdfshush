/**
 * End-to-end Fill & Sign test (P6.1, PLAN.md §25.2).
 *
 * Drives the signature slice the way the smoke suite does: real Edge, real
 * worker, real downloaded bytes. One PDF fixture, one drawn signature, and an
 * audit note read back as JSON. Run with the dev server up:
 *
 *   pnpm dev                # terminal 1
 *   node tests/e2e/sign.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');
const FIXTURES = path.join(HERE, 'fixtures');

/* ------------------------------------------------------------- tiny asserts */

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(fn, timeoutMs = 45_000, label = 'condition') {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

/** Drives pen-on-pad: three arcs worth of strokes across the canvas box. */
async function drawStroke(page, locator, fraction = { x: 0.25 }) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const y = box.y + box.height * 0.55;
  await page.mouse.move(box.x + box.width * fraction.x, y);
  await page.mouse.down();
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const x = box.x + box.width * (0.25 + t * 0.5);
    // A lazy sine squiggle: signature enough for ink detection.
    const dy = Math.sin(t * Math.PI * 2) * box.height * 0.18;
    await page.mouse.move(x, y + dy, { steps: 2 });
  }
  await page.mouse.up();
}

/* ------------------------------------------------------------------- main */

async function main() {
  console.log(`E2E: Fill & Sign — ${BASE}`);
  await mkdir(ARTIFACTS, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });

  const fixture = path.join(FIXTURES, 'sign-fixture.pdf');
  await writeFile(fixture, buildPdf('This document may be signed.'));

  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/tools/fill-sign`);
    await page.waitForLoadState('networkidle');

    check(
      'fill-sign is live (dropzone, not planned page)',
      (await page.getByText('In development').count()) === 0 &&
        (await page.locator('input[type="file"]').first().count()) > 0,
    );

    await page.locator('input[type="file"]').first().setInputFiles([fixture]);
    const editor = page.getByTestId('editor');
    await editor.waitFor({ timeout: 30_000 });

    // The signing hat: signature is the opening tool.
    const signatureActive = await page
      .locator('[data-testid="editor-tool-signature"][aria-pressed="true"]')
      .count()
      .then((n) => n > 0);
    check('signature opens as the default tool', signatureActive);

    // Clicking the page opens the pad (the signature tool is default).
    const pageHost = page.getByTestId('editor-page').first();
    const pageBox = await pageHost.boundingBox();
    await page.mouse.click(pageBox.x + 220, pageBox.y + 120);
    const dialog = page.getByTestId('signature-pad-dialog');
    await dialog.waitFor({ timeout: 15_000 });
    check('clicking the page opens the pad dialog', await dialog.isVisible());

    const canvas = page.getByTestId('signature-canvas-draw');
    await canvas.waitFor({ timeout: 10_000 });
    await drawStroke(page, canvas);
    const useEnabled = await waitFor(
      async () => ((await page.getByTestId('signature-use').isEnabled()) ? true : null),
      5_000,
      'Use signature becomes enabled after drawing',
    );
    check('drawing enables "Use signature"', useEnabled === true);

    // Saved-assets strip after persistence: use "Save for later", then place.
    await page.getByTestId('signature-save-copy').click();
    const strip = page.getByTestId('signature-asset-strip');
    check(
      'saving puts the asset in the device strip',
      await waitFor(async () => ((await strip.count()) ? true : null), 5_000, 'strip appears'),
    );

    await page.getByTestId('signature-use').click();
    const placed = await waitFor(
      async () => {
        const n = await page.locator('[data-testid="editor-object-image"]').count();
        return n === 1 ? n : null;
      },
      15_000,
      'signature object appears in the editor',
    );
    check('the signature is placed on the page', placed === 1, `${placed} object`);

    // Signer label + export with the audit note.
    await page.getByTestId('signer-label-input').fill('J. R. Smith');
    await page.getByRole('button', { name: 'Sign & export' }).click();
    await waitFor(
      async () => ((await page.getByRole('button', { name: 'Download' }).count()) > 0 ? true : null),
      60_000,
      'result panel after sign & export',
    );

    const export3 = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const downloaded = await export3;
    const filePath = await downloaded.path();
    const bytes = await readFile(filePath);
    check('signed export is a valid PDF', bytes.subarray(0, 5).toString('latin1') === '%PDF-');
    check('signed export is named `-signed.pdf`', downloaded.suggestedFilename().endsWith('-signed.pdf'), downloaded.suggestedFilename());

    // The audit-note button lives on the result panel.
    const auditButton = page.getByTestId('download-audit-note');
    await auditButton.waitFor({ timeout: 15_000 });
    const auditEnabled = await auditButton.isEnabled();
    check('the audit-note download is offered', auditEnabled);
    if (auditEnabled) {
      const [auditDownload] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        auditButton.click(),
      ]);
      const auditPath = await auditDownload.path();
      const auditBytes = await readFile(auditPath);
      const audit = JSON.parse(auditBytes.toString('utf8'));
      check('audit note name is `<stem>-audit.json`', auditDownload.suggestedFilename().endsWith('-audit.json'), auditDownload.suggestedFilename());
      check('audit schema pins pdfshush.audit-trail/1', audit.schema === 'pdfshush.audit-trail/1');
      check('audit records the signer label', audit.signed?.signerLabel === 'J. R. Smith');
      check('audit records one placement', audit.signed?.placements?.length === 1, `${audit.signed?.placements?.length}`);
      check('audit digests are sha-256 hex', typeof audit.source?.digest === 'string' && /^[0-9a-f]{64}$/.test(audit.source.digest) && /^[0-9a-f]{64}$/.test(audit.output?.digest ?? ''));
      check('audit attests honestly (never certified)', audit.attestation?.certified === false);
    }

    await page.goto(`${BASE}/tools/signature`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('signature-new').click();
    const manageDialog = page.getByTestId('signature-pad-dialog');
    await manageDialog.waitFor({ timeout: 15_000 });
    const manageCanvas = page.getByTestId('signature-canvas-draw');
    await drawStroke(page, manageCanvas, { x: 0.3 });
    await page.getByTestId('signature-save-primary').click();
    await page.keyboard.press('Escape');
    await waitFor(
      async () => ((await manageDialog.count()) === 0 ? true : null),
      8_000,
      'manage dialog closed after save',
    );
    const cardCount = await waitFor(
      async () => {
        const n = await page.locator('[data-testid^="signature-manage-"]').count();
        return n === 1 ? n : null;
      },
      8_000,
      'saved asset card',
    );
    check('the manage page saves a signature', cardCount === 1);
    // Two assets exist at this point (one from the editor flow, one from here);
    // delete unwraps to a single card, not zero.
    await page.locator('[data-testid="signature-delete"]').first().click();
    const afterDelete = await waitFor(
      async () => {
        const n = await page.locator('[data-testid^="signature-manage-"]').count();
        return n === 1 ? true : null;
      },
      8_000,
      'asset deleted',
    );
    check('the manage page deletes a signature', afterDelete === true);
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.error(`\nP6.1 sign e2e: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nP6.1 sign e2e: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
