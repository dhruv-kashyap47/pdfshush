/**
 * Main-thread-free redaction verification (PLAN.md §31.6, M5.8).
 *
 * `verifyRedaction` needs pdf.js and pdf-lib. Running it on the `/verify` page's
 * main thread made that lazy route the last app chunk carrying an engine and
 * blocked the UI while the file was rebuilt and inspected. A dedicated worker
 * keeps the engines where they belong and makes the page responsive.
 *
 * The message is one job: bytes in, checks out. The worker is terminated after
 * each verification, so a malformed file cannot leave a worker holding memory.
 */

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  configurePdfjsRuntime,
  verifyRedaction,
  type VerificationCheck,
} from '@pdfshush/pdf-core';

interface VerifyRequest {
  bytes: ArrayBuffer;
  pageCount: number;
}

interface VerifyResponse {
  type: 'pdfshush-verify';
  checks?: VerificationCheck[];
  error?: string;
}

let configured = false;

function ensureRuntime(): void {
  if (configured) return;
  configured = true;
  const base = new URL(import.meta.env.BASE_URL, self.location.origin);
  configurePdfjsRuntime({
    workerSrc,
    cMapUrl: new URL('cmaps/', base).toString(),
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', base).toString(),
  });
}

self.onmessage = async (event: MessageEvent<VerifyRequest>) => {
  const { bytes, pageCount } = event.data;

  try {
    ensureRuntime();
    const result = await verifyRedaction(new Uint8Array(bytes), {
      regions: [],
      expectedPageCount: pageCount,
    });
    const response: VerifyResponse = { type: 'pdfshush-verify', checks: result.checks };
    self.postMessage(response);
  } catch (error) {
    const response: VerifyResponse = {
      type: 'pdfshush-verify',
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};



