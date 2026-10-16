/**
 * Browser E2E for the AI tools (Phase 5).
 *
 * Runs the real client stack — AI settings, the PDF skills, the agent loop and
 * the editing engine — against a local mock provider that speaks the
 * OpenAI-compatible SSE protocol. No API key and no network egress are needed.
 *
 * Four flows are proven end to end:
 *  1. Chat with PDF: ask a question, get an answer grounded in the page text.
 *  2. Edit PDF with AI: ask for a highlight, review the queued change, apply it,
 *     and download a valid PDF that still carries the text.
 *  3. Replace with AI: ask for a replacement and prove from the downloaded bytes
 *     that the document's *own* run was rewritten — the original words are gone,
 *     not merely covered.
 *  4. Security: the key is migrated out of localStorage into IndexedDB, is sent
 *     only to the provider, and BYOK never touches the managed endpoint.
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/ai.mjs
 * (`pnpm test:e2e:ai` starts nothing — point E2E_BASE_URL at a running app.)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf, extractText, waitFor } from '../support/e2e-util.mjs';
import {
  startMockLlm,
  MOCK_MARK_PHRASE,
  MOCK_REPLACE_PHRASE,
} from '../support/mock-llm.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const MOCK_PORT = Number(process.env.AI_MOCK_PORT ?? 8799);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'ai');

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/**
 * Console noise the app produces when the optional API is not running: the
 * managed-trial capability probe (`/api/tools`) fails through the dev proxy and
 * the browser logs the failed resource. That is the designed offline posture,
 * not an app error.
 */
function isIgnorableConsole(text) {
  return /\/api\/|ERR_CONNECTION|ERR_FAILED|net::|Failed to load resource/i.test(text);
}

