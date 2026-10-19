/**
 * The MCP server assembly (§25.4): one tool per server-runnable slug, the
 * `pdfshush://tools` catalog resource, a `pdfshush://guide/<slug>` resource
 * per slug, and startup instructions that keep the model honest about what
 * this server is -- a thin, key-carrying stand-in for the REST API.
 *
 * Local stdio only: no HTTP listener, no disk, no state. The instructions are
 * deliberately modest: the model does not need a lecture, it needs the
 * submit → poll → download shape and where the option vocabulary lives.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SERVER_SLUGS } from '@pdfshush/api-contracts';
import { fetchCatalog } from './api.js';
import type { McpConfig } from './config.js';
import { guideFor } from './guides.js';
import type { ContentBlock, CallOutcome } from './run.js';
import { runToolCall } from './run.js';
import { toolDescriptors } from './tools.js';

export const SERVER_VERSION = '1.0.0';
export const SERVER_NAME = 'pdfshush';

export const INSTRUCTIONS = [
  'PDFShush: run PDF tools (merge, split/organize, page numbers & stamps, n-up, edit, inspect) on a real PDFShush deployment.',
  'One tool per capability. Every call submits inline base64 PDFs (max 10 MB decoded per file, max 50 files), waits for the job, and returns the outputs: embedded resources when they fit an agent context, download links otherwise.',
  'Before constructing `options`, read the matching pdfshush://guide/<slug> resource -- the vocabulary there is what the server accepts; anything else is rejected as validation_failed.',
  'Passwords travel in the `password` argument once for all files, never inline in text.',
  'Outputs are deleted after the retention window; do not poll a job indefinitely -- the tool already waits up to four minutes.',
].join('\n');

interface RuntimeContext {
  config: McpConfig;
  /** Fetched once at startup; empty when the deployment was unreachable. */
  labels: Record<string, string>;
  limits: Record<string, number>;
}

async function loadLabels(config: McpConfig): Promise<Record<string, number | string> & Record<string, string>> {
  // The catalog needs a valid key and no scope; a failure is not fatal -- the
  // server still registers the contract-pinned tools and lets a call surface
  // the deployment's own verdict.
  try {
    const catalog = await fetchCatalog(config);
    const out: Record<string, string> = {};
    for (const tool of catalog.tools) {
      if (tool.slug && tool.label) out[tool.slug] = tool.label;
    }
    for (const [key, value] of Object.entries(catalog.limits ?? {})) {
      if (typeof value === 'number') out[`limit_${key}`] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export async function createMcpServer(config: McpConfig): Promise<McpServer> {
  const labels = await loadLabels(config);
  const inlineCap = Number(labels['limit_maxInlineFileBytes'] ?? 10 * 1024 * 1024);
  const ctx: RuntimeContext = { config, labels, limits: {} };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  for (const tool of toolDescriptors(labels)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: `PDFShush "${tool.title}" over /api/v1 -- submit PDFs inline (base64), wait, get outputs. See the pdfshush://guide/${tool.slug} resource for options.`,
        inputSchema: tool.shape,
        annotations: { readOnlyHint: tool.readonly, openWorldHint: false },
      },
      async (args) => {
        const outcome = await runToolCall(ctx.config, tool.slug, (args ?? {}) as Record<string, unknown>);
        return toResult(outcome);
      },
    );
  }

  server.registerResource(
    'Catalog of runnable PDF tools',
    'pdfshush://tools',
    {
      description: 'The slugs this deployment runs with labels and the key quota tier. Fresh from the API when reachable.',
      mimeType: 'text/plain',
    },
    async (uri) => {
      let text: string;
      try {
        const catalog = await fetchCatalog(ctx.config);
        const lines = catalog.tools.map((t) => `${t.slug}${t.label ? ` — ${t.label}` : ''}`);
        const limits = Object.entries(catalog.limits ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        text = `PDFShush tools (live from the deployment):\n${lines.map((l) => `- ${l}`).join('\n')}\nQuota per key — ${limits}`;
      } catch (err) {
        text =
          `The deployment could not be reached (${err instanceof Error ? err.message : String(err)}), ` +
          `so this is the client's contract list: ${SERVER_SLUGS.join(', ')}`;
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
    },
  );

  for (const slug of SERVER_SLUGS) {
    const guide = guideFor(slug, labels, inlineCap);
    if (!guide) continue;
    server.registerResource(
      guide.title,
      `pdfshush://guide/${slug}`,
      { description: `How to call "${slug}": payload shape and the options vocabulary the engine reads.`, mimeType: 'text/plain' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: guide.text }] }),
    );
  }

  return server;
}

function toResult(outcome: CallOutcome): {
  isError: boolean;
  content: ({ type: 'text'; text: string } | ContentBlock)[];
} {
  return {
    isError: outcome.isError,
    content: [{ type: 'text' as const, text: outcome.envelope }, ...outcome.files],
  };
}

/** Serves on stdin/stdout until the client closes the transport. */
export async function serveStdio(config: McpConfig): Promise<void> {
  const server = await createMcpServer(config);
  await server.connect(new StdioServerTransport());
}
