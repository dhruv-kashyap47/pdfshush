/**
 * Types for genuine in-place text editing.
 *
 * pdfshush's original editor was overlay-only: it painted a white box over the
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

/** Editing strategies in descending order of fidelity. */
export type EditStrategy =
  | 'native-object'
  | 'content-stream'
  | 'localized-reconstruction'
  | 'manual-review';

/** How closely an edit preserves the original appearance. */
export type EditFidelity = 'exact' | 'high' | 'approximate' | 'none';

/** One original line and its display-space box. */
export interface TextLineTarget {
  text: string;
  box: TextEditBox;
}

/**
 * Style a native layout edit must make true on the document objects (T-06).
 *
 * Only fields that differ from the original need to be supplied. The engine
 * may substitute a standard face when the document font has no matching
 * weight/style; that is reported as `font-substituted`, never claimed as the
 * original.
 */
export interface TextRunStyle {
  fontSize?: number;
  /** `#rrggbb`. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: 'helvetica' | 'times' | 'courier';
  align?: 'left' | 'center' | 'right';
  /** Clockwise display-space rotation of the text block (T-07/C-10). */
  rotationDeg?: number;
}

/** Reflow parameters supplied by the Phase 1 layout/capability analysis. */
export interface TextReflowRequest {
  /** Available display-space width in points. */
  width: number;
  /** Baseline-to-baseline distance in points. */
  lineHeight: number;
  /** Display-space y of the first baseline. */
  firstBaselineY: number;
  /** Maximum number of lines allowed before the edit is refused. */
  maxLines?: number;
  /** Horizontal offset of every line from the paragraph origin. */
  x?: number;
  /**
   * True when the replacement is deliberately drawn somewhere other than the
   * original line boxes. The native path then moves the rewritten objects to
   * the requested origin; without it, an in-place rewrite keeps the document's
   * own matrix (which is exactly what a text-only edit wants).
   */
  moved?: boolean;
}

/**
 * Multi-line native edit. The engine matches `beforeLines` to existing text
 * objects, measures the replacement in the document's own font, reflows it to
 * `request.width`, rewrites the original lines and creates/removes line objects
 * as needed. This is the path for real paragraph editing.
 */
export interface TextLayoutEdit {
  paragraphId?: string;
  /** Standard family to reload when the original font pointer cannot create lines. */
  fontFamily?: 'helvetica' | 'times' | 'courier';
  beforeLines: TextLineTarget[];
  reflow: TextReflowRequest;
  /** Native style controls; absent means keep the document's own style. */
  style?: TextRunStyle;
}

/** Serialisable font facts returned by capability inspection. */
export interface TextFontDescriptor {
  baseName: string;
  familyName: string;
  embedded: boolean;
  weight: number;
  italicAngle: number;
  flags: number;
  ascent: number;
  descent: number;
  monospace: boolean;
  serif: boolean;
}

/** One existing text object on a page, in display space. */
export interface TextObjectInfo {
  text: string;
  box: TextEditBox;
  fontSize: number;
  /** PDF render mode: 3 = invisible (OCR layer). */
  renderMode: number;
  font: TextFontDescriptor | null;
}

export type TextLayerKind = 'native' | 'ocr' | 'mixed' | 'none';

export interface PageObjectCounts {
  text: number;
  image: number;
  path: number;
  form: number;
  unknown: number;
}

/** Capability snapshot for one page, produced by PDFium. */
export interface PageTextCapability {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  objectCounts: PageObjectCounts;
  textObjects: TextObjectInfo[];
  fonts: TextFontDescriptor[];
  textLayer: TextLayerKind;
  /** True when the page has ink images but no visible text layer. */
  likelyScanned: boolean;
}

export interface DocumentTextCapability {
  pages: PageTextCapability[];
  pdfium: boolean;
  warnings: string[];
}

/** Per-edit strategy/fidelity assessment exposed to the frontend. */
export interface EditCapability {
  strategy: EditStrategy;
  fidelity: EditFidelity;
  missingGlyphs: string[];
  reasons: string[];
  font: {
    descriptor: TextFontDescriptor | null;
    substitute: 'helvetica' | 'times' | 'courier' | null;
    fidelity: EditFidelity;
  };
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
  /** Multi-line paragraph reflow request; when present, the engine uses layout mode. */
  layout?: TextLayoutEdit;
  /** Preferred first strategy; the engine may still demote for safety. */
  strategy?: EditStrategy;
  /**
   * C-07: ask the engine to add its own small patch over a completed removal,
   * hiding antialiased leftovers. Only applied on a near-white background; the
   * report names it and it is never described as redaction.
   */
  coverPolicy?: 'leftover-cover';
}

/** How an individual edit was finally applied. */
export type TextEditMode =
  | 'in-place'
  | 'content-stream'
  | 'fallback'
  | 'manual-review';

export interface TextEditOutcome {
  id: string;
  pageIndex: number;
  mode: TextEditMode;
  /** Present when the edit was not applied natively: why. */
  reason?: string;
  /** Strategy actually attempted first. */
  attempted?: EditStrategy;
  /** Fidelity of the applied result. */
  fidelity?: EditFidelity;
  /** Display-space region the applied edit occupied (used by visual verification). */
  box?: TextEditBox;
  /**
   * C-09: the replacement was drawn as a raster image because no font could
   * encode it. The text is not selectable, and the export verifier must not
   * expect it in the extracted text layer.
   */
  rasterised?: boolean;
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
  /** Edits applied by rewriting a content-stream show operator. */
  contentStream: number;
  /** Edits applied by the pdf-lib overlay fallback. */
  fallback: number;
  /** Edits that were deliberately left for manual review. */
  manualReview: number;
  /** C-07 patches the engine added over a completed removal. */
  covers: number;
  /** Edits drawn as raster images because no font could encode them. */
  rasterised: number;
  /** True when at least one edit was applied without a cosmetic cover. */
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
