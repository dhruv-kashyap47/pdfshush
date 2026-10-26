/**
 * Writing a document outline (bookmarks).
 *
 * pdf-lib has no outline API, so this module works at the object level: it
 * allocates a `/Outlines` root and one item per bookmark, then links them into
 * the sibling/parent lists the PDF spec defines. That is the same structure the
 * reader in `render/outline.ts` walks, and the same shape the Split by
 * bookmarks fixtures build, so a written outline is immediately readable by
 * every viewer -- and by this product's own tools.
 *
 * Entries arrive in reading order with an optional nesting level. Titles are
 * written as UTF-16BE hex strings, which keeps non-Latin names intact; a PDF
 * string's default encoding cannot.
 */

import { PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import { LIMITS } from '../limits.js';

export interface OutlineWriteEntry {
  /** Bookmark label as shown in a reader's sidebar. */
  title: string;
  /** Zero-based destination page index. */
  pageIndex: number;
  /** Nesting depth: 0 is top level. May not skip a level. */
  level?: number;
}

export interface OutlineWriteResult {
  count: number;
  /** The document already had an outline, which was replaced. */
  replaced: boolean;
}

export const OUTLINE_WRITE_LIMITS = {
  /** Deeper outlines are unreadable in a sidebar and usually a data error. */
  maxLevel: 8,
} as const;

interface PreparedEntry {
  title: string;
  pageIndex: number;
  level: number;
}

/**
 * Replaces the document's outline with `entries`. Throws before touching the
 * document when any entry is invalid, so a rejected batch leaves no partial
 * outline behind.
 */
export function writeOutline(doc: PDFDocument, entries: OutlineWriteEntry[]): OutlineWriteResult {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Add at least one bookmark');
  }
  if (entries.length > LIMITS.tool.maxOutlineEntries) {
    throw new Error(`An outline can hold at most ${LIMITS.tool.maxOutlineEntries} bookmarks`);
  }

  const pages = doc.getPages();
  const prepared = entries.map((entry, index) => prepare(entry, index, pages.length));
  validateLevels(prepared);

  const context = doc.context;
  const rootRef = context.nextRef();
  const refs = prepared.map(() => context.nextRef());

  const levelOf = (index: number) => prepared[index]!.level;
  /** Nearest preceding entry shallower than this one, or -1 for the root. */
  const parentOf = (index: number): number => {
    const level = levelOf(index);
    if (level === 0) return -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (levelOf(i) < level) return i;
    }
    return -1;
  };

  const parents = prepared.map((_, index) => parentOf(index));
  const childrenOf = (parent: number): number[] =>
    parents.map((value, index) => (value === parent ? index : -1)).filter((index) => index >= 0);

  const descendantsOf = (index: number): number => {
    const children = childrenOf(index);
    return children.reduce((total, child) => total + 1 + descendantsOf(child), 0);
  };

  prepared.forEach((entry, index) => {
    const parent = parents[index]!;
    const siblings = childrenOf(parent);
    const position = siblings.indexOf(index);
    const previous = position > 0 ? siblings[position - 1]! : undefined;
    const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1]! : undefined;
    const page = pages[entry.pageIndex]!;

    const dictionary = context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: parent >= 0 ? refs[parent]! : rootRef,
      Dest: context.obj([page.ref, PDFName.of('Fit')]),
    });
    if (previous !== undefined) dictionary.set(PDFName.of('Prev'), refs[previous]!);
    if (next !== undefined) dictionary.set(PDFName.of('Next'), refs[next]!);

    const descendants = descendantsOf(index);
    if (descendants > 0) dictionary.set(PDFName.of('Count'), context.obj(descendants));

    const children = childrenOf(index);
    if (children.length > 0) {
      dictionary.set(PDFName.of('First'), refs[children[0]!]!);
      dictionary.set(PDFName.of('Last'), refs[children[children.length - 1]!]!);
    }

    context.assign(refs[index]!, dictionary);
  });

  const top = childrenOf(-1);
  const root = context.obj({
    Type: 'Outlines',
    // The root count is every item, visible because nested lists start open.
    Count: prepared.length,
  });
  if (top.length > 0) {
    root.set(PDFName.of('First'), refs[top[0]!]!);
    root.set(PDFName.of('Last'), refs[top[top.length - 1]!]!);
  }

  const replaced = doc.catalog.get(PDFName.of('Outlines')) !== undefined;
  context.assign(rootRef, root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);

  return { count: prepared.length, replaced };
}

function prepare(entry: OutlineWriteEntry, index: number, pageCount: number): PreparedEntry {
  const label = `Bookmark ${index + 1}`;
  if (!entry || typeof entry !== 'object') throw new Error(`${label} is not an object`);
  if (typeof entry.title !== 'string') throw new Error(`${label} needs a title`);

  // Collapse line breaks and other control characters: a title is one line in
  // every reader's sidebar, and raw control bytes in a PDF string are trouble.
  const title = entry.title
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) throw new Error(`${label} needs a title`);
  if (title.length > LIMITS.tool.maxBookmarkTitleChars) {
    throw new Error(
      `${label} title is too long (max ${LIMITS.tool.maxBookmarkTitleChars} characters)`,
    );
  }

  if (!Number.isInteger(entry.pageIndex) || entry.pageIndex < 0 || entry.pageIndex >= pageCount) {
    throw new Error(`${label} ("${title}") points at a page that does not exist`);
  }

  const level = entry.level ?? 0;
  if (!Number.isInteger(level) || level < 0 || level > OUTLINE_WRITE_LIMITS.maxLevel) {
    throw new Error(`${label} ("${title}") has an invalid nesting level`);
  }

  return { title, pageIndex: entry.pageIndex, level };
}

function validateLevels(entries: PreparedEntry[]): void {
  const first = entries[0]!;
  if (first.level !== 0) {
    throw new Error(`The first bookmark ("${first.title}") must be at the top level`);
  }
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]!;
    const current = entries[index]!;
    if (current.level > previous.level + 1) {
      throw new Error(
        `Bookmark "${current.title}" is nested too deeply under "${previous.title}"; indent one level at a time`,
      );
    }
  }
}
