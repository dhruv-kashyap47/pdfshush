/**
 * Post-export verification for in-place text editing.
 *
 * PDFium's `FPDFText_SetText` does not fail when a font cannot encode the new
 * characters: it writes whatever glyphs the font has for those codes, or filler
 * for codes it lacks. Return value `true` therefore means "the call was
 * accepted", not "the words are there". The only honest test is to reopen the
 * *serialized* bytes with an independent reader and look for the replacement.
 *
 * This uses pdf.js -- the same reader the product renders with -- so what
 * verification sees is what a user will see. An edit whose replacement is
 * missing after the round-trip is demoted to the overlay path by the engine.
 */

import { loadPdfDocument } from '../ops/pages.js';
import { extractTextRuns } from '../render/textRuns.js';
import { normalizeForMatch } from './text.js';
import type { TextEditCheck, TextEditVerification } from './types.js';

export interface TextEditExpectation {
  /** Stable label for the check name (usually the edit id). */
  label: string;
  pageIndex: number;
  /** Text that must appear on the page after export. */
  expect: string;
  /**
   * Original run text. When set (and the pre-edit bytes are supplied), verification
   * additionally asserts this text was genuinely consumed rather than merely covered
   * or left in place. Only set it for edits applied in place or through the content
   * stream — an overlay leaves the original extractable underneath, so requiring its
   * absence there would be a false failure.
   */
  find?: string;
  /**
   * Several original strings that must all be absent after a native edit. Used
   * by a reflowed paragraph, where `find` is the whole paragraph and each
   * `beforeLines` entry is the unit that must genuinely disappear. Entries that
   * the replacement reintroduces, or that were not independently countable in
   * the pre-edit document, are skipped exactly like a single `find`.
   */
  finds?: string[];
}

export interface TextEditVerificationInput {
  expectedPageCount: number;
  expectations: TextEditExpectation[];
  /**
   * Pre-edit bytes. Enables the residual-original absence checks: a replacement that
   * is present but leaves the original `find` untouched is a no-op, and a deletion that
   * does not reduce the occurrence count did not happen.
   */
  original?: Uint8Array;
  /** Password for an encrypted document, applied to both the original and output. */
  password?: string;
}

