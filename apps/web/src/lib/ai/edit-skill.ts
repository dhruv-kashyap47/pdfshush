/**
 * The PDF editing skill: read tools plus tools that *propose* document edits.
 *
 * Ported in spirit from the donor app's PDF agent tools (`tools.ts` /
 * `pdf-skill.ts`), trimmed to the operations PDFShush's engine already performs
 * and re-anchored on its own primitives:
 *
 *  - The model never sees or edits bytes. It reads text runs, then calls edit
 *    tools that append to a *pending plan*: the same "propose, review, apply"
 *    discipline as smart redaction.
 *  - Everything the model proposes lands in one of three engine inputs:
 *    `edit` (overlay objects: marks, text), `organize` (page order + rotation)
 *    and `stamp` (header/footer/page numbers). Those jobs validate their own
 *    input and re-parse their own output, so a bad proposal fails loudly rather
 *    than corrupting a download.
 *  - Geometry stays in the document layer: the model selects a run (by page +
 *    verbatim text) and pdf-core supplies the box, exactly as redaction does.
 *
 * Read-before-edit is the system rule: the model must read the pages it means to
 * change, quote text verbatim, and batch its changes before wrapping up.
 */

import type { AgentSkill, AgentToolCall, ToolExecution } from '@pdfshush/ai-agent';
import {
  LIMITS,
  timeoutForPageCount,
  type EditorObject,
  type PageRef,
  type StampJobOptions,
  type StampPosition,
  type TextEdit,
  type TextRun,
} from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';
import type { AiDocument } from './pdf-session';

/**
 * 1-based page numbers 1..count: the identity page order.
 *
 * Deliberately local rather than `identityRefs` from pdf-core: that function
 * lives in `ops/compose.ts`, whose top-level `pdf-lib` import would otherwise be
 * pulled into the web app's main chunk. Nothing in the browser's critical path
 * may reach the PDF engines; they belong to the worker.
 */
function pageNumbers(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** Bounded plan: a model that tries to mark everything is stopped, not obeyed. */
const MAX_PENDING_EDITS = 250;
const MAX_PAGES_PER_READ = 12;
const MAX_CHARS_PER_READ = 24_000;
const MAX_SEARCH_HITS = 20;
const MAX_SNIPPET = 200;

export type RotationDegrees = 0 | 90 | 180 | 270;

/** What a queued change is, for the review card's icon and copy. */
export type AiEditKind =
  | 'markup'
  | 'replace'
  | 'erase'
  | 'insert'
  | 'rotate'
  | 'delete-pages'
  | 'reorder'
  | 'stamp';

/**
 * One queued change, as the review UI shows it. Additive changes (markup,
 * replace, erase, insert) each own the overlay objects they added, so they can
 * be discarded individually; whole-document changes (page order, rotation,
 * stamp) are exclusive; the newest supersedes the previous one.
 */
export interface AiEditEntry {
  id: string;
  kind: AiEditKind;
  /** 1-based pages this change touches; empty means the whole document. */
  pages: number[];
  /** Short imperative title: "Highlight", "Replace text", "Rotate". */
  title: string;
  /** One-line detail: quoted text, replacement, degrees, template. */
  detail: string;
  /** Overlay object ids this entry contributed (preview + discard). */
  objectIds: string[];
  /** Model-facing one-liner (mirrored into `plan.actions`). */
  action: string;
}

/**
 * A rewrite of the document's *own* run, with the overlay that stands in if it
 * cannot be done.
 *
 * This is the honest form of replace/erase: PDFium rewrites the glyphs where
 * they already are, so the run keeps the document's own font, size, matrix and
 * position, and the original text is genuinely gone (not just hidden). The
 * whiteout and the replacement text are kept as `fallbackIds` and are applied by
 * the engine only when the rewrite is impossible or does not survive
 * re-extraction; never painted over a rewrite that worked.
 */
export interface AiInPlaceIntent {
  id: string;
  pageIndex: number;
  /** Text of the run being rewritten; must be non-empty. */
  find: string;
  /** Replacement text; empty erases the run. */
  replace: string;
  /** Display-space box of the run, used to pick between identical strings. */
  box: { x: number; y: number; width: number; height: number };
  /** Overlay objects (whiteout first, then replacement text) applied on fallback. */
  fallbackIds: string[];
}

/**
 * The pending edit plan. Mutated in place by the skill's tools; the UI renders a
 * review list from it and hands the whole thing to the engine on "Apply".
 */
export interface AiEditPlan {
  /** Overlay objects for the `edit` job, in z-order (later = on top). */
  objects: EditorObject[];
  /** In-place rewrites of the document's own runs (see `AiInPlaceIntent`). */
  intents: AiInPlaceIntent[];
  /** New page order as *original* 1-based page numbers; null = unchanged. */
  order: number[] | null;
  /** Per-original-page rotation overrides, keyed by 1-based page number. */
  rotations: Map<number, RotationDegrees>;
  /** Header/footer/page-number options for the `stamp` job; null = none. */
  stamp: StampJobOptions | null;
  /** The review list: one entry per accepted change, in the order it was made. */
  entries: AiEditEntry[];
  /** Model-facing one-liners (mirror of `entries[].action`). */
  actions: string[];
}

export interface AiEditSkillOptions {
  /** Fired after every accepted change so the UI can re-render the review list. */
  onChange?(): void;
  /** Fired when the model jumps to a page, so the UI can show it. */
  onGotoPage?(page: number): void;
}

export interface AiEditSkill {
  skill: AgentSkill;
  /** The live plan (same object the tools mutate). */
  plan(): AiEditPlan;
  /** Discard one queued change, undoing exactly what it added. */
  discard(id: string): void;
  /** Drop every queued change. */
  clear(): void;
}

export const emptyEditPlan = (): AiEditPlan => ({
  objects: [],
  intents: [],
  order: null,
  rotations: new Map(),
  stamp: null,
  entries: [],
  actions: [],
});

const pageLabel = (index: number): string => `[page ${index + 1}]`;

/** `#rgb`/`#rrggbb` or undefined: anything the engine would reject is dropped. */
function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)
    ? trimmed.startsWith('#')
      ? trimmed
      : `#${trimmed}`
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Indices of runs whose text contains `needle` (case-insensitive). Substring,
 * not whole-run, so "Invoice 42" finds a run reading "Invoice 42 - Paid".
 */
