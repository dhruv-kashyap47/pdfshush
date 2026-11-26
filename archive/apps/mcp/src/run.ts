/**
 * One tool call = one whole job lifecycle: validate locally against the
 * contract, submit inline, poll to a terminal status, then fetch and attach
 * the outputs. Nothing touches the filesystem -- outputs come back as MCP
 * content blocks (embedded base64 resource when small enough to be useful in
 * context, otherwise a link the *user* can download with their key).
 */

import { fetchJobState, fetchResult, submitJob, ApiError } from './api.js';
import type { McpConfig } from './config.js';
import { apiCreateJobSchema } from '@pdfshush/api-contracts';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './poll-constants.js';

export interface CallOutcome {
  isError: boolean;
  /** The lead text block: a compact machine-readable envelope, not prose. */
  envelope: string;
  /** Extra content blocks: embedded output files, or links to them. */
  files: ContentBlock[];
}

export type ContentBlock =
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string };

/** Bigger than this an output is a download, not an inline blob (context cost). */
const INLINE_OUTPUT_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** And even individually-inlineable files stop being attached past this sum. */
const INLINE_OUTPUT_TOTAL_MAX_BYTES = 8 * 1024 * 1024;

export async function runToolCall(
  config: McpConfig,
  slug: string,
  args: Record<string, unknown>,
): Promise<CallOutcome> {
  const payload = { ...args, slug };
  const parsed = apiCreateJobSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      isError: true,
      envelope: JSON.stringify({
        error: 'the call was rejected locally, before any upload',
        code: 'validation_failed',
        path: first?.path?.join('.'),
        message: first?.message,
        hint: 'files is 1-50 × {name, data(base64 PDF bytes)}; check the pdfshush://guide/<slug> resource',
      }),
      files: [],
    };
  }

  let created: Awaited<ReturnType<typeof submitJob>>;
  try {
    created = await submitJob(config, parsed.data);
  } catch (err) {
    return apiOutcome(err, 'submitting');
  }

  const state = await poll(config, created.jobId);
  if (state.status !== 'completed') {
    return {
      isError: state.status === 'failed',
      envelope: JSON.stringify({
        jobId: created.jobId,
        status: state.status,
        ...(state.error ? { error: state.error } : {}),
        ...(state.pageCount !== undefined ? { pageCount: state.pageCount } : {}),
        hint:
          state.status === 'failed'
            ? 'the job failed inside the pipeline; the error message names the reason'
            : `still in progress; poll GET ${apiUrl(config, `/api/v1/jobs/${created.jobId}`)} with the key`,
      }),
      files: [],
    };
  }

  try {
    const result = await fetchResult(config, created.jobId);
    if (result.kind === 'file') {
      const name = created.files[0]?.name ?? 'output.pdf';
      return {
        isError: false,
        envelope: JSON.stringify({
          jobId: created.jobId,
          status: 'completed',
          files: [{ name, bytes: result.bytes.length, inline: canInline(result.bytes.length, result.bytes.length) }],
          ...(state.pageCount !== undefined ? { pageCount: state.pageCount } : {}),
        }),
        files: [fileBlock(config, created.jobId, { name, bytes: result.bytes.length, url: '' }, {
          contentType: result.contentType,
          data: result.bytes,
        })],
      };
    }
    return await listingOutcome(config, created.jobId, state, result.files);
  } catch (err) {
    // Completed but the result could not be fetched (expired mid-call is the
    // realistic case): still a truthful answer, not a red herring.
    return {
      isError: false,
      envelope: JSON.stringify({
        jobId: created.jobId,
        status: 'completed',
        ...(state.pageCount !== undefined ? { pageCount: state.pageCount } : {}),
        retrieval: 'failed',
        error: err instanceof Error ? err.message : String(err),
        hint: `the result window may have elapsed; re-run the tool, or GET ${apiUrl(config, `/api/v1/jobs/${created.jobId}/result`)}`,
      }),
      files: [],
    };
  }
}

/**
 * The multi-output case: the listing carries per-file URLs. Inline what fits
 * the context budget; what does not fit becomes an honest link block plus a
 * single instruction -- never a silent omission.
 */
