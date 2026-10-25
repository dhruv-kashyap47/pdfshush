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
    /**
     * Public REST API tier (PLAN.md §25.3, decision D6). Quota is measured
     * against the *key*, with the account as a ceiling over all of its keys.
     * Anonymous numbers above stay untouched: an API key is deliberately a
     * reduced-cost machine quota, not an upgrade to anonymous limits.
     */
    api: {
      /** Per-key burst rate, submissions per minute. */
      tasksPerMinute: 30,
      /** Per-key daily task budget. */
      tasksPerDay: 500,
      /** Per-key daily upload allowance. */
      bytesPerDay: 5 * 1024 * MB,
      /** Account-level ceilings, shared by every key on the account. */
      accountTasksPerDay: 2_000,
      accountBytesPerDay: 10 * 1024 * MB,
      /** How many API keys one account may hold. */
      maxKeysPerAccount: 10,
      /**
       * Largest file accepted *inline* as base64 in a JSON job body (D7).
       * Agents pass payloads through context, not just the wire, so inline is a
       * convenience path; anything larger rides the multipart form.
       */
      maxInlineFileBytes: 10 * MB,
    },
  },
  job: {
    defaultTimeoutMs: 120_000,
    minTimeoutMs: 15_000,
    maxTimeoutMs: 15 * 60_000,
    /** Extra time granted per page of work, on top of the base timeout. */
    timeoutPerPageMs: 750,
    /**
     * Most memory one job is allowed to say it will need. `estimate()` is the
     * contract's own answer to "how big is this", and the server runner refuses a
     * job that exceeds this before it runs -- see `apps/api/src/jobs/runner.ts`.
     * Sized above the worst legitimate case for the default upload cap (a 500 MB
     * input through a x3 job estimates 1.5 GB), so it rejects runaway work, not
     * merely large work. Pair it with the worker's `WORKER_CHILD_MAX_OLD_SPACE_MB`.
     */
    maxWorkingSetBytes: 1536 * MB,
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
    /** In-place text edits in one request. Bounds the PDFium rewrite. */
    maxTextEdits: 500,
    /** Cap on either side of a single text edit (find + replace). */
    maxTextEditChars: 20_000,
    /** Redaction regions in one request. A bound on the rewrite's cost. */
    maxRedactRegions: 500,
    /**
     * Pages one redaction run may rebuild.
     *
     * Rasterization is linear in pages and every page is a full bitmap, so this
     * ceiling is what stops a large document from becoming a tab-killer rather
     * than a redaction.
     */
    maxRedactPages: 150,
    /** Largest redacted file we will hand back. Refused above this. */
    maxRedactOutputBytes: 100 * MB,
    /**
     * Files one Combine run may stitch together. Matches the API upload cap so
     * the browser and the server accept the same request.
     */
    maxCombineFiles: 50,
    /** Entries one ZIP may carry -- bounds a batch output and the name list. */
    maxZipEntries: 100,
    /** Bookmark/section entries a document outline may contain after reading. */
    maxOutlineEntries: 2000,
    /** Parts Split by bookmarks may produce from one outline. */
    maxBookmarkParts: 200,
  },
  workflow: {
    /** Steps in one saved recipe. Bounds a stored document and its UI. */
    maxSteps: 20,
    /** Recipe name length, after trimming. */
    maxNameChars: 80,
    /** Step id length, after trimming. */
    maxStepIdChars: 64,
  },
  ai: {
    /** Per-account managed daily token allowance (managed mode only). */
    managedDailyTokens: 200_000,
    /** Per-IP anonymous trial allowance (managed mode only). */
    managedAnonDailyTokens: 20_000,
    /** Managed requests one subject may start per minute. */
    managedRequestsPerMinute: 6,
    /** Output-token ceiling for one managed turn. */
    managedMaxOutputTokens: 4096,
    /** Characters of document text one browser AI run may hold. */
    clientMaxContextChars: 400_000,
    /** Model round-trips one browser agent run may take. */
    clientMaxTurns: 24,
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