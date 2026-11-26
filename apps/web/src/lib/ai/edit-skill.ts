/**
 * The PDF editing skill: read tools plus tools that *propose* document edits.
 *
 * Ported in spirit from the donor app's PDF agent tools (`tools.ts` /
 * `pdf-skill.ts`), trimmed to the operations pdfshush's engine already performs
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

import type {
  AgentSkill,
  AgentToolCall,
  ExecutedToolCall,
  ToolExecution,
} from '@pdfshush/ai-agent';
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
/** The one-line-per-page overview: same budget discipline, much shorter lines. */
const SCAN_MAX_CHARS = 18_000;
const SCAN_SNIPPET = 80;

export type RotationDegrees = 0 | 90 | 180 | 270;

/**
 * How far a change can reach. `content` edits words or marks them in place;
 * `layout` moves the page structure or adds a box whose position matters, so
 * the user should look at the page before applying it.
 */
export type AiEditImpact = 'content' | 'layout';

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
  /** `layout` changes can shift position; the review UI labels them. */
  impact: AiEditImpact;
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

/** Page list for a review row: complete when short, counted when long. */
function pageList(pages: number[]): string {
  if (pages.length <= 8) return pages.join(', ');
  return `${pages.slice(0, 8).join(', ')} +${pages.length - 8} more`;
}

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

/**
 * Replace occurrences of `needle` inside one run's text, case-insensitively.
 *
 * The PDF engine rewrites the run it is given, so a tool that matched a
 * fragment must hand it the *whole run with only that fragment changed*.
 * Handing over just the replacement text would erase the rest of the line.
 * When `all` is false only the first occurrence changes; otherwise every
 * occurrence in this run does.
 */
export function spliceOccurrences(
  text: string,
  needle: string,
  replacement: string,
  all: boolean,
): { text: string; count: number } {
  // Prefer the fragment exactly as quoted (so deleting "Quarterly " also
  // removes its trailing space); fall back to the trimmed form the matching
  // layer used when the model wrapped it in stray whitespace.
  const raw = needle.toLowerCase();
  const trimmed = needle.trim().toLowerCase();
  const haystack = text.toLowerCase();
  const want = raw && haystack.includes(raw) ? raw : trimmed;
  if (!want) return { text, count: 0 };
  let out = '';
  let from = 0;
  let count = 0;
  let at = haystack.indexOf(want);
  while (at >= 0) {
    out += text.slice(from, at) + replacement;
    from = at + want.length;
    count += 1;
    if (!all) break;
    at = haystack.indexOf(want, from);
  }
  if (count === 0) return { text, count: 0 };
  out += text.slice(from);
  return { text: out, count };
}

/** Why a text fragment could not become a rewrite, in the model's language. */
function missingFragment(kind: 'replace' | 'erase', page: number, needle: string): string {
  const verb = kind === 'replace' ? 'replace' : 'erase';
  return (
    `No text matching "${needle}" on page ${page}. Read the page and quote a fragment exactly ` +
    `as it appears. A short phrase inside one line works best; ${verb} changes only the quoted ` +
    'words, not the whole line.'
  );
}

/** Tools that add a queued change, so a claimed edit must have run one. */
export const MUTATING_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'markup_text',
  'replace_text',
  'replace_everywhere',
  'delete_text',
  'insert_text',
  'rotate_pages',
  'delete_pages',
  'set_page_order',
  'add_header_footer',
  'add_page_numbers',
]);

const CLAIM_VERBS =
  'highlighted|underlined|marked|struck through|replaced|deleted|erased|removed|inserted|added|' +
  'rotated|reordered|renumbered|numbered|stamped|queued|applied|changed|updated|modified';

/**
 * Whether a final assistant message reads as "I changed the document".
 *
 * Deliberately narrow: first person or a bare past-tense verb at the start,
 * never a negated ("couldn't", "did not") or future ("I'll") sentence. The
 * corrective turn is cheap; a false positive only costs one extra model turn,
 * while a false negative is a user believing a file changed when it did not.
 */
