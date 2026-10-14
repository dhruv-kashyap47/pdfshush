/**
 * Types for genuine in-place text editing.
 *
 * PDFShush's original editor was overlay-only: it painted a white box over the
 * original run and drew a new text object on top. The words changed, but the
 * original text stayed in the content stream -- selectable, searchable, and
 * recoverable -- and the overlay never reused the document's own font.
 *
 * This module is the honest alternative. An edit is attempted against the
 * document's *existing* text object through PDFium: the run's glyph string is
 * replaced in place, so its font, size, matrix, colour and position are the
 * document's own. When that is not possible the caller-supplied overlay is used
 * instead, and the result says so per edit -- `mode` is never guessed.
 *
 * The guarantee is the same shape as redaction's: the exported bytes are
 * reopened and re-extracted before they are offered, and a replacement that
 * does not survive that round-trip is demoted to the overlay rather than
 * shipped as a silent failure.
 */

import type { EditorObject } from '../ops/edit.js';

/** Display-space box (top-left origin, y down, PDF points at 100% zoom). */
export interface TextEditBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One requested replacement of an existing run.
 *
 * `find` is the run text as the editor extracted it. It identifies which text
 * object to edit; `box` disambiguates when the same string appears more than
 * once on a page. `fallback` are overlay objects applied only when the in-place
 * write is not possible or does not survive verification.
 */
export interface TextEdit {
  id: string;
  pageIndex: number;
  /** Original run text. Must be non-empty. */
  find: string;
  /** Replacement text. May be empty to delete the run. */
  replace: string;
  /** Display-space box of the run, used to pick between identical strings. */
  box?: TextEditBox;
  /** Overlay objects (typically a whiteout plus a text box) applied on fallback. */
  fallback?: EditorObject[];
}

/** How an individual edit was finally applied. */
export type TextEditMode = 'in-place' | 'fallback';

export interface TextEditOutcome {
  id: string;
  pageIndex: number;
  mode: TextEditMode;
  /** Present exactly when `mode` is `fallback`: why in-place editing was not used. */
  reason?: string;
}

export interface TextEditCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface TextEditVerification {
  ok: boolean;
  checks: TextEditCheck[];
}

export interface TextEditReport {
  outcomes: TextEditOutcome[];
  /** Edits applied by mutating the document's own text objects. */
  inPlace: number;
  /** Edits applied by the pdf-lib overlay fallback. */
  fallback: number;
  /** True when at least one edit was applied in place. */
  usedNativeEngine: boolean;
  verification: TextEditVerification;
  warnings: string[];
}

export interface TextEditResult {
  data: ArrayBuffer;
  name: string;
  pageCount: number;
  report: TextEditReport;
}

/** Why an export was refused outright. Each is a hard failure, never a warning. */
export type TextEditUnsafeReason =
  | { kind: 'no-pdfium'; detail: string }
  | { kind: 'open-failed'; detail: string }
  | { kind: 'too-many-edits'; detail: string }
  | { kind: 'invalid-edit'; detail: string }
  | { kind: 'unresolvable'; detail: string }
  | { kind: 'verification'; detail: string };

export class TextEditUnsafeError extends Error {
  readonly reasons: TextEditUnsafeReason[];
  constructor(reasons: TextEditUnsafeReason[]) {
    super(
      `Refusing to export the edited document.\n${reasons
        .map((reason) => `  - ${reason.kind}: ${reason.detail}`)
        .join('\n')}`,
    );
    this.name = 'TextEditUnsafeError';
    this.reasons = reasons;
  }
}
