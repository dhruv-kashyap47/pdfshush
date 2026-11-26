/**
 * Surfaces archived with the server tier (2026-11-26).
 *
 * The pages stay reachable — links and search results should land on an honest
 * answer, not a 404 — but they are absent from the catalog, menus and sitemap.
 * The copy says "not available on this deployment", never "coming soon": the
 * code exists in `archive/`, and it returns when a paid host returns.
 */

export interface ArchivedCopy {
  /** Head metadata: the page must say "archived" before a click, not after. */
  title: string;
  description: string;
  what: string;
  why: string;
  alternative?: { slug: string; note: string } | { note: string };
}

export const ARCHIVED_COPY: Record<string, ArchivedCopy> = {
  workflows: {
    title: 'PDF Workflows - Archived on This Deployment | PDFShush',
    description:
      'Workflow recipes need the archived server tier, so they are not available here. All 48 individual PDF tools still run locally in your browser with no upload.',
    what: 'chains several tools into one recipe and runs the chain on new files automatically.',
    why: 'A workflow run executes on a server job queue. This deployment has no server tier: it runs one Cloudflare Worker with no Redis and no PDF worker, so the recipe runner is archived rather than offered and left to fail. Every individual tool still runs in your browser.',
    alternative: {
      slug: 'batch-run',
      note: 'applies one browser-side operation to a whole folder of PDFs, with no upload.',
    },
  },
  api: {
    title: 'PDF REST API - Archived on This Deployment | PDFShush',
    description:
      'The public REST API is archived with the server tier and not available on this deployment. Use the browser tools directly instead; nothing is uploaded.',
    what: 'exposes the tool catalog as a public REST API with keys, quotas and job polling.',
    why: 'The public API needs server-side PDF execution and a durable job store. Both lived in the archived Express/BullMQ tier. The Worker has no canvas and a 10 ms CPU budget per request, so it cannot honestly pretend to run those jobs.',
    alternative: {
      note: 'Use a tool page directly: all 48 live tools run in your browser, and the download is immediate.',
    },
  },
  mcp: {
    title: 'PDF MCP Server - Archived on This Deployment | PDFShush',
    description:
      'The MCP bridge calls the archived REST API, so it is not available here. Chat with a PDF in the browser instead, with your own key or the managed trial.',
    what: 'lets an AI agent drive the PDF tools over the Model Context Protocol.',
    why: 'The MCP bridge calls the public REST API, which is part of the archived server tier. Shipping a client that can only call a missing API would be a broken promise, so the page says so.',
    alternative: {
      slug: 'chat-with-pdf',
      note: 'reads the document you choose and answers questions in the browser, with BYOK or the managed trial.',
    },
  },
};