export function looksLikeEditClaim(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  if (/\b(?:couldn't|cannot|can't|did not|didn't|was not|wasn't|were not|weren't)\b/i.test(body)) {
    return false;
  }
  const firstPerson = new RegExp(
    `\\b(?:i|we)\\s+(?:have\\s+|'ve\\s+)?(?:just\\s+|also\\s+|successfully\\s+)*` +
      `(?:${CLAIM_VERBS})\\b`,
    'i',
  );
  const barePast = new RegExp(`^\\s*(?:${CLAIM_VERBS})\\b`, 'i');
  const done =
    /\b(?:done|completed|finished|all set)\b[^.!?\n]{0,20}\b(?:edit|change|highlight|replacement|deletion|rotation|header|footer|page\s+numbers?)\b/i;
  return firstPerson.test(body) || barePast.test(body) || done.test(body);
}

export function createPdfEditSkill(doc: AiDocument, options: AiEditSkillOptions = {}): AiEditSkill {
  // The true page count, not the number of pages whose text was extracted:
  // page structure edits must cover the whole file, or a rotation would drop
  // the tail of a long document.
  const pageCount = doc.pageCount;
  const textPageCount = Math.min(doc.textPageCount, doc.pages.length);
  const textGap =
    textPageCount < pageCount
      ? `Page text was extracted for pages 1-${textPageCount} of ${pageCount}. ` +
        'Text edits on later pages are unavailable; page structure edits still cover every page.'
      : '';
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

  /**
   * Queue one run rewrite (the shared body of replace_text and
   * replace_everywhere): the overlay the engine draws *only* if the run cannot
   * be rewritten in place (cover the old run, then draw the new text over it),
   * plus the real change — an intent that rewrites the run the document
   * already has. `find` is recorded as the run exactly as it was extracted
   * (not the model's fragment), which is what PDFium's text objects can be
   * matched against; the box picks between identical strings on the page.
   * Caller is responsible for the plan-limit check and owns `added`.
   */
  const queueReplacement = (
    page: number,
    run: TextRun,
    find: string,
    replace: string,
    color: string | undefined,
    added: string[],
  ): void => {
    const coverId = nextId();
    added.push(coverId);
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
    plan.intents.push({
      id: textId,
      pageIndex: page - 1,
      find: run.text || find,
      replace,
      box: { x: run.x, y: run.y, width: run.width, height: run.height },
      fallbackIds: [coverId, textId],
    });
  };

  interface RunRewrite {
    run: TextRun;
    /** The run's complete new text, not just the replacement fragment. */
    text: string;
  }

  /**
   * Find the runs a fragment change applies to and compute each run's whole
   * new text. The engine rewrites runs, so the caller must pass the complete
   * line: `spliceOccurrences` is what keeps the unmatched part of the line.
   */
  const collectRewrites = (
    page: number,
    find: string,
    replacement: string,
    all: boolean,
  ): { rewrites: RunRewrite[]; occurrences: number } => {
    const runs = runsOn(page);
    const hits = matchingRuns(runs, find);
    const chosen = all ? hits : hits.slice(0, 1);
    const rewrites: RunRewrite[] = [];
    let occurrences = 0;
    for (const index of chosen) {
      const run = runs[index]!;
      const spliced = spliceOccurrences(run.text, find, replacement, all);
      if (spliced.count === 0 || spliced.text === run.text) continue;
      rewrites.push({ run, text: spliced.text });
      occurrences += spliced.count;
    }
    return { rewrites, occurrences };
  };

  /** The explicit refusal for a text edit outside the extracted page range. */
  const noExtractedText = (page: number): ToolExecution => ({
    output:
      `Page ${page} is outside the ${textPageCount}-page text-extraction limit on this device ` +
      `(the document has ${pageCount} pages). Text edits are unavailable there; page-level ` +
      'operations such as delete, reorder, rotate and numbering still cover it.',
    isError: true,
    summary: `No extracted text on page ${page}`,
  });

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
      name: 'scan_document',
      description:
        `Get a one-line overview of every page (text amount and its first words). ` +
        'Use this on a large document to decide which pages to read_pages in detail, ' +
        'and to spot pages with no extractable text (likely scans or images).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
      name: 'replace_everywhere',
      description:
        'Replace text on every page of the document at once (same rewrite-in-place ' +
        'behaviour as replace_text, applied document-wide). Use search_text first to ' +
        'confirm the spelling you are replacing.',
      inputSchema: {
        type: 'object',
        properties: {
          find: { type: 'string', description: 'Verbatim text fragment to replace' },
          replace: { type: 'string', description: 'Replacement text (may be empty to erase)' },
          color: { type: 'string', description: 'Hex text colour like #111111' },
        },
        required: ['find', 'replace'],
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
      description:
        'Reorder pages: every original 1-based page number exactly once, in the new order. ' +
        'To remove pages use delete_pages instead; a short or duplicated list is refused.',
      inputSchema: {
        type: 'object',
        properties: {
          order: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Every original page number, exactly once, in the new order',
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
        const sizes = doc.pageSizes?.length
          ? doc.pageSizes
              .map((size, i) => `  page ${i + 1}: ${Math.round(size.width)} x ${Math.round(size.height)} pt`)
              .join('\n')
          : '  (sizes unavailable)';
        return {
          output:
            `${doc.fileName}\nPages: ${pageCount}\nPage sizes:\n${sizes}` +
            (textGap ? `\n${textGap}` : ''),
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
        if (from > textPageCount) return noExtractedText(from);
        const availableTo = Math.min(to, textPageCount);
        const parts: string[] = [];
        let chars = 0;
        let lastEmitted = from - 1;
        for (let page = from; page <= availableTo; page += 1) {
          const text = doc.pages[page - 1] ?? '';
          const block = `${pageLabel(page - 1)}\n${text || '(no extractable text on this page)'}`;
          if (chars + block.length > MAX_CHARS_PER_READ) break;
          chars += block.length;
          lastEmitted = page;
          parts.push(block);
        }
        const head = Math.min(Math.max(start, end), availableTo);
        const notes: string[] = [];
        if (parts.length > 0 && lastEmitted < head) {
          notes.push(
            `Output stopped early at the ${MAX_CHARS_PER_READ}-character limit after page ${lastEmitted}; request a narrower range for the rest.`,
          );
        }
        if (availableTo < Math.max(start, end)) notes.push(textGap);
        const limitNote = notes.length > 0 ? `\n\n(${notes.join(' ')})` : '';
        const tail =
          parts.length === 0
            ? '(no text in that range)'
            : `${parts.join('\n\n')}${limitNote}`;
        const readTo = Math.max(lastEmitted, from);
        return {
          output: tail,
          summary: readTo === from ? `Read page ${from}` : `Read pages ${from} to ${readTo}`,
        };
      }

      case 'scan_document': {
        const lines: string[] = [];
        let chars = 0;
        let pagesListed = 0;
        for (let page = 1; page <= textPageCount && chars < SCAN_MAX_CHARS; page += 1) {
          const text = doc.pages[page - 1] ?? '';
          const preview = text
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, SCAN_SNIPPET);
          const line =
            text.length === 0
              ? `page ${page} · no extractable text (may be a scan or image-only)`
              : `page ${page} · ${text.length} chars · "${preview}${text.length > SCAN_SNIPPET ? '…' : ''}"`;
          if (chars + line.length > SCAN_MAX_CHARS) break;
          chars += line.length;
          pagesListed += 1;
          lines.push(line);
        }
        const head = `${doc.fileName} — ${pageCount} page(s)`;
        const tail =
          pagesListed < textPageCount
            ? `\n(pages ${pagesListed + 1}-${textPageCount} omitted at the ${SCAN_MAX_CHARS}-character limit; read them with read_pages)`
            : textPageCount < pageCount
              ? `\n(${textGap})`
              : '';
        return {
          output: `${head}\n${lines.join('\n')}${tail}`,
          summary: `Scan ${textPageCount} of ${pageCount} pages`,
        };
      }

      case 'search_text': {
        const query = asString(input.query).trim();
        if (!query) return { output: 'query is required.', isError: true, summary: 'search_text' };
        const needle = query.toLowerCase();
        const hits: string[] = [];
        let pagesMatched = 0;
        let pagesSeen = 0;
        for (let page = 0; page < textPageCount; page += 1) {
          const text = doc.pages[page] ?? '';
          if (text.length === 0) continue;
          pagesSeen += 1;
          const lower = text.toLowerCase();
          // Count every occurrence on the page, not just the first, so the
          // model knows the scale before choosing to replace all of them.
          let count = 0;
          let at = lower.indexOf(needle);
          let first = -1;
          while (at >= 0) {
            if (first < 0) first = at;
            count += 1;
            at = lower.indexOf(needle, at + needle.length);
          }
          if (first < 0) continue;
          pagesMatched += 1;
          if (hits.length < MAX_SEARCH_HITS) {
            const from = Math.max(0, first - 60);
            hits.push(
              `${pageLabel(page)}${count > 1 ? ` (${count} occurrences)` : ''} …${text.slice(from, first + MAX_SNIPPET)}…`,
            );
          }
        }
        const more = pagesMatched > MAX_SEARCH_HITS ? `\n(${pagesMatched - MAX_SEARCH_HITS} further matching pages omitted)` : '';
        const gap = textGap ? `\n(${textGap})` : '';
        return {
          output:
            hits.length > 0
              ? `${hits.join('\n')}${more}${gap}`
              : `No page contains "${query}" (${pagesSeen === 0 ? 'the document has no extractable text; it may be a scan' : 'nothing matches it literally, character for character'}).${gap}`,
          summary: `Search "${query}" (${pagesMatched} page${pagesMatched === 1 ? '' : 's'})`,
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
        if (page > textPageCount) return noExtractedText(page);
        const runs = runsOn(page);
        const hits = matchingRuns(runs, text);
        if (hits.length === 0) {
          return {
            output: `No text matching "${text}" on page ${page}. Read the page and quote a fragment exactly as it appears. A short phrase inside one line works best.`,
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
            impact: 'content',
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
        if (page > textPageCount) return noExtractedText(page);
        if (!find.trim()) return { output: 'find is required.', isError: true, summary: 'replace_text' };
        const all = input.all === true;
        const { rewrites, occurrences } = collectRewrites(page, find, replace, all);
        if (rewrites.length === 0) {
          const matched = matchingRuns(runsOn(page), find).length > 0;
          return {
            output: matched
              ? `"${find}" already reads "${replace}" on page ${page}; nothing was queued.`
              : missingFragment('replace', page, find),
            isError: true,
            summary: 'replace_text (no change)',
          };
        }
        const color = hexColor(input.color);
        const refused = refuseIfFull(rewrites.length * 2);
        if (refused) return refused;
        const added: string[] = [];
        for (const rewrite of rewrites) {
          queueReplacement(page, rewrite.run, find, rewrite.text, color, added);
        }
        const label = `Replace ${occurrences} occurrence${occurrences === 1 ? '' : 's'} of "${find}" on page ${page}`;
        pushEntry(
          {
            kind: 'replace',
            impact: 'content',
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

      case 'replace_everywhere': {
        const find = asString(input.find);
        const replace = asString(input.replace);
        if (!find.trim()) {
          return { output: 'find is required.', isError: true, summary: 'replace_everywhere' };
        }
        // Walk the extracted pages tallying matches first, so a batch that
        // would exceed the plan limit is refused whole instead of half-queued.
        // Pages beyond the extraction cap are named in the result; the model
        // must not claim they were changed.
        const perPage: { page: number; rewrites: RunRewrite[]; occurrences: number }[] = [];
        let total = 0;
        for (let page = 1; page <= textPageCount; page += 1) {
          const { rewrites, occurrences } = collectRewrites(page, find, replace, true);
          if (rewrites.length === 0) continue;
          perPage.push({ page, rewrites, occurrences });
          total += occurrences;
        }
        if (perPage.length === 0) {
          let matched = false;
          for (let page = 1; page <= textPageCount && !matched; page += 1) {
            matched = matchingRuns(runsOn(page), find).length > 0;
          }
          return {
            output: matched
              ? `Every match of "${find}" already reads "${replace}"; nothing was queued.`
              : `No page contains "${find}". Use search_text first and quote a fragment exactly as it appears.`,
            isError: true,
            summary: 'replace_everywhere (no change)',
          };
        }
        const color = hexColor(input.color);
        const refused = refuseIfFull(perPage.reduce((n, entry) => n + entry.rewrites.length, 0) * 2);
        if (refused) return refused;
        const added: string[] = [];
        for (const { page, rewrites } of perPage) {
          for (const rewrite of rewrites) {
            queueReplacement(page, rewrite.run, find, rewrite.text, color, added);
          }
        }
        const touchedPages = perPage.map((entry) => entry.page).join(', ');
        const label = `Replace ${total} occurrence${total === 1 ? '' : 's'} of "${find}" ${perPage.length === 1 ? `on page ${touchedPages}` : `across ${perPage.length} pages (${touchedPages})`}`;
        const gap = textGap ? ` (${textGap})` : '';
        pushEntry(
          {
            kind: 'replace',
            impact: 'content',
            pages: perPage.map((entry) => entry.page),
            title: 'Replace text',
            detail: `“${find}” → “${replace || '∅'}” (document-wide)`,
            objectIds: added,
            action: `${label} with "${replace}"`,
          },
          () => removeObjects(added),
        );
        return { output: `${label}.${gap}`, summary: label, mutated: true };
      }

      case 'delete_text': {
        const page = clampPage(input.page);
        const text = asString(input.text);
        if (page === null) return { output: 'page must be within the document.', isError: true, summary: 'delete_text' };
        if (page > textPageCount) return noExtractedText(page);
        if (!text.trim()) return { output: 'text is required.', isError: true, summary: 'delete_text' };
        const all = input.all === true;
        const { rewrites, occurrences } = collectRewrites(page, text, '', all);
        if (rewrites.length === 0) {
          return {
            output: missingFragment('erase', page, text),
            isError: true,
            summary: 'delete_text (no match)',
          };
        }
        const refused = refuseIfFull(rewrites.length * 2);
        if (refused) return refused;
        const added: string[] = [];
        for (const rewrite of rewrites) {
          // The same honest path as replace: rewrite the run in place with the
          // fragment removed; only if that fails does the engine cover the run
          // and redraw its remaining text.
          queueReplacement(page, rewrite.run, text, rewrite.text, undefined, added);
        }
        const label = `Erase ${occurrences} occurrence${occurrences === 1 ? '' : 's'} of "${text}" on page ${page}`;
        pushEntry(
          {
            kind: 'erase',
            impact: 'content',
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
        if (page > textPageCount) return noExtractedText(page);
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
            impact: 'layout',
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
        // The ledger reports the whole pending rotation set, not just the last
        // call: a second rotate call must not make the first one invisible.
        const pendingPages = [...plan.rotations.keys()].sort((a, b) => a - b);
        const byAngle = new Map<RotationDegrees, number[]>();
        for (const page of pendingPages) {
          const angle = plan.rotations.get(page)!;
          const group = byAngle.get(angle) ?? [];
          group.push(page);
          byAngle.set(angle, group);
        }
        const allPages = pendingPages.length === pageCount;
        const detail =
          byAngle.size === 1
            ? `${degrees}°${allPages ? ' (all pages)' : ''}`
            : `${pendingPages.length} pages at different angles`;
        const headline =
          byAngle.size === 1
            ? `Rotate ${allPages ? 'every page' : `page${pendingPages.length === 1 ? '' : 's'} ${pageList(pendingPages)}`} by ${degrees}°`
            : `Rotate ${pendingPages.length} pages (${[...byAngle.entries()]
                .map(([angle, pages]) => `${angle}°: ${pageList(pages)}`)
                .join('; ')})`;
        pushExclusive(
          'rotation',
          'rotate',
          {
            impact: 'layout',
            pages: pendingPages,
            title: 'Rotate pages',
            detail,
            objectIds: [],
            action: headline,
          },
          base,
          (value) => {
            plan.rotations = value as Map<number, RotationDegrees>;
          },
        );
        const called =
          targets.length === pageCount
            ? `Rotate every page by ${degrees}°`
            : `Rotate page${targets.length === 1 ? '' : 's'} ${pageList(targets)} by ${degrees}°`;
        return { output: `${called}. ${headline}.`, summary: called, mutated: true };
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
        const calledPages = [...targets].sort((a, b) => a - b);
        const called = `Delete page${calledPages.length === 1 ? '' : 's'} ${pageList(calledPages)}`;
        // The review card describes every page the current plan omits, not
        // only the ones this call named: a second delete must not hide the
        // first one.
        const kept = new Set(remaining);
        const allDeleted = pageNumbers(pageCount).filter((page) => !kept.has(page));
        const ledged = `Delete page${allDeleted.length === 1 ? '' : 's'} ${pageList(allDeleted)}`;
        pushExclusive(
          'page-order',
          'delete-pages',
          {
            impact: 'layout',
            pages: allDeleted,
            title: 'Delete pages',
            detail: `Page${allDeleted.length === 1 ? '' : 's'} ${pageList(allDeleted)}`,
            objectIds: [],
            action: ledged,
          },
          base,
          (value) => {
            plan.order = value as number[] | null;
          },
        );
        return {
          output: `${called}. The document will have ${remaining.length} pages.`,
          summary: called,
          mutated: true,
        };
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
        // A partial or duplicated list would silently drop or clone pages.
        // Reordering is a permutation; removal is its own explicit tool.
        const current = orderBase();
        const available = new Set(current);
        const seen = new Set<number>();
        let invalid: number | undefined;
        for (const page of order) {
          if (!available.has(page) || seen.has(page)) {
            invalid = page;
            break;
          }
          seen.add(page);
        }
        if (invalid !== undefined || order.length !== current.length || seen.size !== current.length) {
          return {
            output:
              `A reorder must list every page exactly once (the document currently has ${current.length}). ` +
              'Missing or repeated pages were not applied. Use delete_pages for removals, then list ' +
              'every remaining page in its new order.',
            isError: true,
            summary: 'set_page_order (not a full permutation)',
          };
        }
        const base = plan.order ? [...plan.order] : null;
        plan.order = order;
        const shortOrder = order.length > 8 ? `${order.slice(0, 8).join(' → ')} → …` : order.join(' → ');
        const label = `Reorder ${order.length} pages`;
        pushExclusive(
          'page-order',
          'reorder',
          {
            impact: 'layout',
            pages: [],
            title: 'Reorder pages',
            detail: shortOrder,
            objectIds: [],
            action: `${label}: ${shortOrder}`,
          },
          base,
          (value) => {
            plan.order = value as number[] | null;
          },
        );
        return { output: `${label} to ${shortOrder}.`, summary: label, mutated: true };
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
            impact: 'layout',
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
            impact: 'layout',
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
    "You are pdfshush's PDF editor. You read one open PDF and queue edits; the user reviews and applies them.",
    `The document has ${pageCount} page(s). You cannot see it except through the tools.`,
    ...(textGap ? [textGap] : []),
    'Rules:',
    '- On a large document, call scan_document first to find which pages matter, then read_pages those.',
    '- Read the page(s) you intend to change first, with read_pages or search_text, and quote text verbatim from the file.',
    '- Make changes with the edit tools; each one queues a change and returns a confirmation. Queue every change the request needs.',
    '- replace_text and delete_text change only the quoted fragment inside its line; quote the smallest distinctive fragment. Never quote a whole line when the user asked about a word.',
    '- For a replacement that should hit every page, use replace_everywhere instead of repeating replace_text.',
    '- Use list_pending_edits before adding more if you are unsure what is already queued.',
    '- Geometry stays in the tool: never invent coordinates. For markup/replace/delete, pass the page and the exact text.',
    '- For insert_text, get_document reports each page size in points; x/y are points from the top-left corner. Inserting text is layout-sensitive; prefer an existing line where you can.',
    '- set_page_order requires every page exactly once. Use delete_pages for removals; never build a short order list.',
    '- Pages reported with no extractable text are likely scans or image-only; say so plainly instead of guessing their content.',
    '- When editing is done, reply in one or two short sentences saying what you queued. Do not describe the tools themselves.',
    '- If the request is a question about the document, just answer it with [page N] citations and queue nothing.',
    '- If text you need to change is not present, say so plainly instead of guessing. Never claim a change you did not queue.',
  ].join('\n');

  /** Entry count when the current model run began, for the claimed-action guard. */
  let actionsAtRunStart = 0;

  return {
    skill: {
      id: 'pdf-edit',
      systemPrompt,
      tools,
      buildContext() {
        actionsAtRunStart = plan.actions.length;
        const pending =
          plan.actions.length > 0 ? `\nPending edits (${plan.actions.length}): ${plan.actions.join('; ')}` : '';
        return `Document: ${doc.fileName} (${pageCount} pages).${textGap ? ` ${textGap}` : ''}${pending}`;
      },
      executeTool,
      /**
       * Claimed-action guard. A model that says "Highlighted it" without a
       * successful edit tool leaves the user with an unchanged file and a
       * confident message. If no change was queued during this run, force one
       * corrective turn: call the tool, or say the text was not found.
       */
      verifyResponse(finalText: string, executed: readonly ExecutedToolCall[]): string | null {
        const queuedThisRun = plan.actions.length > actionsAtRunStart;
        const succeeded = executed.some((call) => call.ok && MUTATING_EDIT_TOOLS.has(call.name));
        if (queuedThisRun || succeeded) return null;
        if (!looksLikeEditClaim(finalText)) return null;
        return (
          'You described an edit, but no edit tool succeeded and no new change is queued. ' +
          'Do not claim a change that was not queued. If the text could not be found, say so and ' +
          'explain what to select instead; otherwise call the appropriate edit tool now.'
        );
      },
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
      actionsAtRunStart = 0;
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
  /** Page count the engine actually produced, checked after every step. */
  pageCount: number;
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

  const runStep = async (
    slug: string,
    stepOptions: Record<string, unknown>,
  ): Promise<{ data: ArrayBuffer; name?: string; fileName?: string; pageCount?: number }> => {
    const out = await jobPool.run<{
      data: ArrayBuffer;
      name?: string;
      fileName?: string;
      pageCount?: number;
    }>(
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
    return out;
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

  let expectedPages = options.pageCount;
  for (let index = 0; index < planned.length; index += 1) {
    const step = planned[index]!;
    // `organize` is the one step allowed to change the page count (deletions,
    // reorders). Every other step must keep it, and the engine's reported count
    // is checked against that expectation before the next step runs.
    const expectedForStep =
      step.slug === 'organize' ? (refs?.length ?? options.pageCount) : expectedPages;
    options.onStep?.({ slug: step.slug, label: step.label, index, total: planned.length });
    const out = await runStep(step.slug, step.options);
    if (typeof out.pageCount === 'number' && out.pageCount !== expectedForStep) {
      throw new Error(
        `The engine produced ${out.pageCount} page${out.pageCount === 1 ? '' : 's'} where ` +
          `${expectedForStep} were expected. Nothing was offered for download.`,
      );
    }
    expectedPages = expectedForStep;
    options.onProgress?.((index + 1) / planned.length);
  }

  return { data: bytes, name, pageCount: expectedPages };
}
