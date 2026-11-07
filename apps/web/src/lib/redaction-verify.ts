/**
 * The user-facing half of D2 (PLAN.md §31.4): the same independent verifier the
 * Redact tool uses before it hands over a file, exposed on a page anyone can
 * point at any PDF.
 *
 * This module does not reimplement any check. It calls `verifyRedaction` in a
 * dedicated worker and translates its raw check names into sentences,
 * downgrading the two checks it cannot honestly decide from bytes alone:
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

import { LIMITS, type VerificationCheck } from '@pdfshush/pdf-core';
import { jobPool } from '@/lib/job-pool';

/** How long a verification worker may hold a file before it is terminated. */
const VERIFY_TIMEOUT_MS = 60_000;

/**
 * Runs the engine verifier in a dedicated worker. The page stays responsive and
 * the pdf.js/pdf-lib modules stay out of every app chunk; only the worker chunk
 * carries them. The worker is terminated after every file.
 */
function runVerificationWorker(
  bytes: Uint8Array,
  pageCount: number,
): Promise<VerificationCheck[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/verify-worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`verification worker timed out after ${VERIFY_TIMEOUT_MS} ms`));
    }, VERIFY_TIMEOUT_MS);
    const finish = (error: Error | null, checks?: VerificationCheck[]) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(checks ?? []);
    };
    worker.onmessage = (event: MessageEvent<{ type?: string; checks?: VerificationCheck[]; error?: string }>) => {
      if (event.data?.type !== 'pdfshush-verify') return;
      if (event.data.error) finish(new Error(event.data.error));
      else finish(null, event.data.checks);
    };
    worker.onerror = (event) => finish(new Error(event.message || 'verification worker crashed'));
    const copy = bytes.slice();
    worker.postMessage({ bytes: copy.buffer, pageCount }, [copy.buffer]);
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
  // Own-property lookup: check names travel through worker messages, and the
  // fallback must apply to inherited keys too rather than returning a function.
  const label = Object.hasOwn(CHECK_LABELS, name) ? CHECK_LABELS[name] : undefined;
  return label ?? name.replaceAll('-', ' ');
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
    checks = await runVerificationWorker(bytes, pageCount ?? 0);
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



