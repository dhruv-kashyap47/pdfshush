/**
 * Client-side capacity guard.
 *
 * Decides whether a job can run in this browser tab. We refuse with a clear
 * message rather than attempting work that will kill the tab -- a crashed tab
 * loses the user's files, which is the one failure mode a privacy tool can
 * never have.
 */

import { LIMITS, MB, formatBytes } from '@pdfshush/pdf-core';

export type CapacityVerdict =
  | { ok: true; warning?: string }
  | { ok: false; message: string };

export interface CapacityInput {
  fileCount: number;
  totalBytes: number;
  largestFileBytes?: number;
  pageCount?: number;
}

export function checkClientCapacity(input: CapacityInput): CapacityVerdict {
  if (input.fileCount === 0) return { ok: true };

  const largest = input.largestFileBytes ?? input.totalBytes;

  if (largest > LIMITS.client.maxFileBytes) {
    return {
      ok: false,
      message:
        `That file is ${formatBytes(largest)}, over our ${formatBytes(LIMITS.client.maxFileBytes)} ` +
        'in-browser limit. We could try anyway, but a browser tab would run out of memory partway ' +
        'through and you would lose your work. Server-side processing for oversized files arrives soon.',
    };
  }

  if (input.totalBytes > LIMITS.client.maxTotalBytes) {
    return {
      ok: false,
      message:
        `These files add up to ${formatBytes(input.totalBytes)}, over the ` +
        `${formatBytes(LIMITS.client.maxTotalBytes)} in-browser limit. ` +
        'Try processing them in smaller batches.',
    };
  }

  if (input.pageCount !== undefined && input.pageCount > LIMITS.client.maxPages) {
    return {
      ok: false,
      message:
        `That document has ${input.pageCount.toLocaleString()} pages; the in-browser limit is ` +
        `${LIMITS.client.maxPages.toLocaleString()}. Split it first, or wait for server processing.`,
    };
  }

  const deviceMemoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (deviceMemoryGb !== undefined && deviceMemoryGb < LIMITS.client.minDeviceMemoryGb) {
    return {
      ok: true,
      warning:
        `This device reports ${deviceMemoryGb} GB of memory. Large files may run slowly or fail ` +
        'on machines like this.',
    };
  }

  return { ok: true };
}

/** Convenience for estimates shown in the UI. */
export function estimateMemoryLabel(bytes: number, pageCount?: number): string {
  const total = bytes + (pageCount ?? 0) * LIMITS.client.bytesPerRenderedPage;
  return formatBytes(Math.min(total, 64 * 1024 * MB));
}