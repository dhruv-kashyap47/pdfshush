/**
 * Paragraph editing state -- deliberately separate from the document model.
 *
 * The model is the immutable "what the PDF contains". A `TextEditSession` is
 * the transient "what the user is typing": it owns a draft string, a selection
 * and its own undo stack. Committing produces a `ParagraphTextEdit`, which is
 * the serializable unit the overlay and the future native rewrite consume.
 *
 * Keeping them apart means re-extracting a page (or loading a history
 * snapshot) never has to reconcile half-typed text with a stale layout.
 */

import { hashString } from './ids.js';
import type { Paragraph, ParagraphTextEdit } from './types.js';

export interface EditSelection {
  start: number;
  end: number;
}

export interface EditSnapshot {
  text: string;
  selection: EditSelection;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

interface SessionState {
  text: string;
  selection: EditSelection;
}

export interface TextEditSessionOptions {
  /** Maximum undo depth. Defaults to 200 operations. */
  historyLimit?: number;
  /** Start with an existing selection, e.g. the word the user double-clicked. */
  selection?: EditSelection;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Index of the previous Unicode code point, so emoji/combining marks delete whole. */
export function previousCodePointIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  let cursor = index - 1;
  const low = text.charCodeAt(cursor);
  if (low >= 0xdc00 && low <= 0xdfff && cursor > 0) {
    const high = text.charCodeAt(cursor - 1);
    if (high >= 0xd800 && high <= 0xdbff) cursor -= 1;
  }
  return cursor;
}

export function nextCodePointIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return index + 2;
  }
  return index + 1;
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}_'’-]/u;

/** Word boundaries around an offset, used by double-click selection. */
export function wordRangeAt(text: string, offset: number): EditSelection {
  const position = clamp(offset, 0, text.length);
  let start = position;
  let end = position;
  while (start > 0) {
    const char = text[start - 1] ?? '';
    if (!WORD_CHAR.test(char)) break;
    start -= 1;
  }
  while (end < text.length) {
    const char = text[end] ?? '';
    if (!WORD_CHAR.test(char)) break;
    end += 1;
  }
  if (start === end) {
    // On whitespace/punctuation, select the code point under the caret.
    if (position < text.length) {
      end = nextCodePointIndex(text, position);
    } else if (position > 0) {
      start = previousCodePointIndex(text, position);
    }
  }
  return { start, end };
}

export class TextEditSession {
  readonly paragraphId: string;
  readonly pageIndex: number;
  readonly before: string;
  readonly typography: Paragraph['typography'];
  readonly bbox: Paragraph['bbox'];
  readonly pdfBox: Paragraph['pdfBox'];
  readonly role: Paragraph['role'];

  private current: string;
  private selection: EditSelection;
  private readonly historyLimit: number;
  private readonly undoStack: SessionState[] = [];
  private readonly redoStack: SessionState[] = [];

  constructor(paragraph: Paragraph, options: TextEditSessionOptions = {}) {
    this.paragraphId = paragraph.id;
    this.pageIndex = paragraph.pageIndex;
    this.before = paragraph.text;
    this.typography = paragraph.typography;
    this.bbox = paragraph.bbox;
    this.pdfBox = paragraph.pdfBox;
    this.role = paragraph.role;
    this.current = paragraph.text;
    this.historyLimit = Math.max(1, options.historyLimit ?? 200);
    const selection = options.selection ?? { start: 0, end: 0 };
    this.selection = {
      start: clamp(Math.min(selection.start, selection.end), 0, this.current.length),
      end: clamp(Math.max(selection.start, selection.end), 0, this.current.length),
    };
  }

  static fromParagraph(
    paragraph: Paragraph,
    options: TextEditSessionOptions = {},
  ): TextEditSession {
    return new TextEditSession(paragraph, options);
  }

  get text(): string {
    return this.current;
  }

  get selectionStart(): number {
    return Math.min(this.selection.start, this.selection.end);
  }

  get selectionEnd(): number {
    return Math.max(this.selection.start, this.selection.end);
  }

