/**
 * Redaction types.
 *
 * The shipped strategy is **rasterization-first**: every page is re-rendered,
 * the redaction marks are burned into the pixels, and the document is rebuilt
 * from those images alone. That makes exclusion structural rather than
 * surgical — the output cannot contain a content stream, text layer, annotation,
 * form field or attachment from the original, because none of them are carried
 * across. The disclosed cost is the page's text layer, links and vector quality.
 *
 * A text-preserving engine is a separate, later upgrade; nothing here pretends to
 * be it.
 */

/** A rectangle to destroy, in the editor's display space. */
export interface RedactRegion {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** For the UI and the report only. Never written into the document. */
  label?: string;
}

export interface RedactOptions {
  regions: RedactRegion[];
  /** Opaque mark colour. Defaults to black. */
  fill?: string;
  /** Resolution for the rebuilt pages. Defaults to 150, clamped to 72–300. */
  rasterDpi?: number;
  /**
   * Strings that must not survive anywhere in the output. Optional, and checked
   * against the serialized bytes — the strongest statement available when the
   * caller knows what it destroyed.
   */
  forbiddenStrings?: string[];
  outputName?: string;
}

/** Why the export was refused. Each one is a hard failure, never a warning. */
export type UnsafeReason =
  | { kind: 'rasterize-unavailable'; detail: string }
  | { kind: 'rasterize-failed'; detail: string }
  | { kind: 'too-many-pages'; detail: string }
  | { kind: 'output-too-large'; detail: string }
  | { kind: 'no-regions'; detail: string };

export interface PageReport {
  pageIndex: number;
  regions: number;
  /** Bytes of the sanitized image this page was rebuilt from. */
  imageBytes: number;
  /** How many pixels were burned in. */
  markedPixels: number;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  checks: VerificationCheck[];
}

export interface RedactionReport {
  pages: PageReport[];
  /** Total page-image bytes, i.e. what actually replaced the original content. */
  totalImageBytes: number;
  verification: VerificationResult;
  warnings: string[];
}

export interface RedactResult {
  data: ArrayBuffer;
  name: string;
  pageCount: number;
  report: RedactionReport;
}

export class RedactionUnsafeError extends Error {
  readonly reasons: UnsafeReason[];
  constructor(reasons: UnsafeReason[]) {
    super(
      `Refusing to export: the document could not be rebuilt safely.\n${reasons
        .map((reason) => `  - ${reason.kind}: ${reason.detail}`)
        .join('\n')}`,
    );
    this.name = 'RedactionUnsafeError';
    this.reasons = reasons;
  }
}

export class RedactionVerificationError extends Error {
  readonly verification: VerificationResult;
  constructor(verification: VerificationResult) {
    super(
      `Redaction verification failed — no output is offered.\n${verification.checks
        .filter((check) => !check.ok)
        .map((check) => `  - ${check.name}: ${check.detail}`)
        .join('\n')}`,
    );
    this.name = 'RedactionVerificationError';
    this.verification = verification;
  }
}
