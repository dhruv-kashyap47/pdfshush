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
import type { TextEditCheck, TextEditVerification } from './types.js';

export interface TextEditExpectation {
  /** Stable label for the check name (usually the edit id). */
  label: string;
  pageIndex: number;
  /** Text that must appear on the page after export. */
  expect: string;
}

export interface TextEditVerificationInput {
  expectedPageCount: number;
  expectations: TextEditExpectation[];
}

/** Collapse whitespace so extraction spacing differences do not cause misses. */
function normalize(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
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
    const runs = await extractTextRuns(bytes, probePages);
    runsByPage = runs.map((pageRuns) => normalize(pageRuns.map((run) => run.text).join(' ')));
    // Read the page count back from the bytes we are about to hand out. The
    // caller's `expectedPageCount` describes the input, so comparing it with
    // itself would make this check vacuous -- the redaction verifier avoids the
    // same mistake by reopening the output.
    pageCount = (await loadPdfDocument(bytes)).getPageCount();
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

  return { ok: checks.every((check) => check.ok), checks };
}