async function listingOutcome(
  config: McpConfig,
  jobId: string,
  state: { pageCount?: number },
  listing: { name: string; bytes: number; url: string }[],
): Promise<CallOutcome> {
  const total = listing.reduce((sum, f) => sum + f.bytes, 0);
  const inline = canInline(total, Math.max(...listing.map((f) => f.bytes), 0));
  const files: ContentBlock[] = [];
  for (const entry of listing) {
    if (inline) {
      const url = new URL(entry.url, config.baseUrl);
      if (sameOrigin(url, config)) {
        const response = await fetch(url, { headers: { 'x-api-key': config.apiKey } });
        if (response.ok) {
          const data = Buffer.from(await response.arrayBuffer());
          files.push(fileBlock(config, jobId, entry, {
            contentType: response.headers.get('content-type') ?? 'application/pdf',
            data,
          }));
          continue;
        }
      }
      // Download failed (or foreign origin): degrade to a link, don't fail.
    }
    files.push(fileBlock(config, jobId, entry, undefined, inline));
  }
  return {
    isError: false,
    envelope: JSON.stringify({
      jobId,
      status: 'completed',
      files: listing.map((f) => ({
        name: f.name,
        bytes: f.bytes,
        inline: inline && sameOrigin(safeUrl(f.url, config) ?? config.baseUrl, config),
      })),
      ...(state.pageCount !== undefined ? { pageCount: state.pageCount } : {}),
      ...(inline
        ? {}
        : {
            hint: `inline budget exceeded (${listing.length} files, ${total} bytes); download via the links with the x-api-key header, or GET ${apiUrl(config, `/api/v1/jobs/${jobId}/result`)}`,
          }),
    }),
    files,
  };
}

/** The inline decision: each file within the per-file cap and the sum within the total cap. */
function canInline(totalBytes: number, largestFileBytes: number): boolean {
  return totalBytes <= INLINE_OUTPUT_TOTAL_MAX_BYTES && largestFileBytes <= INLINE_OUTPUT_FILE_MAX_BYTES;
}

interface OutputBytes {
  contentType: string;
  data: Buffer;
}

function fileBlock(
  config: McpConfig,
  jobId: string,
  entry: { name: string; bytes: number; url: string },
  output: OutputBytes | undefined,
  forceLink = false,
): ContentBlock {
  const downloadUrl = output_url(config, jobId, entry);
  if (!forceLink && output && output.data.length <= INLINE_OUTPUT_FILE_MAX_BYTES) {
    return {
      type: 'resource',
      resource: {
        uri: downloadUrl,
        mimeType: output.contentType,
        blob: output.data.toString('base64'),
      },
    };
  }
  return { type: 'resource_link', uri: downloadUrl, name: entry.name };
}

/** The deployment's own download URL for this output (fetchable with the key). */
function output_url(
  config: McpConfig,
  jobId: string,
  entry: { name: string; url: string },
): string {
  if (entry.url) {
    const resolved = safeUrl(entry.url, config);
    if (resolved && sameOrigin(resolved, config)) return resolved.toString();
  }
  return apiUrl(config, `/api/v1/jobs/${encodeURIComponent(jobId)}/result/files/${encodeURIComponent(entry.name)}`);
}

function apiUrl(config: McpConfig, path: string): string {
  const base = config.baseUrl.toString().replace(/\/+$/, '');
  return `${base}${path}`;
}

function safeUrl(raw: string, config: McpConfig): URL | undefined {
  try {
    return new URL(raw, config.baseUrl);
  } catch {
    return undefined;
  }
}

/** A foreign origin in a listing is not ours to fetch; link at most. */
function sameOrigin(url: URL, config: McpConfig): boolean {
  return url.origin === config.baseUrl.origin;
}

/** Polls the job to a terminal status with a capped budget. */
async function poll(
  config: McpConfig,
  jobId: string,
): Promise<{ status: string; pageCount?: number; error?: { message: string; code?: string } }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let delay = POLL_INTERVAL_MS;
  for (;;) {
    const state = await fetchJobState(config, jobId);
    if (state.status === 'completed' || state.status === 'failed') return state;
    if (Date.now() + delay > deadline) {
      return {
        status: 'in-progress',
        error: {
          message:
            `the job did not finish within ${Math.round(POLL_TIMEOUT_MS / 1000)}s ` +
            '(it may still complete; poll the status URL with the key)',
        },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 2000);
  }
}

/** Maps client-side API failures to a tool result with repair instructions. */
function apiOutcome(err: unknown, stage: string): CallOutcome {
  if (err instanceof ApiError) {
    return {
      isError: true,
      envelope: JSON.stringify({
        error: err.message,
        code: err.code,
        at: stage,
        hint:
          err.code === 'unauthorized'
            ? 'the PDFSHUSH_API_KEY was rejected; create a fresh key on the account dashboard'
            : err.code === 'quota_exceeded'
              ? 'this key or its account is out of budget for now; wait for the window the API names in Retry-After'
              : 'check the pdfshush://guide/<slug> resource and the OpenAPI document',
      }),
      files: [],
    };
  }
  return {
    isError: true,
    envelope: JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      at: stage,
    }),
    files: [],
  };
}
