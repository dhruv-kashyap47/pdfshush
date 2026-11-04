/**
 * One vocabulary for job failures.
 *
 * The engine throws honest, specific errors, but they arrive at the UI through a
 * worker boundary that flattens the class identity (the receiver rebuilds a
 * plain `Error` and copies `name`, `message`, `stack` and `issues`). Components
 * then render `toast.error(outcome.message)`, which meant a user could see
 * "Invalid input" with the actionable part of the message dropped, or a generic
 * library string with no next step at all.
 *
 * This module classifies an error once, by stable code, and pairs it with
 * human copy that says what happened and what to do. It deliberately does not
 * hide the engine's own sentence: when the engine already named the cause (a
 * page limit, an unreadable file, a wrong password) that sentence is the most
 * useful part of the message.
 *
 * Classification is by `name` first and message pattern second, because the
 * name survives the worker hop but `instanceof` does not.
 */

import { isAbortError, type ValidationIssue } from '@pdfshush/pdf-core';

export type JobErrorCode =
  | 'encrypted'
  | 'damaged'
  | 'unsupported'
  | 'too-large'
  | 'timeout'
  | 'cancelled'
  | 'canvas-unavailable'
  | 'ai'
  | 'network'
  | 'validation'
  /** The engine refused to produce output because it could not verify safety. */
  | 'refused'
  | 'internal';

export interface JobErrorInfo {
  code: JobErrorCode;
  /**
   * Complete, human-facing sentence(s), safe to render as a toast as-is. It
   * includes the next step, because most call sites only render this field.
   */
  message: string;
  /**
   * The same next step, structured for surfaces that want it separately (an
   * error panel with a retry button, a receipt). Never needed to make `message`
   * make sense.
   */
  action?: string;
  /** True when running the same job again might plausibly succeed. */
  retryable: boolean;
  /** The engine's own message, preserved for logs and a "details" view. */
  detail: string;
  /** Field-level validation issues, when the engine supplied them. */
  issues?: ValidationIssue[];
}

export interface DescribeJobErrorOptions {
  /**
   * The job slug, when known. Only used to decide whether a generic failure
   * belongs to the AI path; a damaged file on an AI tool is still `damaged`.
   */
  slug?: string;
}

const AI_SLUGS = new Set(['summarize-pdf', 'chat-with-pdf', 'edit-pdf-with-ai']);

const REFUSAL_NAMES = new Set([
  'RedactionUnsafeError',
  'RedactionVerificationError',
  'TextEditUnsafeError',
  'TextEditVerificationError',
]);

const ENCRYPTED_RE = /password protected|incorrect password|needs? (?:a )?password|is encrypted/i;
const REFUSAL_RE = /refusing to (?:export|apply)|verification failed|could not be (?:rebuilt|verified) safely/i;
const CANVAS_RE = /canvas|rasteriz|offscreen|createRasterizer/i;
const TOO_LARGE_RE =
  /at most \d+|limited to \d+|limit (?:is|of) \d+|too many|too large|larger than|over the .{0,20}limit|exceeds? (?:the )?.{0,20}(?:limit|cap|maximum)|would create \d+ files|maximum (?:of )?\d+/i;
const DAMAGED_RE =
  /invalid (?:pdf|file|object|structure)|not a pdf|could not be (?:read|decoded|opened|parsed)|cannot (?:read|parse|open|decode)|failed to (?:parse|load|decode)|damaged|corrupt|truncated|xref|has no pages|no pages were produced|unexpected end|not a (?:jpeg|jpg|png) image/i;
const NETWORK_RE =
  /failed to fetch|network ?error|network request|load failed|offline|econn|http (?:4|5)\d\d|status (?:4|5)\d\d/i;
const UNSUPPORTED_RE =
  /not supported|unsupported|does not support|isn't supported|cannot handle|only (?:jpe?g|png|pdf)|no ocr|ocr (?:is )?(?:not|unavailable)|missing font|font .{0,20}(?:not embedded|missing)|linearized/i;
const TIMEOUT_RE = /timed out|timeout/i;

/**
 * Classifies `error` and builds the user-facing copy.
 *
 * Pure and synchronous; it never logs, renders or mutates the error.
 */
export function describeJobError(
  error: unknown,
  options: DescribeJobErrorOptions = {},
): JobErrorInfo {
  const detail = messageOf(error);
  const name = error instanceof Error ? error.name : '';
  const issues = issuesOf(error);
  const code = classify(name, detail, issues, options.slug);
  const { message, action } = copyFor(code, detail, issues);

  return {
    code,
    // The action is folded in because every existing call site renders only
    // `message`. A toast that says what failed but not what to do is the dead
    // end this taxonomy exists to remove; the structured copy above stays for
    // surfaces that can render a real button.
    message: action ? `${terminated(message)} ${action}` : message,
    retryable: RETRYABLE[code],
    detail,
    ...(issues && issues.length > 0 ? { issues } : {}),
    ...(action ? { action } : {}),
  };
}

const RETRYABLE: Record<JobErrorCode, boolean> = {
  encrypted: false,
  damaged: false,
  unsupported: false,
  'too-large': true,
  timeout: true,
  cancelled: false,
  'canvas-unavailable': true,
  ai: true,
  network: true,
  validation: false,
  refused: false,
  internal: true,
};

