/**
 * Privacy and capability guardrails (G-05).
 *
 * The other gates prove the product works. This one proves the promises that
 * are easy to break silently:
 *
 *  1. A log line never carries document text or a file name. A stack trace is
 *     useful; the user's invoice is not ours to print.
 *  2. Editor drafts stay local and bounded. The draft record is capped before
 *     IndexedDB is touched, and the draft modules own no network primitive.
 *  3. Client code never calls a hard-coded off-origin URL. OCR is the classic
 *     anti-pattern (a CDN-hosted recognizer fetch); this app vendors Tesseract
 *     and its language data instead.
 *  4. The tool registry is complete: every `EditorTool` has one definition,
 *     help copy, an icon and a valid workspace list, and no shortcut collides.
 *
 * Every scanner has a planted violation in `--self-test`, because a guard that
 * only ever runs against a clean tree cannot tell "clean" from "blind".
 *
 *   node tests/guardrails.mjs              # scan the repository
 *   node tests/guardrails.mjs --self-test  # prove each scanner fails a plant
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_SRC = path.join(ROOT, 'apps', 'web', 'src');
const API_SRC = path.join(ROOT, 'apps', 'api', 'src');
const CORE_SRC = path.join(ROOT, 'packages', 'pdf-core', 'src');

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /(^|[\\/])(test|tests|__tests__)([\\/]|$)|\.(test|spec)\.[^.]+$/i;

const MODES = ['edit', 'sign', 'ai', 'redact', 'organize'];
const GROUPS = ['edit', 'insert', 'markup', 'shape', 'mode'];

/* ------------------------------------------------------------------ helpers */

/** Masks comments while preserving line breaks and string literals. */
export function maskComments(source) {
  let out = '';
  let state = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        out += '  ';
        index += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        out += '  ';
        index += 1;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = char;
      }
      out += char;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      } else {
        out += ' ';
      }
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        out += '  ';
        index += 1;
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    // Inside a quoted string or template literal: copy verbatim, honouring
    // escapes. Template `${...}` expressions are copied but not re-scanned;
    // that only makes a log check slightly more permissive, never a false fail.
    out += char;
    if (char === '\\') {
      if (next !== undefined) {
        out += next;
        index += 1;
      }
      continue;
    }
    if (char === state) state = 'code';
  }
  return out;
}

function lineAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < source.length; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function readString(source, start) {
  const quote = source[start];
  let text = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      text += source[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (char === quote) return { text, end: index };
    text += char;
  }
  return { text: null, end: source.length };
}

/* ------------------------------------------------- 1. document-bearing logs */

const DOCUMENT_LOG =
  /\b(?:fileName|filename|documentName|pageText|documentText|selectedText|file\.name|document\.name|page\.text|selection\.text|object\.text|run\.text|paragraph\.text|file\.bytes|document\.bytes|object\.data|paragraph\.text)\b/i;

