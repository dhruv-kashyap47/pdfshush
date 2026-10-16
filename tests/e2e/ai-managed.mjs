/**
 * Browser E2E for *managed* mode — the PDFShush trial (Phase 5).
 *
 * The BYOK script (./ai.mjs) proves the tab-to-provider path. This one proves the
 * other path end to end: the browser posts a turn to the PDFShush API, the API
 * streams Server-Sent Events back from a PDFShush-owned key, and the workspace
 * renders the answer. The API is the *shipped* one (routing, request schema,
 * budget, SSE framing, provider adapter) booted by `apps/api/test/support/
 * managed-server.ts` with in-memory counters — no Redis, no Mongo, and the
 * "provider" is the same local mock the BYOK script uses.
 *
 * Flows proven:
 *  1. `/api/tools` advertises the trial, and the workspace's mode toggle offers it.
 *  2. Chat over the trial: grounded answer, page citation.
 *  3. Edit over the trial: a change is proposed from the document text.
 *  4. The browser sends no provider key to our API, and the document text it
 *     does send is the price of the trial (asserted, not implied).
 *
 * Run with the dev server up:  pnpm dev  &&  node tests/e2e/ai-managed.mjs
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf, waitFor } from '../support/e2e-util.mjs';
import { startMockLlm, MOCK_MARK_PHRASE } from '../support/mock-llm.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API_PORT = Number(process.env.AI_API_PORT ?? 8080);
const MOCK_PORT = Number(process.env.AI_MOCK_PORT ?? 8798);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, '..', '..', 'apps', 'api');
const WORK = path.join(HERE, 'artifacts', 'ai-managed');

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/**
 * Boots the managed-API harness and resolves once it is listening. The harness
 * prints a ready line, so the wait is on a fact rather than a timeout.
 */
function startManagedApi({ mockUrl, workDir }) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/support/managed-server.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      WORK_DIR: workDir,
      PEPPER: 'managed-e2e-pepper-0123456789',
      LOG_LEVEL: 'warn',
      AI_MANAGED_PROVIDER: 'openai',
      AI_MANAGED_MODEL: 'mock-model',
      AI_MANAGED_API_KEY: 'mock-key',
      AI_MANAGED_BASE_URL: mockUrl,
      AI_MANAGED_PER_MINUTE: '20',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = [];
  const ready = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) output.push(line.trim());
        if (line.includes('managed-api listening')) resolve();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => output.push(String(chunk).trim()));
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`managed-api exited with ${code}: ${output.join(' | ')}`));
    });
    setTimeout(() => reject(new Error(`managed-api did not start: ${output.join(' | ')}`)), 30_000);
  });

  return {
    ready,
    output,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'report.pdf');
  await writeFile(fixture, buildPdf(MOCK_MARK_PHRASE));

  const workDir = path.join(os.tmpdir(), `pdfshush-managed-e2e-${process.pid}`);
  const mock = await startMockLlm({ port: MOCK_PORT });
  const api = startManagedApi({ mockUrl: mock.url, workDir });
  let browser;
  try {
    await api.ready;

    // `/api/tools` is what the SPA probes; it must advertise the trial.
    const tools = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${API_PORT}/api/tools`);
        const body = await response.json();
        return body?.ai?.enabled ? body : null;
      },
      15_000,
      'managed AI enabled on /api/tools',
    );
    check('the API advertises the managed trial', tools.ai.enabled === true, JSON.stringify(tools.ai));

    browser = await chromium.launch({ channel: 'msedge' });
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const requests = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      // A failed resource load (an anonymous probe, a 401 on /api/auth/me) is
      // network plumbing, not an app error.
      if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
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

    /* ------------------------------------------------ trial mode selection */
    await page.goto(`${BASE}/tools/chat-with-pdf`, { waitUntil: 'networkidle' });

    const trialButton = page.getByTestId('ai-mode-managed');
    await waitFor(
      async () => ((await trialButton.count()) ? true : null),
      20_000,
      'AI settings mode toggle',
    );
    check('the trial is offered once the API advertises it', await trialButton.isEnabled());
    await trialButton.click();

    // The choice is persisted beside the settings, in the same record.
    const storedMode = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('pdfshush.ai', 1);
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('state', 'readonly').objectStore('state').get('ai');
            request.onsuccess = () => {
              db.close();
              resolve(request.result?.mode ?? null);
            };
            request.onerror = () => {
              db.close();
              resolve(null);
            };
          };
        }),
    );
    check('the trial choice is stored with the settings', storedMode === 'managed', String(storedMode));

    /* --------------------------------------------------- chat over the trial */
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
      60_000,
      'managed chat answer',
    );
    check('the trial answers with grounded text', Boolean(answer), answer ?? '');
    check(
      'the answer cites the page it used',
      (await page.getByTestId('ai-citation').first().innerText()).trim().endsWith('p.1'),
    );
    await page.screenshot({ path: path.join(WORK, 'chat.png') }).catch(() => undefined);

    /* ----------------------------------------------------- the wire, checked */
    const chatRequests = requests.filter((entry) => entry.url.includes('/api/ai/chat'));
    check(
      'the turn streams through the PDFShush API',
      chatRequests.length >= 1,
      chatRequests.map((entry) => entry.method).join(', '),
    );
    check(
      'the browser sends no provider key to our API',
      chatRequests.every(
        (entry) =>
          !Object.values(entry.headers).some((value) => /mock-key/i.test(String(value))) &&
          !/mock-key/.test(entry.body),
      ),
    );
    check(
      'managed mode is the path that carries document text to the server',
      chatRequests.some((entry) => entry.body.includes(MOCK_MARK_PHRASE)) ||
        requests.some((entry) => entry.body.includes('read_pages')),
      'page text is sent as read_pages tool output',
    );

    /* ------------------------------------------------- edit over the trial */
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
      90_000,
      'managed pending change',
    );
    const planText = await page.getByTestId('ai-edit-plan').innerText();
    check(
      'the trial proposes a reviewable change',
      /Highlight/.test(planText) && planText.includes(MOCK_MARK_PHRASE),
      planText.replace(/\s+/g, ' ').slice(0, 160),
    );
    await page.screenshot({ path: path.join(WORK, 'edit-pending.png') }).catch(() => undefined);

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await browser?.close().catch(() => undefined);
    await api.stop().catch(() => undefined);
    await mock.close().catch(() => undefined);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  console.log(
    `\n=== managed AI E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('managed AI E2E crashed:', error);
  process.exit(1);
});