  get hasSelection(): boolean {
    return this.selectionStart !== this.selectionEnd;
  }

  get dirty(): boolean {
    return this.current !== this.before;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  snapshot(): EditSnapshot {
    return {
      text: this.current,
      selection: { start: this.selectionStart, end: this.selectionEnd },
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      dirty: this.dirty,
    };
  }

  setSelection(start: number, end = start): void {
    const a = clamp(Math.min(start, end), 0, this.current.length);
    const b = clamp(Math.max(start, end), 0, this.current.length);
    this.selection = { start: a, end: b };
  }

  moveCaret(offset: number): void {
    this.setSelection(offset, offset);
  }

  selectAll(): void {
    this.setSelection(0, this.current.length);
  }

  selectWord(offset: number): void {
    this.selection = wordRangeAt(this.current, offset);
  }

  /** Replaces the selection (or inserts at the caret) with `value`. */
  insert(value: string): boolean {
    if (!value) return false;
    const state = this.capture();
    const start = this.selectionStart;
    const end = this.selectionEnd;
    this.current = `${this.current.slice(0, start)}${value}${this.current.slice(end)}`;
    this.selection = { start: start + value.length, end: start + value.length };
    this.record(state);
    return true;
  }

  replaceSelection(value: string): boolean {
    return this.insert(value);
  }

  /** Deletes the selection, or one code point backwards from the caret. */
  deleteBackward(): boolean {
    if (this.hasSelection) return this.deleteSelection();
    const start = this.selectionStart;
    if (start === 0) return false;
    const previous = previousCodePointIndex(this.current, start);
    return this.deleteRange(previous, start);
  }

  /** Deletes the selection, or one code point forwards from the caret. */
  deleteForward(): boolean {
    if (this.hasSelection) return this.deleteSelection();
    const start = this.selectionStart;
    if (start >= this.current.length) return false;
    const next = nextCodePointIndex(this.current, start);
    return this.deleteRange(start, next);
  }

  deleteRange(start: number, end: number): boolean {
    const from = clamp(Math.min(start, end), 0, this.current.length);
    const to = clamp(Math.max(start, end), 0, this.current.length);
    if (from === to) return false;
    const state = this.capture();
    this.current = `${this.current.slice(0, from)}${this.current.slice(to)}`;
    this.selection = { start: from, end: from };
    this.record(state);
    return true;
  }

  deleteSelection(): boolean {
    return this.deleteRange(this.selectionStart, this.selectionEnd);
  }

  setText(value: string): boolean {
    if (value === this.current) return false;
    const state = this.capture();
    this.current = value;
    this.selection = { start: value.length, end: value.length };
    this.record(state);
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.capture());
    this.restore(previous);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.capture());
    this.restore(next);
    return true;
  }

  /** Discards edits and returns to the extracted paragraph. */
  reset(): void {
    this.current = this.before;
    this.selection = { start: 0, end: 0 };
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Serializable edit for the save path; `null` when nothing changed. */
  toEdit(): ParagraphTextEdit | null {
    if (!this.dirty) return null;
    return {
      id: `edit.${hashString(`${this.paragraphId}|${this.current}`)}`,
      pageIndex: this.pageIndex,
      paragraphId: this.paragraphId,
      before: this.before,
      after: this.current,
      bbox: this.bbox,
      pdfBox: this.pdfBox,
      typography: this.typography,
      role: this.role,
    };
  }

  commit(): ParagraphTextEdit | null {
    return this.toEdit();
  }

  private capture(): SessionState {
    return {
      text: this.current,
      selection: { start: this.selectionStart, end: this.selectionEnd },
    };
  }

  private record(state: SessionState): void {
    this.undoStack.push(state);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private restore(state: SessionState): void {
    this.current = state.text;
    const start = clamp(state.selection.start, 0, this.current.length);
    const end = clamp(state.selection.end, 0, this.current.length);
    this.selection = { start: Math.min(start, end), end: Math.max(start, end) };
  }
}
