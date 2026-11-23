/**
 * Rail-entry smoke (E-10).
 *
 * The registry is the single source of the tool rail. This suite reads that
 * registry from source and then proves the running editor agrees with it in
 * every workspace: the same tools appear, in the same order, each one arms
 * itself and shows its own contextual copy. A tool that was added to the
 * registry but wired to nothing fails here instead of shipping as a dead
 * button.
 *
 * Run with the dev server up (or point E2E_BASE_URL at a preview build):
 *   pnpm dev && node tests/e2e/editor-rail.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPdf, waitFor } from '../support/e2e-util.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'artifacts', 'editor-rail');
const REGISTRY = path.join(HERE, '..', '..', 'apps', 'web', 'src', 'lib', 'editor-tools.ts');
const MODES = ['edit', 'sign', 'ai', 'redact', 'organize'];
const GROUP_ORDER = ['edit', 'insert', 'markup', 'shape'];
const NO_COPY = /\bundefined\b|\[object Object\]/i;

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!condition) failures += 1;
}

/** Reads the registry without importing React or lucide. */
async function readRegistry() {
  const source = await readFile(REGISTRY, 'utf8');
  const defsBlock = source.slice(
    source.indexOf('export const EDITOR_TOOL_DEFS'),
    source.indexOf('\n];', source.indexOf('export const EDITOR_TOOL_DEFS')),
  );
  const idMatches = [...defsBlock.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)];
  const tools = [];
  for (let index = 0; index < idMatches.length; index += 1) {
    const start = idMatches[index].index;
    const end = idMatches[index + 1]?.index ?? defsBlock.length;
    const body = defsBlock.slice(start, end);
    const modes = /modes:\s*\[([^\]]*)\]/.exec(body)?.[1];
    const group = /group:\s*'([a-z]+)'/.exec(body)?.[1] ?? 'edit';
    tools.push({
      id: idMatches[index][1],
      group,
      modes: modes
        ? [...modes.matchAll(/'([a-z-]+)'/g)].map((match) => match[1])
        : MODES,
    });
  }
  const helpBlock = source.slice(
    source.indexOf('export const TOOL_HELP'),
    source.indexOf('\n};', source.indexOf('export const TOOL_HELP')),
  );
  const help = Object.fromEntries(
    [...helpBlock.matchAll(/^ {2}([a-z0-9-]+):\s*(['"])(.*)\2,?$/gm)].map((match) => [
      match[1],
      match[3],
    ]),
  );
  // The rail renders group by group; registry order is the order inside a group.
  const expected = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      GROUP_ORDER.flatMap((group) =>
        tools
          .filter((tool) => tool.group === group && tool.modes.includes(mode))
          .map((tool) => tool.id),
      ),
    ]),
  );
  return { tools, expected, help };
}

async function upload(page, fixture, label) {
  await page.locator('input[accept*="application/pdf"]').setInputFiles([fixture]);
  await waitFor(async () => (await page.getByTestId('editor').count()) === 1, 60_000, label);
}

async function exerciseRail(page, mode, expected, help) {
  if (mode !== 'sign') {
    await page.getByTestId(`editor-mode-${mode}`).click();
    // The assistant workspace may open its first-run welcome overlay; dismiss
    // it so the rail underneath is the thing under test.
    if ((await page.getByTestId('ai-welcome').count()) > 0) {
      await page.keyboard.press('Escape');
      await page
        .getByTestId('ai-welcome')
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => undefined);
    }
  }
  await waitFor(
    async () => (await page.getByTestId('editor-toolbar').count()) === 1,
    30_000,
    `${mode} rail`,
  );
  const ids = await page
    .locator('[data-testid^="editor-tool-"][data-tool]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tool')));
  check(
    `${mode} rail matches the registry`,
    JSON.stringify(ids) === JSON.stringify(expected[mode]),
    ids.join(', '),
  );

  for (const id of expected[mode]) {
    const button = page.getByTestId(`editor-tool-${id}`);
    const label = (await button.getAttribute('aria-label')) ?? '';
    check(`${mode}/${id} has an accessible name`, label.trim().length > 0, label);
    await button.click();
    await waitFor(
      async () => (await button.getAttribute('aria-pressed')) === 'true',
      10_000,
      `${mode}/${id} armed`,
    );
    const hint = page.getByTestId('editor-context-hint');
    const copy = (await hint.count()) > 0 ? (await hint.innerText()).trim() : '';
    check(`${mode}/${id} shows real contextual copy`, copy.length > 8 && !NO_COPY.test(copy), copy);
    // In the sign workspace every tool must speak for itself, not inherit the
    // signature prompt. Three tools have their own control-bar copy.
    if (mode === 'sign' && !['select', 'stamp', 'ai'].includes(id)) {
      check(`${mode}/${id} uses its own help copy`, copy === help[id], copy);
    }
  }
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const fixture = path.join(WORK, 'rail.pdf');
  await writeFile(fixture, buildPdf('Rail registry fixture'));

  const { tools, expected, help } = await readRegistry();
  check('the registry parsed', tools.length > 5, `${tools.length} tools`);

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource|net::|ERR_/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${BASE}/tools/edit-pdf`, { waitUntil: 'networkidle' });
    await upload(page, fixture, 'editor');

    for (const mode of ['edit', 'ai', 'redact', 'organize']) {
      await exerciseRail(page, mode, expected, help);
    }

    // Sign opens its own route without the workspace tabs; the rail and the
    // registry contract are the same.
    await page.goto(`${BASE}/tools/fill-sign`, { waitUntil: 'networkidle' });
    await upload(page, fixture, 'sign editor');
    await exerciseRail(page, 'sign', expected, help);

    check('no console errors during the rail pass', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await page.screenshot({ path: path.join(WORK, 'result.png') }).catch(() => undefined);
    await browser.close();
  }

  console.log(
    `\n=== editor-rail E2E: ${failures === 0 ? 'all checks passed' : `${failures} FAILED`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('editor-rail E2E crashed:', error);
  process.exit(1);
});