function matchingRuns(runs: TextRun[], needle: string): number[] {
  const want = needle.trim().toLowerCase();
  if (!want) return [];
  const hits: number[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    if ((runs[i]?.text ?? '').toLowerCase().includes(want)) hits.push(i);
  }
  return hits;
}

export function createPdfEditSkill(doc: AiDocument, options: AiEditSkillOptions = {}): AiEditSkill {
  const pageCount = doc.pages.length;
  const plan = emptyEditPlan();
  let idSeq = 0;

  const nextId = (): string => `ai-${(idSeq += 1)}`;

  const clampPage = (raw: unknown): number | null => {
    const n = asNumber(raw);
    if (n === undefined) return null;
    const page = Math.floor(n);
    return page < 1 || page > pageCount ? null : page;
  };

  const runsOn = (page: number): TextRun[] => doc.runs[page - 1] ?? [];

  const pageSize = (page: number): { width: number; height: number } | undefined =>
    doc.pageSizes?.[page - 1];

  const changed = () => options.onChange?.();

  /** Rebuild the model-facing one-liners and repaint the review list. */
  const sync = (): void => {
    plan.actions = plan.entries.map((entry) => entry.action);
    changed();
  };

  let entrySeq = 0;
  const undos = new Map<string, () => void>();

  /** Subtract overlay objects by id (how an additive change undoes itself). */
  const removeObjects = (ids: string[]): void => {
    const drop = new Set(ids);
    plan.objects = plan.objects.filter((object) => !drop.has(object.id));
    // An in-place intent is identified by one of its own objects (the drawn text
    // for a replace, the whiteout for an erase), so discarding that change takes
    // the rewrite with it.
    plan.intents = plan.intents.filter((intent) => !drop.has(intent.id));
  };

  /**
   * Record one *additive* change (markup/replace/erase/insert). It owns the
   * objects it added, so its review card can be discarded on its own, undoing
   * exactly those objects and nothing else.
   */
  const pushEntry = (entry: Omit<AiEditEntry, 'id'>, undo: () => void): void => {
    const id = `e-${(entrySeq += 1)}`;
    plan.entries.push({ ...entry, id });
    undos.set(id, undo);
    sync();
  };

  /**
   * Record one *whole-document* change (page order, rotation, header/footer).
   * At most one per family is queued: a new one supersedes the previous, and
   * discarding it restores the value from before the family was first touched.
   */
  const familyBase = new Map<string, unknown>();
  const pushExclusive = (
    family: string,
    kind: AiEditKind,
    entry: Omit<AiEditEntry, 'id' | 'kind'>,
    /** The value from *before* this change (the caller captures it pre-mutation). */
    base: unknown,
    write: (value: unknown) => void,
  ): void => {
    if (!familyBase.has(family)) familyBase.set(family, base);
    const previous = plan.entries.find((candidate) => candidate.kind === kind);
    if (previous) {
      plan.entries = plan.entries.filter((candidate) => candidate.id !== previous.id);
      undos.delete(previous.id);
    }
    const id = `e-${(entrySeq += 1)}`;
    plan.entries.push({ ...entry, kind, id });
    undos.set(id, () => {
      write(familyBase.get(family));
      familyBase.delete(family);
    });
    sync();
  };

  /** Drop one queued change, reversing exactly what it did. */
  const discard = (id: string): void => {
    const undo = undos.get(id);
    if (!undo) return;
    undo();
    undos.delete(id);
    plan.entries = plan.entries.filter((entry) => entry.id !== id);
    sync();
  };

  /**
   * Reserve room for `count` new objects before mutating the plan, so a batch
   * that would exceed the bound is refused whole instead of half-applied.
   * Returns the refusal to hand back, or null when the room exists.
   */
  const refuseIfFull = (count: number): ToolExecution | null => {
    if (plan.objects.length + count <= MAX_PENDING_EDITS) return null;
    return {
      output: `That would exceed the plan limit of ${MAX_PENDING_EDITS} edits. Apply the changes so far, then continue in a new request.`,
      isError: true,
      summary: 'Plan limit reached',
    };
  };

  const orderBase = (): number[] => plan.order ?? pageNumbers(pageCount);

  /* --------------------------------------------------------------- tools */

  const tools: AgentSkill['tools'] = [
    {
      name: 'get_document',
      description: 'Get the file name, page count, and per-page size in points.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'read_pages',
      description: `Read an inclusive, 1-based page range. At most ${MAX_PAGES_PER_READ} pages per call.`,
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'integer', description: 'First page (1-based)' },
          end: { type: 'integer', description: 'Last page (1-based, inclusive)' },
        },
        required: ['start', 'end'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_text',
      description: 'Find pages containing a word or phrase (case-insensitive).',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Text to find' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'goto_page',
      description: 'Show a page to the user in the preview pane.',
      inputSchema: {
        type: 'object',
        properties: { page: { type: 'integer', description: 'Page to show (1-based)' } },
        required: ['page'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_pending_edits',
      description: 'List the changes queued so far, so you do not repeat one.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'markup_text',
      description:
        'Highlight, underline or strike through existing text. `text` must appear verbatim in the page text.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page containing the text (1-based)' },
          text: { type: 'string', description: 'Verbatim text fragment to mark' },
          type: {
            type: 'string',
            enum: ['highlight', 'underline', 'strikeout'],
            description: 'Mark style (default: highlight)',
          },
          color: { type: 'string', description: 'Hex colour like #ffd400' },
          all: { type: 'boolean', description: 'Mark every match, not just the first' },
        },
        required: ['page', 'text'],
        additionalProperties: false,
      },
    },
    {
      name: 'replace_text',
      description:
        'Replace existing text with new text. The document’s own text object is rewritten where it ' +
        'already is (keeping its font, size and position); if that is impossible the original is ' +
        'covered and the replacement drawn on top, and the result says which happened.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page containing the text (1-based)' },
          find: { type: 'string', description: 'Verbatim text fragment to replace' },
          replace: { type: 'string', description: 'Replacement text (may be empty to erase)' },
          all: { type: 'boolean', description: 'Replace every match, not just the first' },
          color: { type: 'string', description: 'Hex text colour like #111111' },
        },
        required: ['page', 'find', 'replace'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_text',
      description:
        'Erase existing text. The run is removed from the page rather than hidden, so the words are ' +
        'no longer selectable or searchable; a run that cannot be removed fails the change instead.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page containing the text (1-based)' },
          text: { type: 'string', description: 'Verbatim text fragment to erase' },
          all: { type: 'boolean', description: 'Erase every match, not just the first' },
        },
        required: ['page', 'text'],
        additionalProperties: false,
      },
    },
    {
      name: 'insert_text',
      description:
        'Add new text to a page. x/y are points from the top-left; omit them to place near the top-left margin.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page to add text to (1-based)' },
          text: { type: 'string', description: 'Text to insert' },
          x: { type: 'number', description: 'Left position in points from the page left edge' },
          y: { type: 'number', description: 'Top position in points from the page top edge' },
          font_size: { type: 'number', description: 'Font size in points (default 12)' },
          color: { type: 'string', description: 'Hex colour like #111111' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
        },
        required: ['page', 'text'],
        additionalProperties: false,
      },
    },
    {
      name: 'rotate_pages',
      description: 'Rotate pages by 90/180/270 degrees (saved, not just displayed).',
      inputSchema: {
        type: 'object',
        properties: {
          degrees: { type: 'integer', enum: [90, 180, 270], description: 'Clockwise rotation' },
          pages: {
            type: 'array',
            items: { type: 'integer' },
            description: '1-based pages to rotate; omit to rotate every page',
          },
        },
        required: ['degrees'],
        additionalProperties: false,
      },
    },
    {
      name: 'delete_pages',
      description: 'Remove pages from the document.',
      inputSchema: {
        type: 'object',
        properties: {
          pages: {
            type: 'array',
            items: { type: 'integer' },
            description: '1-based pages to delete',
          },
        },
        required: ['pages'],
        additionalProperties: false,
      },
    },
    {
      name: 'set_page_order',
      description: 'Reorder pages: a list of the original 1-based page numbers in their new order.',
      inputSchema: {
        type: 'object',
        properties: {
          order: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Original page numbers in the new order (may repeat or omit)',
          },
        },
        required: ['order'],
        additionalProperties: false,
      },
    },
    {
      name: 'add_header_footer',
      description:
        'Add a repeating header and/or footer. Use {n} for the page number and {N} for the total.',
      inputSchema: {
        type: 'object',
        properties: {
          header: { type: 'string', description: 'Header text; omit for none' },
          footer: { type: 'string', description: 'Footer text; omit for none' },
          position: {
            type: 'string',
            enum: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
            description: 'Header/footer anchor (default top-center / bottom-center)',
          },
          font_size: { type: 'number', description: 'Point size (4-72, default 10)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'add_page_numbers',
      description: 'Number the pages. Defaults to "Page {n} of {N}" at the bottom center.',
      inputSchema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template with {n} / {N} (default "Page {n} of {N}")' },
          position: {
            type: 'string',
            enum: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
            description: 'Where to place the number (default bottom-center)',
          },
          font_size: { type: 'number', description: 'Point size (4-72, default 10)' },
        },
        additionalProperties: false,
      },
    },
  ];

  /* ------------------------------------------------------------- executor */

  function executeTool(call: AgentToolCall): ToolExecution {
    const input = call.input ?? {};

    switch (call.name) {
      case 'get_document': {
        const sizes = doc.pageSizes
          ? doc.pageSizes
              .map((size, i) => `  page ${i + 1}: ${Math.round(size.width)} x ${Math.round(size.height)} pt`)
              .join('\n')
          : '  (sizes unavailable)';
        return {
          output: `${doc.fileName}\nPages: ${pageCount}\nPage sizes:\n${sizes}`,
          summary: 'Document info',
        };
      }

      case 'read_pages': {
        const start = clampPage(input.start);
        const end = clampPage(input.end);
        if (start === null || end === null) {
          return { output: 'start and end must be page numbers within the document.', isError: true, summary: 'read_pages' };
        }
        const from = Math.min(start, end);
        const to = Math.min(Math.max(start, end), from + MAX_PAGES_PER_READ - 1);
        const parts: string[] = [];
        let chars = 0;
        for (let page = from; page <= to; page += 1) {
          const text = doc.pages[page - 1] ?? '';
          const block = `${pageLabel(page - 1)}\n${text || '(no extractable text on this page)'}`;
          if (chars + block.length > MAX_CHARS_PER_READ) break;
          chars += block.length;
          parts.push(block);
        }
        return { output: parts.join('\n\n') || '(no text in that range)', summary: `Read pages ${from}–${to}` };
      }

      case 'search_text': {
        const query = asString(input.query).trim();
        if (!query) return { output: 'query is required.', isError: true, summary: 'search_text' };
        const needle = query.toLowerCase();
        const hits: string[] = [];
        for (let page = 0; page < pageCount && hits.length < MAX_SEARCH_HITS; page += 1) {
          const text = doc.pages[page] ?? '';
          const at = text.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          const from = Math.max(0, at - 60);
          hits.push(`${pageLabel(page)} …${text.slice(from, at + MAX_SNIPPET)}…`);
        }
        return {
          output: hits.length ? hits.join('\n') : `No page contains "${query}".`,
          summary: `Search "${query}" (${hits.length} hit${hits.length === 1 ? '' : 's'})`,
        };
      }

      case 'goto_page': {
        const page = clampPage(input.page);
        if (page === null) return { output: 'page must be a page number.', isError: true, summary: 'goto_page' };
        options.onGotoPage?.(page);
        return { output: `Showing page ${page}.`, summary: `Jump to page ${page}` };
      }

      case 'list_pending_edits': {
        if (plan.actions.length === 0) {
          return { output: 'No changes queued yet.', summary: 'Pending edits' };
        }
        return {
          output: plan.actions.map((line, i) => `${i + 1}. ${line}`).join('\n'),
          summary: `${plan.actions.length} pending edit(s)`,
        };
      }

      case 'markup_text': {
        const page = clampPage(input.page);
        const text = asString(input.text);
        if (page === null) return { output: 'page must be within the document.', isError: true, summary: 'markup_text' };
        const runs = runsOn(page);
        const hits = matchingRuns(runs, text);
        if (hits.length === 0) {
          return {
            output: `No text matching "${text}" on page ${page}. Read the page and quote a fragment exactly as it appears.`,
            isError: true,
            summary: `markup_text (no match)`,
          };
        }
        const kindInput = asString(input.type);
        const kind = kindInput === 'underline' || kindInput === 'strikeout' ? kindInput : 'highlight';
        const color = hexColor(input.color);
        const chosen = input.all === true ? hits : hits.slice(0, 1);
        const refused = refuseIfFull(chosen.length);
        if (refused) return refused;
        const added: string[] = [];
        for (const index of chosen) {
          const run = runs[index]!;
          const id = nextId();
          added.push(id);
          plan.objects.push({
            id,
            kind,
            pageIndex: page - 1,
            x: run.x,
            y: run.y,
            width: run.width,
            height: run.height,
            ...(color ? { color } : {}),
          });
        }
        const quoted = chosen.map((i) => runs[i]!.text).join('", "').slice(0, 80);
        const label = `Mark ${chosen.length} run${chosen.length === 1 ? '' : 's'} as ${kind} on page ${page}`;
        const title = kind === 'underline' ? 'Underline' : kind === 'strikeout' ? 'Strike through' : 'Highlight';
        pushEntry(
          {
            kind: 'markup',
            pages: [page],
            title,
            detail: `“${quoted}”`,
            objectIds: added,
            action: `${label} ("${quoted}")`,
          },
          () => removeObjects(added),
        );
        return { output: `${label}: "${text}".`, summary: label, mutated: true };
      }

      case 'replace_text': {
        const page = clampPage(input.page);
        const find = asString(input.find);
        const replace = asString(input.replace);
        if (page === null) return { output: 'page must be within the document.', isError: true, summary: 'replace_text' };
        const runs = runsOn(page);
        const hits = matchingRuns(runs, find);
        if (hits.length === 0) {
          return {
            output: `No text matching "${find}" on page ${page}. Read the page and quote a fragment exactly as it appears.`,
            isError: true,
            summary: 'replace_text (no match)',
          };
        }
        const color = hexColor(input.color);
        const chosen = input.all === true ? hits : hits.slice(0, 1);
        const refused = refuseIfFull(chosen.length * 2);
        if (refused) return refused;
        const added: string[] = [];
        for (const index of chosen) {
          const run = runs[index]!;
          const coverId = nextId();
          added.push(coverId);
          // The overlay the engine draws *only* if the run cannot be rewritten in
          // place: cover the old run, then draw the new text over it.
          plan.objects.push({
            id: coverId,
            kind: 'whiteout',
            pageIndex: page - 1,
            x: Math.max(0, run.x - 1),
            y: Math.max(0, run.y - 1),
            width: run.width + 2,
            height: run.height + 2,
          });
          const textId = nextId();
          added.push(textId);
          plan.objects.push({
            id: textId,
            kind: 'text',
            pageIndex: page - 1,
            x: run.x,
            y: run.y,
            width: Math.max(run.width, 24),
            height: Math.max(run.height, run.fontSize * 1.3),
            text: replace,
            fontSize: Math.min(72, Math.max(4, run.fontSize || 12)),
            align: 'left',
            ...(run.fontFamily ? { fontFamily: run.fontFamily } : {}),
            ...(run.bold ? { bold: true } : {}),
            ...(run.italic ? { italic: true } : {}),
            ...(color ? { color } : {}),
          });
          // The real change: rewrite the run the document already has. `find` is
          // the run exactly as it was extracted (not the model's fragment), which
          // is what PDFium's text objects can be matched against; the box picks
          // between identical strings on the page.
          plan.intents.push({
            id: textId,
            pageIndex: page - 1,
            find: run.text || find,
            replace,
            box: { x: run.x, y: run.y, width: run.width, height: run.height },
            fallbackIds: [coverId, textId],
          });
        }
        const label = `Replace ${chosen.length} occurrence${chosen.length === 1 ? '' : 's'} of "${find}" on page ${page}`;
        pushEntry(
          {
            kind: 'replace',
            pages: [page],
            title: 'Replace text',
            detail: `“${find}” → “${replace || '∅'}”`,
            objectIds: added,
            action: `${label} with "${replace}"`,
          },
          () => removeObjects(added),
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'delete_text': {
        const page = clampPage(input.page);
        const text = asString(input.text);
        if (page === null) return { output: 'page must be within the document.', isError: true, summary: 'delete_text' };
        const runs = runsOn(page);
        const hits = matchingRuns(runs, text);
        if (hits.length === 0) {
          return {
            output: `No text matching "${text}" on page ${page}. Read the page and quote a fragment exactly as it appears.`,
            isError: true,
            summary: 'delete_text (no match)',
          };
        }
        const chosen = input.all === true ? hits : hits.slice(0, 1);
        const refused = refuseIfFull(chosen.length);
        if (refused) return refused;
        const added: string[] = [];
        for (const index of chosen) {
          const run = runs[index]!;
          const id = nextId();
          added.push(id);
          // Kept as the intent's fallback (and as the preview marker): the engine
          // covers the run only when it cannot remove it, and refuses outright
          // when it can neither remove nor honestly delete it.
          plan.objects.push({
            id,
            kind: 'whiteout',
            pageIndex: page - 1,
            x: Math.max(0, run.x - 1),
            y: Math.max(0, run.y - 1),
            width: run.width + 2,
            height: run.height + 2,
          });
          plan.intents.push({
            id,
            pageIndex: page - 1,
            find: run.text || text,
            replace: '',
            box: { x: run.x, y: run.y, width: run.width, height: run.height },
            fallbackIds: [id],
          });
        }
        const label = `Erase ${chosen.length} occurrence${chosen.length === 1 ? '' : 's'} of "${text}" on page ${page}`;
        pushEntry(
          {
            kind: 'erase',
            pages: [page],
            title: 'Erase text',
            detail: `“${text.slice(0, 80)}”`,
            objectIds: added,
            action: label,
          },
          () => removeObjects(added),
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'insert_text': {
        const page = clampPage(input.page);
        const text = asString(input.text);
        if (page === null) return { output: 'page must be within the document.', isError: true, summary: 'insert_text' };
        if (!text.trim()) return { output: 'text is required.', isError: true, summary: 'insert_text' };
        const refused = refuseIfFull(1);
        if (refused) return refused;
        const size = pageSize(page);
        const fontSize = Math.min(72, Math.max(4, asNumber(input.font_size) ?? 12));
        const width = size ? Math.max(80, size.width - 96) : 440;
        const x = Math.min(Math.max(asNumber(input.x) ?? 48, 0), size ? size.width - 24 : 1e5);
        const y = Math.min(Math.max(asNumber(input.y) ?? 48, 0), size ? size.height - 24 : 1e5);
        const alignInput = asString(input.align);
        const align = alignInput === 'center' || alignInput === 'right' ? alignInput : 'left';
        const color = hexColor(input.color);
        const objectId = nextId();
        plan.objects.push({
          id: objectId,
          kind: 'text',
          pageIndex: page - 1,
          x,
          y,
          width,
          height: Math.max(fontSize * 1.4, 16),
          text,
          fontSize,
          align,
          ...(color ? { color } : {}),
        });
        const label = `Insert text on page ${page}`;
        pushEntry(
          {
            kind: 'insert',
            pages: [page],
            title: 'Insert text',
            detail: `“${text.slice(0, 80)}”`,
            objectIds: [objectId],
            action: `${label}: "${text.slice(0, 80)}"`,
          },
          () => removeObjects([objectId]),
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'rotate_pages': {
        const degrees = asNumber(input.degrees);
        if (degrees !== 90 && degrees !== 180 && degrees !== 270) {
          return { output: 'degrees must be 90, 180 or 270.', isError: true, summary: 'rotate_pages' };
        }
        const rawPages = Array.isArray(input.pages) ? input.pages : null;
        const targets = rawPages
          ? rawPages.map((value) => clampPage(value)).filter((p): p is number => p !== null)
          : Array.from({ length: pageCount }, (_, i) => i + 1);
        if (targets.length === 0) {
          return { output: 'No valid pages to rotate.', isError: true, summary: 'rotate_pages' };
        }
        const base = new Map(plan.rotations);
        for (const page of targets) plan.rotations.set(page, degrees);
        const label =
          targets.length === pageCount
            ? `Rotate every page by ${degrees}°`
            : `Rotate page${targets.length === 1 ? '' : 's'} ${targets.join(', ')} by ${degrees}°`;
        pushExclusive(
          'rotation',
          'rotate',
          {
            pages: targets,
            title: 'Rotate pages',
            detail: targets.length === pageCount ? `${degrees}° (all pages)` : `${degrees}°`,
            objectIds: [],
            action: label,
          },
          base,
          (value) => {
            plan.rotations = value as Map<number, RotationDegrees>;
          },
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'delete_pages': {
        const rawPages = Array.isArray(input.pages) ? input.pages : [];
        const targets = new Set(
          rawPages.map((value) => clampPage(value)).filter((p): p is number => p !== null),
        );
        if (targets.size === 0) {
          return { output: 'pages must list valid 1-based page numbers.', isError: true, summary: 'delete_pages' };
        }
        const remaining = orderBase().filter((page) => !targets.has(page));
        if (remaining.length === 0) {
          return { output: 'That would delete every page.', isError: true, summary: 'delete_pages' };
        }
        const base = plan.order ? [...plan.order] : null;
        plan.order = remaining;
        const pages = [...targets].sort((a, b) => a - b);
        const label = `Delete page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`;
        pushExclusive(
          'page-order',
          'delete-pages',
          {
            pages,
            title: 'Delete pages',
            detail: `Page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`,
            objectIds: [],
            action: label,
          },
          base,
          (value) => {
            plan.order = value as number[] | null;
          },
        );
        return { output: `${label}. The document will have ${remaining.length} pages.`, summary: label, mutated: true };
      }

      case 'set_page_order': {
        const rawOrder = Array.isArray(input.order) ? input.order : [];
        if (rawOrder.length === 0) {
          return { output: 'order must list page numbers.', isError: true, summary: 'set_page_order' };
        }
        const order: number[] = [];
        for (const value of rawOrder) {
          const page = clampPage(value);
          if (page === null) {
            return {
              output: `"${String(value)}" is not a page in this document (1-${pageCount}).`,
              isError: true,
              summary: 'set_page_order',
            };
          }
          order.push(page);
        }
        const base = plan.order ? [...plan.order] : null;
        plan.order = order;
        const label = `Reorder pages to ${order.join(', ')}`;
        pushExclusive(
          'page-order',
          'reorder',
          {
            pages: [],
            title: 'Reorder pages',
            detail: order.join(' → '),
            objectIds: [],
            action: label,
          },
          base,
          (value) => {
            plan.order = value as number[] | null;
          },
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'add_header_footer': {
        const header = asString(input.header);
        const footer = asString(input.footer);
        if (!header.trim() && !footer.trim()) {
          return { output: 'Provide header and/or footer text.', isError: true, summary: 'add_header_footer' };
        }
        const position = resolvePosition(input.position);
        const style = { fontSize: clampFontSize(input.font_size, 10) };
        const current = plan.stamp ?? {};
        const base = plan.stamp ? { ...plan.stamp } : null;
        plan.stamp = {
          ...current,
          ...(header.trim()
            ? { header: { text: header, ...(position.header ? { position: position.header } : {}) } }
            : {}),
          ...(footer.trim()
            ? { footer: { text: footer, ...(position.footer ? { position: position.footer } : {}) } }
            : {}),
          style,
        };
        const label = `Add ${[header.trim() ? 'header' : '', footer.trim() ? 'footer' : ''].filter(Boolean).join(' and ')}`;
        pushExclusive(
          'stamp',
          'stamp',
          {
            pages: [],
            title: 'Header & footer',
            detail: describeStamp(plan.stamp),
            objectIds: [],
            action: label,
          },
          base,
          (value) => {
            plan.stamp = value as StampJobOptions | null;
          },
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      case 'add_page_numbers': {
        const template = asString(input.template).trim() || 'Page {n} of {N}';
        const position = resolvePosition(input.position);
        const current = plan.stamp ?? {};
        const base = plan.stamp ? { ...plan.stamp } : null;
        plan.stamp = {
          ...current,
          footer: { text: template, position: position.footer ?? 'bottom-center' },
          style: { fontSize: clampFontSize(input.font_size, 10) },
        };
        const label = `Add page numbers ("${template}")`;
        pushExclusive(
          'stamp',
          'stamp',
          {
            pages: [],
            title: 'Header & footer',
            detail: describeStamp(plan.stamp),
            objectIds: [],
            action: label,
          },
          base,
          (value) => {
            plan.stamp = value as StampJobOptions | null;
          },
        );
        return { output: `${label}.`, summary: label, mutated: true };
      }

      default:
        return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name };
    }
  }

  const systemPrompt = [
    "You are PDFShush's PDF editor. You read one open PDF and queue edits; the user reviews and applies them.",
    `The document has ${pageCount} page(s). You cannot see it except through the tools.`,
    'Rules:',
    '- Read the page(s) you intend to change first, with read_pages or search_text, and quote text verbatim from the file.',
    '- Make changes with the edit tools; each one queues a change and returns a confirmation. Queue every change the request needs.',
    '- Use list_pending_edits before adding more if you are unsure what is already queued.',
    '- Geometry stays in the tool: never invent coordinates. For markup/replace/delete, pass the page and the exact text.',
    '- For insert_text, get_document reports each page size in points; x/y are points from the top-left corner.',
    '- When editing is done, reply in one or two short sentences saying what you changed. Do not describe the tools themselves.',
    '- If the request is a question about the document, just answer it with [page N] citations and queue nothing.',
    '- If text you need to change is not present, say so plainly instead of guessing.',
  ].join('\n');

  return {
    skill: {
      id: 'pdf-edit',
      systemPrompt,
      tools,
      buildContext() {
        const pending =
          plan.actions.length > 0 ? `\nPending edits (${plan.actions.length}): ${plan.actions.join('; ')}` : '';
        return `Document: ${doc.fileName} (${pageCount} pages).${pending}`;
      },
      executeTool,
    },
    plan: () => plan,
    discard,
    clear() {
      plan.objects = [];
      plan.intents = [];
      plan.order = null;
      plan.rotations = new Map();
      plan.stamp = null;
      plan.entries = [];
      plan.actions = [];
      undos.clear();
      familyBase.clear();
      idSeq = 0;
      entrySeq = 0;
      changed();
    },
  };
}

const VALID_POSITIONS: StampPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

function resolvePosition(value: unknown): { header?: StampPosition; footer?: StampPosition } {
  if (typeof value !== 'string' || !VALID_POSITIONS.includes(value as StampPosition)) return {};
  const position = value as StampPosition;
  if (position.startsWith('top')) return { header: position };
  return { footer: position };
}

function clampFontSize(value: unknown, fallback: number): number {
  const n = asNumber(value) ?? fallback;
  return Math.min(72, Math.max(4, n));
}

/** One-line description of a stamp's text, for the review card. */
function describeStamp(stamp: StampJobOptions): string {
  const parts: string[] = [];
  if (stamp.header?.text) parts.push(`Header “${stamp.header.text}”`);
  if (stamp.footer?.text) parts.push(`Footer “${stamp.footer.text}”`);
  return parts.join(' · ') || 'Header & footer';
}

/* ----------------------------------------------------------------- apply */

export interface AiPlanApplyResult {
  data: ArrayBuffer;
  name: string;
}

/** One engine job in the apply pipeline, as the progress UI shows it. */
export interface ApplyStep {
  slug: 'edit' | 'text-edit' | 'organize' | 'stamp';
  label: string;
  /** Zero-based position and total number of steps in this apply. */
  index: number;
  total: number;
}

/** True when the plan would change the document at all. */
export function editPlanIsEmpty(plan: AiEditPlan): boolean {
  return (
    plan.objects.length === 0 &&
    plan.intents.length === 0 &&
    !plan.order &&
    plan.rotations.size === 0 &&
    !plan.stamp
  );
}

/**
 * Split the plan into genuine in-place rewrites and plain overlay objects.
 *
 * An intent's `fallbackIds` point at objects the plan already holds (the whiteout
 * and, for a replace, the drawn text). Those objects are removed from the
 * overlay list because `text-edit` applies them itself, and only for a rewrite
 * that demoted; passing them as ordinary overlays would paint the fallback over
 * a rewrite that worked.
 */
export function planTextEdits(plan: AiEditPlan): { edits: TextEdit[]; overlays: EditorObject[] } {
  const byId = new Map(plan.objects.map((object) => [object.id, object]));
  const linked = new Set<string>();
  const edits: TextEdit[] = [];
  for (const intent of plan.intents) {
    const fallback = intent.fallbackIds
      .map((id) => byId.get(id))
      .filter((object): object is EditorObject => object !== undefined);
    for (const id of intent.fallbackIds) linked.add(id);
    edits.push({
      id: intent.id,
      pageIndex: intent.pageIndex,
      find: intent.find,
      replace: intent.replace,
      box: intent.box,
      ...(fallback.length > 0 ? { fallback } : {}),
    });
  }
  return { edits, overlays: plan.objects.filter((object) => !linked.has(object.id)) };
}

/** The `PageRef[]` for the organize step, or null when page structure is unchanged. */
export function planPageRefs(plan: AiEditPlan, pageCount: number): PageRef[] | null {
  if (!plan.order && plan.rotations.size === 0) return null;
  const base = plan.order ?? pageNumbers(pageCount);
  return base.map((page) => {
    const rotate = plan.rotations.get(page);
    return rotate === undefined
      ? { docIndex: 0, pageIndex: page - 1 }
      : { docIndex: 0, pageIndex: page - 1, rotateDegrees: rotate };
  });
}

/**
 * Run the plan through the engine: text rewrites and overlay objects, then page
 * order/rotation, then header/footer. Each step consumes the previous step's
 * output bytes, and every job validates its own input and re-parses its own
 * output; a plan the model got wrong fails a step, loudly, instead of
 * producing a bad download.
 *
 * Replacements go through `text-edit`, which rewrites the document's own run in
 * place and falls back to the plan's overlay only when it cannot. A plan with no
 * replacements never loads the PDFium engine: pure overlays stay with `edit`.
 */
export async function applyEditPlan(
  file: File,
  plan: AiEditPlan,
  options: {
    pageCount: number;
    signal?: AbortSignal;
    onProgress?: (ratio: number) => void;
    onStep?: (step: ApplyStep) => void;
  },
): Promise<AiPlanApplyResult> {
  const stem = (file.name.replace(/\.pdf$/i, '').trim() || 'document').slice(0, 100);
  const outputName = `${stem}-edited`;
  const timeoutMs = timeoutForPageCount(options.pageCount);
  let bytes: ArrayBuffer = await file.arrayBuffer();
  let name = `${outputName}.pdf`;

  const runStep = async (slug: string, stepOptions: Record<string, unknown>): Promise<void> => {
    const out = await jobPool.run<{ data: ArrayBuffer; name?: string; fileName?: string }>(
      slug,
      [{ name, type: 'application/pdf', data: new Uint8Array(bytes) }],
      { ...stepOptions, outputName },
      {
        timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onProgress ? { onProgress: (progress) => options.onProgress?.(progress.ratio ?? 0) } : {}),
      },
    );
    bytes = out.data;
    name = out.fileName ?? out.name ?? name;
  };

  const planned: {
    slug: ApplyStep['slug'];
    label: string;
    options: Record<string, unknown>;
  }[] = [];

  if (plan.objects.length > LIMITS.tool.maxEditObjects) {
    throw new Error(`Too many edits in one document (${plan.objects.length}).`);
  }

  const { edits, overlays } = planTextEdits(plan);

  if (edits.length > 0) {
    if (edits.length > LIMITS.tool.maxTextEdits) {
      throw new Error(`Too many text rewrites in one document (${edits.length}).`);
    }
    planned.push({
      slug: 'text-edit',
      label: 'Rewriting text in place',
      options: { edits, ...(overlays.length > 0 ? { objects: overlays } : {}) },
    });
  } else if (overlays.length > 0) {
    planned.push({ slug: 'edit', label: 'Placing overlays', options: { objects: overlays } });
  }

  const refs = planPageRefs(plan, options.pageCount);
  if (refs) {
    planned.push({ slug: 'organize', label: 'Rebuilding page order', options: { pageOrder: refs } });
  }

  if (plan.stamp) {
    planned.push({
      slug: 'stamp',
      label: 'Stamping header & footer',
      options: plan.stamp as Record<string, unknown>,
    });
  }

  for (let index = 0; index < planned.length; index += 1) {
    const step = planned[index]!;
    options.onStep?.({ slug: step.slug, label: step.label, index, total: planned.length });
    await runStep(step.slug, step.options);
    options.onProgress?.((index + 1) / planned.length);
  }

  return { data: bytes, name };
}
