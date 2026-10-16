/**
 * Smart-redaction proposal.
 *
 * The model only *selects* which text runs look sensitive; geometry stays in
 * pdf-core, and the existing rasterizing `redact` job is the only thing that
 * destroys anything. Nothing here writes to the document — the output is a list
 * of rectangles for the user to review.
 *
 * The model is handed a bounded, numbered list of runs (`P<page>#<run>\ttext`)
 * and must answer with the coordinates of the runs it flags. Indices, not
 * offsets, so a model that paraphrases cannot move a mark.
 */

import type { TextRun } from '@pdfshush/pdf-core';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { byokAsk, type AiAsk } from './ask';

/** A rectangle to destroy, in the editor's display space (same space as TextRun). */
export interface ProposedRegion {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface ProposeOptions {
  /** BYOK settings; used only when `ask` is not supplied. */
  settings: AiSettings;
  /** Override the one-shot asker (managed mode uses `managedAsk`). Defaults to BYOK. */
  ask?: AiAsk;
  /** Extra terms the user wants treated as sensitive, verbatim. */
  patterns?: string[];
  signal?: AbortSignal;
}

export interface ProposeResult {
  regions: ProposedRegion[];
  /** Runs handed to the model, how many the model flagged, and whether the list was capped. */
  offered: number;
  flagged: number;
  truncated: boolean;
  /** Set when the model call or its answer failed; `regions` is then empty. */
  error?: string;
}

/** Keep the prompt bounded: the model sees at most this many runs / characters. */
const MAX_OFFERED_RUNS = 600;
const MAX_PROMPT_CHARS = 26_000;
const MIN_RUN_CHARS = 2;

const SYSTEM_PROMPT = [
  'You are a privacy analyst reviewing the text runs of a document before redaction.',
  'You are given lines of the form `P<page>#<run>` followed by a tab and the run text.',
  'Decide which runs contain sensitive information that must be destroyed: government IDs, social',
  'security or tax numbers, bank/account/card numbers, passwords, API keys or credentials, phone',
  'numbers, email addresses, home addresses, and full names of private individuals.',
  'Do not flag generic words, headings, or clearly public/company information.',
  'Reply with ONLY a JSON object of the form {"sensitive":[[page,run],...]}. No prose, no code fences.',
].join(' ');

/** First complete JSON object/array in `content`, or null. Tolerates fencing prose. */
function firstJson(content: string): unknown {
  const start = content.search(/[[{]/);
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < content.length; i += 1) {
    const ch = content[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) {
        try {
          return JSON.parse(content.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function toInt(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : null;
}

function collectPairs(value: unknown): [number, number][] {
  const out: [number, number][] = [];
  const add = (a: unknown, b: unknown) => {
    const page = toInt(a);
    const run = toInt(b);
    if (page !== null && run !== null) out.push([page, run]);
  };
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (Array.isArray(entry)) add(entry[0], entry[1]);
    else if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      add(record.page ?? record.p, record.run ?? record.r ?? record.index);
    } else if (typeof entry === 'string') {
      const match = entry.match(/(\d+)\s*[:#,-]\s*(\d+)/);
      if (match) add(match[1], match[2]);
    }
  }
  return out;
}

/** Pull `[page, run]` pairs out of whatever shape the model answered with. */
export function parseSensitivePairs(content: string): [number, number][] {
  const parsed = firstJson(content);
  if (parsed === null) return [];
  if (Array.isArray(parsed)) return collectPairs(parsed);
  if (typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    return collectPairs(record.sensitive ?? record.runs ?? record.results);
  }
  return [];
}

/**
 * Ask the configured provider which runs are sensitive. Never throws for a
 * provider/answer problem — that comes back as `error` with no regions.
 */
export async function proposeSensitiveRegions(
  runsPerPage: TextRun[][],
  options: ProposeOptions,
): Promise<ProposeResult> {
  const lookup = new Map<string, TextRun>();
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;

  outer: for (let page = 0; page < runsPerPage.length; page += 1) {
    const runs = runsPerPage[page] ?? [];
    for (let run = 0; run < runs.length; run += 1) {
      const text = runs[run];
      if (!text) continue;
      const trimmed = text.text.trim();
      if (trimmed.length < MIN_RUN_CHARS) continue;
      const line = `P${page + 1}#${run}\t${trimmed}`;
      if (lines.length >= MAX_OFFERED_RUNS || chars + line.length > MAX_PROMPT_CHARS) {
        truncated = true;
        break outer;
      }
      lines.push(line);
      lookup.set(`${page + 1}:${run}`, text);
      chars += line.length + 1;
    }
  }

  if (lines.length === 0) {
    return {
      regions: [],
      offered: 0,
      flagged: 0,
      truncated: false,
      error: 'The document has no extractable text to review.',
    };
  }

  const ask = options.ask ?? byokAsk(options.settings);

  const patterns = (options.patterns ?? []).map((value) => value.trim()).filter(Boolean);
  const user = [
    patterns.length > 0 ? `Always treat these as sensitive: ${patterns.join(', ')}.` : '',
    'Text runs:',
    lines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ask(SYSTEM_PROMPT, user, options.signal);
  if (!response.ok) {
    return {
      regions: [],
      offered: lines.length,
      flagged: 0,
      truncated,
      error: response.error ?? 'The AI request failed.',
    };
  }

  const regions: ProposedRegion[] = [];
  const seen = new Set<string>();
  for (const [page, run] of parseSensitivePairs(response.content ?? '')) {
    const key = `${page}:${run}`;
    if (seen.has(key)) continue;
    const text = lookup.get(key);
    if (!text) continue;
    seen.add(key);
    // A little padding so a mark cannot clip the glyph edges.
    const pad = Math.max(1.5, text.height * 0.12);
    regions.push({
      pageIndex: page - 1,
      x: Math.max(0, text.x - pad),
      y: Math.max(0, text.y - pad),
      width: text.width + pad * 2,
      height: text.height + pad * 2,
      label: 'ai',
    });
  }

  return { regions, offered: lines.length, flagged: regions.length, truncated };
}