/** Fold ligatures and collapse whitespace so extraction differences do not miss. */
function normalize(text: string): string {
  return normalizeForMatch(text);
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Reopen serialized bytes and confirm every expectation's replacement is
 * present. Throws if pdf.js cannot parse the output -- a document that does not
 * reopen is a failed export, full stop.
 */
export async function verifyTextEdits(
  bytes: Uint8Array,
  input: TextEditVerificationInput,
): Promise<TextEditVerification> {
  const checks: TextEditCheck[] = [];
  const expectationPages = [...new Set(input.expectations.map((expectation) => expectation.pageIndex))].sort(
    (a, b) => a - b,
  );
  // A pure-deletion run has no expectations, but the document must still reopen:
  // probe page 0 so the check is real without extracting every page.
  const probePages = expectationPages.length > 0 ? expectationPages : [0];

  let runsByPage: string[];
  let pageCount: number;
  try {
    const runs = await extractTextRuns(bytes, probePages, undefined, input.password);
    runsByPage = runs.map((pageRuns) => normalize(pageRuns.map((run) => run.text).join(' ')));
    // Read the page count back from the bytes we are about to hand out. The
    // caller's `expectedPageCount` describes the input, so comparing it with
    // itself would make this check vacuous -- the redaction verifier avoids the
    // same mistake by reopening the output.
    pageCount = (
      await loadPdfDocument(bytes, { ...(input.password ? { password: input.password } : {}) })
    ).getPageCount();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      checks: [{ name: 'reopens', ok: false, detail: `the exported document did not load: ${detail}` }],
    };
  }

  checks.push({
    name: 'reopens',
    ok: true,
    detail: `exported ${bytes.byteLength} bytes reopen in pdf.js`,
  });
  checks.push({
    name: 'page-count',
    ok: pageCount === input.expectedPageCount,
    detail: `${pageCount} pages (expected ${input.expectedPageCount})`,
  });

  const textByPage = new Map<number, string>();
  probePages.forEach((pageIndex, i) => textByPage.set(pageIndex, runsByPage[i] ?? ''));

  for (const expectation of input.expectations) {
    const haystack = textByPage.get(expectation.pageIndex) ?? '';
    const needle = normalize(expectation.expect);
    const ok = needle.length === 0 || haystack.includes(needle);
    checks.push({
      name: `replacement-present:${expectation.label}`,
      ok,
      detail: ok
        ? `"${needle}" found on page ${expectation.pageIndex + 1}`
        : `"${needle}" not found on page ${expectation.pageIndex + 1}`,
    });
  }

  // Residual-original checks: an edit that reports success but leaves the original
  // `find` text untouched is a no-op (e.g. the replacement string already existed on
  // the page, or a deletion removed nothing). This is what lets a passing
  // "replacement-present" check be trusted. It needs the pre-edit bytes to compare
  // occurrence counts, and it only applies to edits applied in place / through the
  // content stream (an overlay leaves the original readable underneath).
  //
  // A reflowed paragraph supplies `finds` (its original lines) instead of one
  // `find`: every original line that the replacement does not reintroduce must
  // be gone, which is what proves the paragraph was rewritten rather than partly
  // duplicated.
  interface ResidualTarget {
    label: string;
    /** Name suffix; empty for the single `find` form. */
    suffix: string;
    pageIndex: number;
    find: string;
    expect: string;
  }
  const residual: ResidualTarget[] = [];
  for (const expectation of input.expectations) {
    if (expectation.find !== undefined) {
      residual.push({
        label: expectation.label,
        suffix: '',
        pageIndex: expectation.pageIndex,
        find: expectation.find,
        expect: expectation.expect,
      });
    }
    (expectation.finds ?? []).forEach((find, index) => {
      residual.push({
        label: expectation.label,
        suffix: `:line-${index}`,
        pageIndex: expectation.pageIndex,
        find,
        expect: expectation.expect,
      });
    });
  }
  if (input.original && residual.length > 0) {
    const residualPages = [...new Set(residual.map((target) => target.pageIndex))].sort(
      (a, b) => a - b,
    );
    let originalByPage: string[];
    try {
      const originalRuns = await extractTextRuns(input.original, residualPages, undefined, input.password);
      originalByPage = originalRuns.map((pageRuns) => normalize(pageRuns.map((run) => run.text).join(' ')));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checks.push({
        name: 'residual-original',
        ok: false,
        detail: `the pre-edit document could not be re-read to confirm the original was consumed: ${detail}`,
      });
      originalByPage = [];
    }
    if (originalByPage.length > 0) {
      const originalText = new Map<number, string>();
      residualPages.forEach((pageIndex, i) => originalText.set(pageIndex, originalByPage[i] ?? ''));

      // Classify every residual target first. A target whose replacement
      // reintroduces the original string (or that was not independently
      // countable) is skipped: occurrence counting cannot judge it. Only judged
      // targets may reduce the allowance for other edits. Counting skipped
      // targets as "consumed" made two edits that share a find string fail even
      // when the judged one did remove its occurrence.
      const judged = residual.filter((target) => {
        const before = normalize(target.find);
        const beforeCount = countOccurrences(originalText.get(target.pageIndex) ?? '', before);
        const replacementContainsFind = normalize(target.expect).includes(before);
        return beforeCount > 0 && !replacementContainsFind;
      });

      // How many judged edits on a page consumed the same `find` string. A page
      // that said "Secret" twice and redacted both must end with zero; one that
      // said it twice and redacted a single occurrence must end with one.
      const consumed = new Map<string, number>();
      for (const target of judged) {
        const key = `${target.pageIndex}:${normalize(target.find)}`;
        consumed.set(key, (consumed.get(key) ?? 0) + 1);
      }

      for (const target of residual) {
        const before = normalize(target.find);
        const beforeCount = countOccurrences(originalText.get(target.pageIndex) ?? '', before);
        const after = countOccurrences(textByPage.get(target.pageIndex) ?? '', before);
        // A find string that was already absent, or that the replacement reintroduces
        // as a substring, cannot be judged by occurrence counts. Skip rather than
        // report a misleading pass/fail.
        const replacementContainsFind = normalize(target.expect).includes(before);
        if (beforeCount === 0 || replacementContainsFind) {
          checks.push({
            name: `residual-original:${target.label}${target.suffix}`,
            ok: true,
            // The original text is deliberately not echoed: it is often the very
            // secret being replaced, and verification details can reach logs.
            detail: `skipped: the original run was not independently countable on the pre-edit page ${target.pageIndex + 1}`,
          });
          continue;
        }
        // The original must be consumed: after-count cannot exceed before-count minus
        // the judged edits that removed it. Equality with before-count means nothing
        // was removed -- the edit was a no-op.
        const consumedCount = consumed.get(`${target.pageIndex}:${before}`) ?? 0;
        const maxAllowed = Math.max(0, beforeCount - consumedCount);
        const ok = after <= maxAllowed;
        checks.push({
          name: `residual-original:${target.label}${target.suffix}`,
          ok,
          detail: ok
            ? `the original run reduced from ${beforeCount} to ${after} occurrence(s) on page ${target.pageIndex + 1}`
            : `the original run still appears ${after} time(s) on page ${target.pageIndex + 1} ` +
              `(expected at most ${maxAllowed}); the edit did not consume the original text`,
        });
      }
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}
