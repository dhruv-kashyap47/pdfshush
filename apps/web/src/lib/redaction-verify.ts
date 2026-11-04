/**
 * The user-facing half of D2 (PLAN.md §31.4): the same independent verifier the
 * Redact tool uses before it hands over a file, exposed on a page anyone can
 * point at any PDF.
 *
 * This module does not reimplement any check. It calls `verifyRedaction` and
 * translates its raw check names into sentences, downgrading the two checks it
 * cannot honestly decide from bytes alone:
 *
 *  - `marks-burned-in` needs to know where the marks were. With no regions to
 *    compare against the call passes vacuously, so it is reported as **not
 *    checked** rather than as a pass.
 *  - `page-count` compares the file with itself (the count came from this same
 *    file), so it is information, not evidence.
 *
 * The digest is SHA-256 of the exact bytes. The receipt contains no timestamp,
 * so verifying the same file twice produces the same text; the digest is the
 * identity, and a receipt that changes on every copy is harder to compare.
 */

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  LIMITS,
  configurePdfjsRuntime,
  verifyRedaction,
  type VerificationCheck,
} from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';

let pdfjsConfigured = false;

/**
 * `verifyRedaction` reads the text layer with pdf.js, which needs a worker URL
 * supplied by the host build. The job worker sets this once for every tool; the
 * standalone verifier runs on the main thread, so it sets the same value here
 * instead of silently failing every text check.
 */
function ensurePdfjsRuntime(): void {
  if (pdfjsConfigured || typeof window === 'undefined') return;
  pdfjsConfigured = true;
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  configurePdfjsRuntime({
    workerSrc,
    cMapUrl: new URL('cmaps/', base).toString(),
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', base).toString(),
  });
}

export type UserCheckStatus = 'pass' | 'fail' | 'n/a' | 'info';

export interface UserCheck {
  /** Engine check name, kept for support and for tests. */
  name: string;
  label: string;
  status: UserCheckStatus;
  detail: string;
}

export interface UserVerification {
  digest: string;
  byteLength: number;
  pageCount: number | null;
  checks: UserCheck[];
  /** Every applicable check passed. */
  ok: boolean;
  failed: number;
  notChecked: number;
}

/** Check names that the verifier cannot decide without the original marks. */
const NOT_CHECKED = new Set(['marks-burned-in']);
/** Checks that report a fact rather than a pass/fail verdict. */
const INFORMATIONAL = new Set(['page-count']);

export const CHECK_LABELS: Record<string, string> = {
  parses: 'Reloads as a PDF',
  'page-count': 'Page count',
  'no-annotations': 'No annotations remain',
  'pages-are-single-images': 'Each page is one image',
  'page-images-substantial': 'Page images are full size',
  'content-has-no-text-operators': 'No text-drawing operators',
  'marks-burned-in': 'Marks burned into pixels',
  'page-not-blank': 'Content survives outside the marks',
  'no-attachments': 'No embedded files',
  'metadata-stripped': 'No document metadata',
  'text-extractable': 'Text layer could be read',
  'no-extractable-text': 'No extractable text',
  'forbidden-strings-absent': 'Forbidden strings absent',
};

export function labelForCheck(name: string): string {
  return CHECK_LABELS[name] ?? name.replaceAll('-', ' ');
}

/**
 * Maps one engine check to what the page shows. Exported because the mapping is
 * the part most likely to drift when the engine grows a check.
 */
export function classifyCheck(check: VerificationCheck): UserCheck {
  const label = labelForCheck(check.name);
  if (NOT_CHECKED.has(check.name)) {
    return {
      name: check.name,
      label,
      status: 'n/a',
      detail:
        'Not checked: this verifier was not given the marked areas, so it cannot compare them with the pixels.',
    };
  }
  if (INFORMATIONAL.has(check.name)) {
    return { name: check.name, label, status: 'info', detail: check.detail };
  }
  return {
    name: check.name,
    label,
    status: check.ok ? 'pass' : 'fail',
    detail: check.detail,
  };
}