/** Returns every console call whose arguments could carry document content. */
export function documentLogViolations(source) {
  const masked = maskComments(source);
  const violations = [];
  const call = /console\s*\.\s*(log|info|warn|error|debug)\s*\(/g;
  for (const match of masked.matchAll(call)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    let args = '';
    while (index < masked.length && depth > 0) {
      const char = masked[index];
      if (char === "'" || char === '"' || char === '`') {
        const quoted = readString(masked, index);
        args += masked.slice(index, quoted.end + 1);
        index = quoted.end + 1;
        continue;
      }
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      if (depth === 0) break;
      args += char;
      index += 1;
    }
    if (DOCUMENT_LOG.test(args)) {
      violations.push(`${lineAt(masked, match.index)}: console.${match[1]} logs ${DOCUMENT_LOG.exec(args)?.[0]}`);
    }
  }
  return violations;
}

/* ------------------------------------------------------ 2. draft boundaries */

const NETWORK_ATOM = /\b(?:fetch\s*\(|new\s+XMLHttpRequest|navigator\.sendBeacon|sendBeacon\s*\(|new\s+WebSocket|new\s+EventSource|XMLHttpRequest\s*\()/;

/** Parses the numeric draft cap without executing the module. */
export function draftLimitValue(source) {
  const match = /DRAFT_LIMIT_BYTES\s*=\s*([\d\s*]+);/.exec(source);
  if (!match) return null;
  const factors = match[1]
    .split('*')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (factors.length === 0) return null;
  return factors.reduce((total, factor) => total * factor, 1);
}

export function draftBoundaryViolations({ draft, idb }) {
  const violations = [];
  const limit = draftLimitValue(draft);
  if (limit === null) {
    violations.push('editor-draft.ts does not declare DRAFT_LIMIT_BYTES');
  } else if (limit < 1024 * 1024 || limit > 64 * 1024 * 1024) {
    violations.push(`DRAFT_LIMIT_BYTES is ${limit} bytes; expected between 1 MB and 64 MB`);
  }
  if (!/size\s*>\s*DRAFT_LIMIT_BYTES/.test(draft)) {
    violations.push('saveDraft does not compare the record size with DRAFT_LIMIT_BYTES');
  }
  if (!/reason:\s*'too-large'/.test(draft)) {
    violations.push('saveDraft does not report the too-large refusal');
  }
  for (const [name, source] of [
    ['editor-draft.ts', draft],
    ['idb.ts', idb],
  ]) {
    if (NETWORK_ATOM.test(maskComments(source))) {
      violations.push(`${name} uses a network primitive; drafts must stay in IndexedDB`);
    }
  }
  return violations;
}

/* --------------------------------------------------------- 3. off-origin use */

const URL_CALLS = [
  /fetch\s*\(\s*(['"`])([^'"`]+)\1/g,
  /new\s+WebSocket\s*\(\s*(['"`])([^'"`]+)\1/g,
  /sendBeacon\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\.open\s*\(\s*(['"])(?:GET|POST|PUT|DELETE|PATCH|HEAD)\1\s*,\s*(['"`])([^'"`]+)\2/g,
];

/** Returns every network call with a hard-coded absolute URL. */
export function offOriginViolations(source) {
  const masked = maskComments(source);
  const violations = [];
  for (const pattern of URL_CALLS) {
    for (const match of masked.matchAll(pattern)) {
      const url = match[match.length - 1];
      if (/^(?:https?:)?\/\//i.test(url)) {
        violations.push(`${lineAt(masked, match.index)}: network call to ${url}`);
      }
    }
  }
  return violations;
}

/** The OCR engine must load only same-origin vendored assets. */
export function ocrVendoringViolations(source) {
  const masked = maskComments(source);
  const violations = [];
  for (const match of masked.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    if (!/reactbits\.dev|w3\.org/i.test(match[0])) {
      violations.push(`${lineAt(masked, match.index)}: hard-coded URL ${match[0]}`);
    }
  }
  if (!/absolute\s*\(/.test(masked) || !/langPath/.test(masked)) {
    violations.push('ocr-engine.ts no longer builds same-origin worker/core/lang paths');
  }
  return violations;
}

/* ------------------------------------------------------ 4. tool registry truth */

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

/** Parses the registry without importing React or lucide icons. */
export function readToolRegistry(source) {
  const unionBlock = between(source, 'export type EditorTool =', ';');
  const defsBlock = between(source, 'export const EDITOR_TOOL_DEFS', '\n];');
  const helpBlock = between(source, 'export const TOOL_HELP', '\n};');
  const limitsBlock = between(source, 'export const TOOL_LIMITS', '\n};');

  const union = [...unionBlock.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  const defs = [...defsBlock.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((match) => match[1]);
  const help = [...helpBlock.matchAll(/^ {2}([a-z0-9-]+):/gm)].map((match) => match[1]);
  const limits = [...limitsBlock.matchAll(/^ {2}([a-z0-9-]+):/gm)].map((match) => match[1]);

  const blocks = [];
  const idMatches = [...defsBlock.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)];
  for (let index = 0; index < idMatches.length; index += 1) {
    const start = idMatches[index].index;
    const end = idMatches[index + 1]?.index ?? defsBlock.length;
    blocks.push({ id: idMatches[index][1], body: defsBlock.slice(start, end) });
  }
  return { union, defs, help, limits, blocks };
}

export function toolRegistryViolations(source) {
  const { union, defs, help, limits, blocks } = readToolRegistry(source);
  const violations = [];
  if (defs.length === 0) return ['EDITOR_TOOL_DEFS could not be parsed'];

  const defSet = new Set(defs);
  const unionSet = new Set(union);
  for (const id of unionSet) {
    if (!defSet.has(id)) violations.push(`EditorTool "${id}" has no registry definition`);
  }
  for (const id of defSet) {
    if (!unionSet.has(id)) violations.push(`registry id "${id}" is absent from EditorTool`);
    if (!help.includes(id)) violations.push(`registry tool "${id}" has no TOOL_HELP copy`);
  }
  for (const id of help) {
    if (!defSet.has(id)) violations.push(`TOOL_HELP has stale entry "${id}"`);
  }
  for (const id of limits) {
    if (!defSet.has(id)) violations.push(`TOOL_LIMITS has stale entry "${id}"`);
  }

  const shortcuts = new Map();
  for (const { id, body } of blocks) {
    if (!/label:\s*'[^']+'/.test(body)) violations.push(`tool "${id}" has no label`);
    if (!/group:\s*'([a-z]+)'/.test(body)) violations.push(`tool "${id}" has no group`);
    else {
      const group = /group:\s*'([a-z]+)'/.exec(body)[1];
      if (!GROUPS.includes(group)) violations.push(`tool "${id}" has unknown group "${group}"`);
    }
    if (!/\bicon:\s*[A-Z]/.test(body)) violations.push(`tool "${id}" has no icon component`);
    const shortcut = /shortcut:\s*'([^']+)'/.exec(body)?.[1];
    if (shortcut) {
      if (shortcuts.has(shortcut)) {
        violations.push(`shortcut "${shortcut}" is claimed by "${shortcuts.get(shortcut)}" and "${id}"`);
      } else {
        shortcuts.set(shortcut, id);
      }
    }
    const modes = /modes:\s*\[([^\]]*)\]/.exec(body)?.[1];
    if (modes !== undefined) {
      const listed = [...modes.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
      if (listed.length === 0) violations.push(`tool "${id}" declares an empty mode list`);
      for (const mode of listed) {
        if (!MODES.includes(mode)) violations.push(`tool "${id}" names unknown mode "${mode}"`);
      }
    }
  }
  return violations;
}

/* --------------------------------------------------------------- reporting */

function report(name, violations) {
  const ok = violations.length === 0;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${ok ? '' : ` - ${violations.length} violation(s)`}`);
  for (const violation of violations.slice(0, 12)) console.log(`         ${violation}`);
  return ok;
}

async function collectFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) => SOURCE_EXT.test(file) && !TEST_FILE.test(path.relative(ROOT, file)));
}

async function scanSourceTrees() {
  const files = [
    ...(await collectFiles(APP_SRC)),
    ...(await collectFiles(API_SRC)),
    ...(await collectFiles(CORE_SRC)),
  ];
  const logViolations = [];
  const originViolations = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relative = path.relative(ROOT, file).replaceAll('\\', '/');
    for (const violation of documentLogViolations(source)) {
      logViolations.push(`${relative}:${violation}`);
    }
    for (const violation of offOriginViolations(source)) {
      originViolations.push(`${relative}:${violation}`);
    }
  }
  return { logViolations, originViolations, files };
}

async function main() {
  const selfTest = process.argv.includes('--self-test');
  let failures = 0;

  if (selfTest) {
    console.log('guardrails self-test (each scanner must reject a planted violation)');
    const plants = [
      [
        'document text in a log',
        () =>
          documentLogViolations("console.error('failed to parse', file.name);").length > 0 &&
          documentLogViolations("console.error('failed to parse', error);").length === 0,
      ],
      [
        'unbounded draft or network write',
        () =>
          draftBoundaryViolations({
            draft:
              "export const DRAFT_LIMIT_BYTES = 600 * 1024 * 1024;\n" +
              "if (size > DRAFT_LIMIT_BYTES) return { ok: false, reason: 'too-large' };\n" +
              "fetch('/upload', { body: bytes });",
            idb: 'export const DB_NAME = "pdfshush";',
          }).length >= 2,
      ],
      [
        'off-origin OCR fetch',
        () =>
          offOriginViolations("fetch('https://cdn.example/ocr.js');").length > 0 &&
          offOriginViolations("fetch('/api/jobs');").length === 0,
      ],
      [
        'OCR vendoring',
        () => ocrVendoringViolations("fetch('https://cdn.example/eng.traineddata'); langPath = absolute(base);").length > 0,
      ],
      [
        'incomplete tool registry',
        () =>
          toolRegistryViolations(
            [
              'export type EditorTool =',
              "  | 'select'",
              "  | 'new-tool';",
              'export const EDITOR_TOOL_DEFS: EditorToolDef[] = [',
              '  {',
              "    id: 'select',",
              "    label: 'Select',",
              "    group: 'edit',",
              '    icon: MousePointer2,',
              '  },',
              '];',
              'export const TOOL_HELP: Record<EditorTool, string> = {',
              "  other: 'Stale copy.',",
              '};',
              'export const TOOL_LIMITS: Partial<Record<EditorTool, string>> = {};',
            ].join('\n'),
          ).length >= 2,
      ],
    ];
    for (const [name, passes] of plants) {
      const ok = passes();
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
      if (!ok) failures += 1;
    }
  } else {
    console.log('guardrails (G-05)');
    const { logViolations, originViolations, files } = await scanSourceTrees();

    if (!report(`document text never reaches a log (${files.length} files)`, logViolations)) failures += 1;

    let draft;
    let idb;
    try {
      draft = await readFile(path.join(APP_SRC, 'lib', 'editor-draft.ts'), 'utf8');
      idb = await readFile(path.join(APP_SRC, 'lib', 'idb.ts'), 'utf8');
    } catch {
      draft = '';
      idb = '';
    }
    if (!report('drafts are bounded and stay in IndexedDB', draftBoundaryViolations({ draft, idb }))) {
      failures += 1;
    }

    if (!report('no network call uses a hard-coded off-origin URL', originViolations)) failures += 1;

    let ocr = '';
    try {
      ocr = await readFile(path.join(APP_SRC, 'workers', 'ocr-engine.ts'), 'utf8');
    } catch {
      ocr = '';
    }
    if (!report('the OCR engine loads only vendored, same-origin assets', ocrVendoringViolations(ocr))) {
      failures += 1;
    }

    const registrySource = await readFile(
      path.join(APP_SRC, 'lib', 'editor-tools.ts'),
      'utf8',
    ).catch(() => '');
    if (!report('every rail tool has one complete registry record', toolRegistryViolations(registrySource))) {
      failures += 1;
    }
  }

  console.log(
    failures === 0
      ? `\n=== guardrails${selfTest ? ' self-test' : ''}: ok ===`
      : `\n=== guardrails${selfTest ? ' self-test' : ''}: ${failures} failed ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