function classify(
  name: string,
  detail: string,
  issues: ValidationIssue[] | undefined,
  slug: string | undefined,
): JobErrorCode {
  if (name === 'JobAbortedError' || name === 'AbortError') return 'cancelled';
  if (name === 'JobTimeoutError' || TIMEOUT_RE.test(detail)) return 'timeout';

  // Validation is decided by the structured issues, not by prose: every job
  // validation failure carries them, and the worker labels every one "Invalid
  // input" (which is exactly the message that used to reach the toast).
  if (name === 'JobValidationError' || (issues?.length ?? 0) > 0) return 'validation';

  if (name === 'EncryptedDocumentError' || ENCRYPTED_RE.test(detail)) return 'encrypted';
  if (REFUSAL_NAMES.has(name) || REFUSAL_RE.test(detail)) return 'refused';
  if (CANVAS_RE.test(detail)) return 'canvas-unavailable';
  if (TOO_LARGE_RE.test(detail)) return 'too-large';
  if (DAMAGED_RE.test(detail)) return 'damaged';
  if (NETWORK_RE.test(detail)) return 'network';

  // A generic failure on an AI tool is most often the provider (key, quota,
  // model, context window). Only reach this after the engine-specific patterns
  // above, so "not a PDF" on Summarize stays `damaged`.
  if (slug !== undefined && AI_SLUGS.has(slug)) return 'ai';

  if (UNSUPPORTED_RE.test(detail)) return 'unsupported';
  return 'internal';
}

function copyFor(
  code: JobErrorCode,
  detail: string,
  issues: ValidationIssue[] | undefined,
): { message: string; action?: string } {
  switch (code) {
    case 'cancelled':
      return {
        message: 'Cancelled. Nothing was changed.',
        action: 'Run it again when you are ready.',
      };

    case 'encrypted':
      // The engine's sentence is already precise ("Incorrect password for this
      // PDF"), so it becomes the message rather than being wrapped.
      return {
        message: detail || 'This PDF is password protected.',
        action: /incorrect/i.test(detail)
          ? 'Re-enter the password.'
          : 'Unlock the PDF first, or enter its password if this tool asks for one.',
      };

    case 'validation': {
      const parts = (issues ?? []).map((issue) => issue.message.trim()).filter(Boolean);
      // "Invalid input" carries no information; the issues carry all of it.
      const message =
        parts.length > 0
          ? parts.join(' ')
          : detail && detail !== 'Invalid input'
            ? detail
            : 'Some settings need attention.';
      return { message, action: 'Adjust the highlighted settings and run it again.' };
    }

    case 'refused':
      // Refusal messages are multi-line and name the failed checks; wrapping or
      // shortening them would hide the reason the engine declined to export.
      return {
        message: detail || 'The engine refused to produce this output.',
        action: 'Nothing was exported. Adjust the document or settings and try again.',
      };

    case 'too-large':
      return {
        message: sentence('That job is over the in-browser limit.', detail),
        action: 'Reduce the file size or page count, or split the document first.',
      };

    case 'timeout':
      return {
        message: detail || 'The job ran out of time and was stopped.',
        action: 'Try fewer pages or a smaller file — split it first if needed.',
      };

    case 'canvas-unavailable':
      return {
        message: sentence(
          'This tool needs a drawing surface the browser did not provide.',
          detail,
        ),
        action: 'Try a current Chrome, Edge, Firefox or Safari, and close other heavy tabs.',
      };

    case 'ai':
      return {
        message: sentence('The AI request did not complete.', detail),
        action: 'Check your provider key and settings, then try again.',
      };

    case 'network':
      return {
        message: sentence('A network request failed.', detail),
        action: 'Check your connection and try again.',
      };

    case 'damaged':
      return {
        message: sentence('That file could not be read as a PDF.', detail),
        action: 'Re-download or re-export the file, then try again.',
      };

    case 'unsupported':
      return {
        message: sentence(
          'This file uses something the in-browser engine cannot process.',
          detail,
        ),
        action: 'Try a different file, or a desktop tool built for this format.',
      };

    case 'internal':
    default:
      return {
        message: sentence('Something went wrong inside the tool.', detail),
        action: 'Try again. If it keeps failing, the file may use an unsupported structure.',
      };
  }
}

/**
 * Joins a headline with the engine's detail without repeating one in the other.
 * Empty or already-contained detail is dropped, so the caller never sees
 * "Password protected. Password protected."
 */
function sentence(headline: string, detail: string): string {
  const d = detail.trim().replace(/\s+/g, ' ');
  if (!d) return headline;
  const h = headline.toLowerCase().replace(/[.!?]+$/, '');
  const dl = d.toLowerCase();
  if (dl === h || dl.includes(h) || h.includes(dl)) return d;
  return `${headline} ${d}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Makes a fragment safe to join to another sentence. Engine messages often end
 * without punctuation ("This PDF is password protected"), and appending the
 * action directly produced "protected Unlock the PDF...". Multi-line refusal
 * messages end with the last check, so the same rule applies.
 */
function terminated(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function issuesOf(error: unknown): ValidationIssue[] | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;
  const wellFormed = issues.filter(
    (issue): issue is ValidationIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as { message?: unknown }).message === 'string',
  );
  return wellFormed.length > 0 ? wellFormed : undefined;
}

/** Re-exported so tests and callers can use the same abort predicate. */
export { isAbortError };