export function summarizeVerification(
  checks: VerificationCheck[],
  meta: { digest: string; byteLength: number; pageCount: number | null },
): UserVerification {
  // When the pages are not single images, the image checks have nothing to
  // measure and pass vacuously. Reporting "Page images are full size: PASS"
  // beside "Each page is one image: FAIL" would be a contradiction the user has
  // to resolve; downgrade the vacuous passes to "not checked" instead.
  const pagesAreImages = checks.find((check) => check.name === 'pages-are-single-images');
  const imageDependent = new Set(['page-images-substantial', 'page-not-blank']);

  const mapped = checks.map((check) => {
    if (pagesAreImages?.ok === false && imageDependent.has(check.name) && check.ok) {
      return {
        name: check.name,
        label: labelForCheck(check.name),
        status: 'n/a' as const,
        detail:
          'Not checked: at least one page is not a single image, so there is no page image to measure.',
      };
    }
    return classifyCheck(check);
  });

  const failed = mapped.filter((check) => check.status === 'fail').length;
  return {
    ...meta,
    checks: mapped,
    ok: failed === 0,
    failed,
    notChecked: mapped.filter((check) => check.status === 'n/a').length,
  };
}

/** Lower-case hex SHA-256 of the exact bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Probes the page count in the job worker. Returns `null` when the file cannot
 * be read; the verifier then reports the parse failure rather than inventing a
 * count.
 */
export async function probePageCount(bytes: Uint8Array, name: string): Promise<number | null> {
  try {
    const result = await jobPool.run<{ documents: { pageCount: number }[] }>(
      'inspect',
      [{ name, type: 'application/pdf', data: bytes.slice() }],
      {},
      { timeoutMs: 30_000 },
    );
    return result.documents[0]?.pageCount ?? null;
  } catch {
    return null;
  }
}

export interface VerifyUserRedactionOptions {
  /** Defaults to the upload's name; the receipt never includes a path. */
  name?: string;
}

/**
 * Verifies arbitrary bytes. The verifier requires an expected page count, which
 * is probed from the same file first -- and then reported as information, not
 * as a check, because a file cannot disagree with itself.
 */
export async function verifyUserRedaction(
  bytes: Uint8Array,
  options: VerifyUserRedactionOptions = {},
): Promise<UserVerification> {
  if (bytes.byteLength > LIMITS.client.maxFileBytes) {
    throw new Error(
      `This verifier handles files up to ${Math.round(LIMITS.client.maxFileBytes / (1024 * 1024))} MB. This one is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB.`,
    );
  }

  const [digest, pageCount] = await Promise.all([
    sha256Hex(bytes),
    probePageCount(bytes, options.name ?? 'document.pdf'),
  ]);

  let checks: VerificationCheck[];
  try {
    ensurePdfjsRuntime();
    const result = await verifyRedaction(bytes, {
      regions: [],
      expectedPageCount: pageCount ?? 0,
    });
    checks = result.checks;
  } catch (error) {
    checks = [
      {
        name: 'parses',
        ok: false,
        detail: `the verifier could not read the bytes: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  // A page count we could not probe turns the informational row into a failure
  // of the file, not of the file's page count. Drop the tautological row.
  if (pageCount === null) {
    checks = checks.filter((check) => check.name !== 'page-count');
  }

  return summarizeVerification(checks, { digest, byteLength: bytes.byteLength, pageCount });
}

/** Human receipt, stable for a given file. */
export function formatReceipt(verification: UserVerification): string {
  const verdict = verification.ok
    ? 'CLEAN - no retained text, annotations, attachments or metadata found'
    : `CONTENT REMAINS - ${verification.failed} check(s) failed`;

  const lines = [
    'PDFShush redaction verification',
    '',
    `SHA-256  ${verification.digest}`,
    `Bytes    ${verification.byteLength}`,
    `Pages    ${verification.pageCount ?? 'unreadable'}`,
    `Verdict  ${verdict}`,
    '',
    ...verification.checks.map((check) => {
      const tag =
        check.status === 'pass'
          ? 'PASS'
          : check.status === 'fail'
            ? 'FAIL'
            : check.status === 'n/a'
              ? 'N/A '
              : 'INFO';
      return `${tag}  ${check.label}: ${check.detail}`;
    }),
    '',
    'No timestamp: the SHA-256 identifies the file, and the same file always produces this receipt.',
  ];

  return lines.join('\n');
}

