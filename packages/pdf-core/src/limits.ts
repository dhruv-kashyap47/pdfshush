/**
 * Central resource limits.
 *
 * Everything that decides "can we do this in the browser?" reads from here, so a
 * single constant change retunes the whole product. Client-side processing has
 * no hard ceiling like a server does -- it dies when the tab's JS heap dies -- so
 * these numbers are deliberately conservative.
 */

export const MB = 1024 * 1024;

export const LIMITS = {
  client: {
    /** Largest single file we will parse in a browser tab. */
    maxFileBytes: 100 * MB,
    /** Largest combined size of a multi-file job run in a browser tab. */
    maxTotalBytes: 250 * MB,
    /** Largest document we will process client-side, by page count. */
    maxPages: 500,
    /** Below this device memory we route heavy jobs to the server instead. */
    minDeviceMemoryGb: 4,
    /** Estimated JS heap cost per rendered page thumbnail. */
    bytesPerRenderedPage: 1.5 * MB,
    /** Page counts above this switch thumbnails to a narrower width. */
    thumbnailDegradeAtPages: 120,
    /** Worker count is clamped to this range. */
    minWorkers: 1,
    maxWorkers: 4,
  },
  server: {
    /** Anonymous per-IP daily budget. Phase 3 enforces these in BullMQ. */
    anonymousTasksPerDay: 150,
    anonymousBytesPerDay: 2 * 1024 * MB,
    /** Anonymous per-IP burst rate. */
    anonymousTasksPerMinute: 6,
    maxUploadBytes: 500 * MB,
    /** Files are hard-deleted this long after a job finishes. */
    fileTtlMs: 60 * 60 * 1000,
  },
  job: {
    defaultTimeoutMs: 120_000,
    minTimeoutMs: 15_000,
    maxTimeoutMs: 15 * 60_000,
    /** Extra time granted per page of work, on top of the base timeout. */
    timeoutPerPageMs: 750,
  },
  tool: {
    /** Thumbnail width handed to the page grid tools. */
    thumbnailWidthPx: 160,
    /** Default export width for image conversion. */
    defaultImageWidthPx: 1600,
    /** Cap on overlay objects in a single edit export (payload sanity). */
    maxEditObjects: 2000,
    /** Cap on characters in one text object (wrapping cost is superlinear). */
    maxTextObjectChars: 20_000,
    /** Largest embedded image accepted, in bytes (decompression-bomb guard). */
    maxImageBytes: 12 * MB,
    /** Largest embedded image edge in pixels; also caps decoded RGBA at ~256 MB. */
    maxImagePixels: 8192,
    /** Undo depth. Snapshots share image buffers, so this is cheap. */
    maxHistorySteps: 250,
  },
} as const;

export type Limits = typeof LIMITS;

/** Bytes of RAM we assume a job needs, on top of the file bytes themselves. */
export function estimateWorkingSetBytes(inputBytes: number, pageCount = 1): number {
  return inputBytes + pageCount * LIMITS.client.bytesPerRenderedPage;
}

/**
 * Timeout for a job, derived from its page count and clamped to sane bounds.
 * The `baseMs` parameter is widened to `number` on purpose: with `as const` the
 * literal type of the default would otherwise infect callers.
 */
export function timeoutForPageCount(pageCount: number, baseMs: number = LIMITS.job.defaultTimeoutMs): number {
  const raw = baseMs + Math.max(0, pageCount - 1) * LIMITS.job.timeoutPerPageMs;
  return Math.min(LIMITS.job.maxTimeoutMs, Math.max(LIMITS.job.minTimeoutMs, raw));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(decimals)} ${units[unit]}`;
}