/** The IndexedDB record the app writes, read from inside the page. */
async function readStoredAiState(page) {
  return page.evaluate(async () => {
    const record = await new Promise((resolve) => {
      const open = indexedDB.open('pdfshush.ai', 1);
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('state', 'readonly').objectStore('state').get('ai');
        request.onsuccess = () => {
          db.close();
          resolve(request.result ?? null);
        };
        request.onerror = () => {
          db.close();
          resolve(null);
        };
      };
    });
    return {
      legacySettings: localStorage.getItem('pdfshush.ai.settings.v1'),
      legacyMode: localStorage.getItem('pdfshush.ai.mode.v1'),
      record,
    };
  });
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'report.pdf');
  await writeFile(fixture, buildPdf(MOCK_MARK_PHRASE));

  const mock = await startMockLlm({ port: MOCK_PORT });
  const mockOrigin = new URL(mock.url).origin;
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  /** Every request the app makes, for the "where did the key go" checks. */
  const requests = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnorableConsole(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? '',
    }),
  );

  // BYOK settings seeded in the *legacy* localStorage form, so the run also
  // proves the migration into IndexedDB. The key is a placeholder.
  await page.addInitScript(
    (settings) => {
      localStorage.setItem('pdfshush.ai.settings.v1', JSON.stringify(settings));
      localStorage.setItem('pdfshush.ai.mode.v1', 'byok');
    },
    {
      provider: 'openai',
      providers: {
        openai: { apiKey: 'mock-key', model: 'mock-model', baseUrl: mock.url },
      },
    },
  );

  try {
    /* -------------------------------------------------------- chat with PDF */
    await page.goto(`${BASE}/tools/chat-with-pdf`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    const chatBox = await waitFor(
      async () => {
        const box = page.getByTestId('ai-composer');
        return (await box.count()) ? box : null;
      },
      30_000,
      'chat input',
    );
    await chatBox.fill('What is this document about?');
    await chatBox.press('Enter');

    const answer = await waitFor(
      async () => {
        const node = page.getByTestId('ai-message-assistant').first();
        if (!(await node.count())) return null;
        const text = await node.innerText();
        return text.includes(MOCK_MARK_PHRASE) ? text : null;
      },
      45_000,
      'chat answer',
    );
    check('chat answers with grounded text', Boolean(answer), answer ?? '');

    const citation = page.getByTestId('ai-citation').first();
    const citationText = (await citation.count()) ? await citation.innerText() : '';
    check('the answer cites the page it used', /p\.1$/.test(citationText.trim()), citationText);

    await page.screenshot({ path: path.join(WORK, 'chat.png') }).catch(() => undefined);

    /* ------------------------------------------------------------ security */
    const stored = await readStoredAiState(page);
    check(
      'the key is migrated out of localStorage',
      stored.legacySettings === null && stored.legacyMode === null,
      JSON.stringify({ settings: stored.legacySettings, mode: stored.legacyMode }),
    );
    check(
      'the settings (key included) live in IndexedDB',
      stored.record?.settings?.providers?.openai?.apiKey === 'mock-key' &&
        stored.record?.mode === 'byok',
      JSON.stringify(stored.record?.settings?.providers?.openai ?? null),
    );

    const strays = requests.filter((entry) => {
      const carries =
        /mock-key/.test(entry.url) ||
        /mock-key/.test(entry.body) ||
        Object.values(entry.headers).some((value) => String(value).includes('mock-key'));
      return carries && !entry.url.startsWith(mockOrigin);
    });
    check(
      'the key is sent only to the provider',
      strays.length === 0,
      strays.map((entry) => entry.method + ' ' + entry.url).join(' | '),
    );
    check(
      'BYOK never calls the managed endpoint',
      requests.every((entry) => !entry.url.includes('/api/ai/chat')),
      requests.map((entry) => entry.url).filter((url) => url.includes('/api/ai/chat')).join(' | '),
    );

    /* --------------------------------------------------- edit PDF with AI */
    await page.goto(`${BASE}/tools/edit-pdf-with-ai`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    const editBox = await waitFor(
      async () => {
        const box = page.getByTestId('ai-composer');
        return (await box.count()) ? box : null;
      },
      30_000,
      'edit input',
    );
    await editBox.fill(`Highlight the phrase ${MOCK_MARK_PHRASE}.`);
    await editBox.press('Enter');

    const apply = page.getByTestId('ai-edit-apply');
    await waitFor(
      async () => ((await apply.count()) && !(await apply.isDisabled()) ? true : null),
      60_000,
      'pending edit + apply button',
    );
    const applyLabel = await apply.innerText();
    check('a pending change is queued for review', /Apply 1 change/.test(applyLabel), applyLabel);

    const planText = await page.getByTestId('ai-edit-plan').innerText();
    check(
      'the review panel names the queued highlight',
      /Highlight/.test(planText) && planText.includes(MOCK_MARK_PHRASE),
      planText.replace(/\s+/g, ' ').slice(0, 160),
    );
    check(
      'the changed page is marked on the page rail',
      (await page.getByTestId('ai-changed-page').count()) >= 1,
    );
    await page.screenshot({ path: path.join(WORK, 'edit-pending.png') }).catch(() => undefined);

    await apply.click();
    await page.getByText('-edited.pdf').first().waitFor({ timeout: 90_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const bytes = await readFile(await download.path());
    check('applied document is a valid PDF', bytes.subarray(0, 5).toString('latin1') === '%PDF-');

    const text = await extractText(bytes);
    check('the marked text survives the edit', text.includes(MOCK_MARK_PHRASE), text.trim());
    await page.screenshot({ path: path.join(WORK, 'edit-result.png') }).catch(() => undefined);

    /* -------------------------------------------------------- replace text */
    await page.goto(`${BASE}/tools/edit-pdf-with-ai`, { waitUntil: 'networkidle' });
    await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
    const replaceBox = await waitFor(
      async () => {
        const box = page.getByTestId('ai-composer');
        return (await box.count()) ? box : null;
      },
      30_000,
      'replace input',
    );
    await replaceBox.fill(
      `Replace the phrase ${MOCK_MARK_PHRASE} on page 1 with "${MOCK_REPLACE_PHRASE}".`,
    );
    await replaceBox.press('Enter');

    const replaceApply = page.getByTestId('ai-edit-apply');
    await waitFor(
      async () => ((await replaceApply.count()) && !(await replaceApply.isDisabled()) ? true : null),
      60_000,
      'pending replace + apply button',
    );
    const replacePlan = await page.getByTestId('ai-edit-plan').innerText();
    check(
      'the review panel names the queued replacement',
      /Replace text/.test(replacePlan) && replacePlan.includes(MOCK_MARK_PHRASE),
      replacePlan.replace(/\s+/g, ' ').slice(0, 160),
    );
    await page.screenshot({ path: path.join(WORK, 'replace-pending.png') }).catch(() => undefined);

    await replaceApply.click();
    await page.getByText('-edited.pdf').first().waitFor({ timeout: 120_000 });

    const [replaceDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    const replacedBytes = await readFile(await replaceDownload.path());
    check(
      'the rewritten document is a valid PDF',
      replacedBytes.subarray(0, 5).toString('latin1') === '%PDF-',
    );

    const replacedText = await extractText(replacedBytes);
    check(
      'the replacement is present in the exported PDF',
      replacedText.includes(MOCK_REPLACE_PHRASE),
      replacedText.trim(),
    );
    check(
      'the original run is gone, not covered',
      !replacedText.includes(MOCK_MARK_PHRASE),
      replacedText.trim(),
    );
    await page
      .screenshot({ path: path.join(WORK, 'replace-result.png') })
      .catch(() => undefined);

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await page.screenshot({ path: path.join(WORK, 'last.png') }).catch(() => undefined);
    await browser.close();
    await mock.close();
  }

  console.log(`\n=== AI E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('AI E2E crashed:', error);
  process.exit(1);
});
