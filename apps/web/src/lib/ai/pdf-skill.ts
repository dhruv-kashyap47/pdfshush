/**
 * The PDF reading skill: system prompt + tools the agent uses to answer
 * questions about one uploaded document. Ported in spirit from the donor app's
 * pdf-skill, trimmed to the read-only operations PDFShush ships first.
 */

import type { AgentToolCall, AgentSkill, ToolExecution } from '@pdfshush/ai-agent';
import type { AiDocument } from './pdf-session';

const MAX_PAGES_PER_READ = 12;
const MAX_CHARS_PER_READ = 24_000;
const MAX_SEARCH_HITS = 20;
const MAX_SNIPPET = 240;

export interface PdfSkillOptions {
  /** Called when the model jumps to a page, so the UI can show it. */
  onGotoPage?(page: number): void;
}

const pageLabel = (index: number): string => `[page ${index + 1}]`;

export function createPdfSkill(doc: AiDocument, options: PdfSkillOptions = {}): AgentSkill {
  const pageCount = doc.pages.length;

  const clampPage = (raw: unknown): number | null => {
    const n = typeof raw === 'number' ? Math.floor(raw) : Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(pageCount, Math.max(1, n));
  };

  return {
    id: 'pdf',
    systemPrompt: [
      'You are a careful PDF assistant. The only way you can see the document is through the tools.',
      `The document has ${pageCount} page(s).`,
      'Rules:',
      '- Read the relevant pages before answering; never invent content.',
      '- Cite what you used as [page N] (1-based) right after each claim.',
      '- If the answer is not in the document, say so plainly instead of guessing.',
      '- Keep answers concise. Quote short excerpts when the exact wording matters.',
    ].join('\n'),
    tools: [
      {
        name: 'get_document',
        description: 'Get the document file name and page count.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'read_pages',
        description: `Read the text of an inclusive, 1-based page range. At most ${MAX_PAGES_PER_READ} pages per call.`,
        inputSchema: {
          type: 'object',
          properties: {
            start: { type: 'integer', description: 'First page (1-based)' },
            end: { type: 'integer', description: 'Last page (1-based, inclusive)' },
          },
          required: ['start', 'end'],
          additionalProperties: false,
        },
      },
      {
        name: 'search_text',
        description: 'Find pages containing a word or phrase (case-insensitive) and return snippets.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text to find' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
      {
        name: 'goto_page',
        description: 'Show a page to the user in the preview pane.',
        inputSchema: {
          type: 'object',
          properties: {
            page: { type: 'integer', description: 'Page to show (1-based)' },
          },
          required: ['page'],
          additionalProperties: false,
        },
      },
    ],
    buildContext() {
      return `Document: ${doc.fileName} (${pageCount} pages).`;
    },
    executeTool(call: AgentToolCall): ToolExecution {
      const input = call.input ?? {};
      switch (call.name) {
        case 'get_document':
          return { output: `${doc.fileName}\nPages: ${pageCount}`, summary: 'Document info' };

        case 'read_pages': {
          const start = clampPage(input.start);
          const end = clampPage(input.end);
          if (start === null || end === null) {
            return { output: 'start and end must be page numbers.', isError: true, summary: 'read_pages' };
          }
          const from = Math.min(start, end);
          const to = Math.min(Math.max(start, end), from + MAX_PAGES_PER_READ - 1);
          const parts: string[] = [];
          let chars = 0;
          for (let page = from; page <= to; page += 1) {
            const text = doc.pages[page - 1] ?? '';
            const block = `${pageLabel(page - 1)}\n${text || '(no extractable text on this page)'}`;
            if (chars + block.length > MAX_CHARS_PER_READ) break;
            chars += block.length;
            parts.push(block);
          }
          return {
            output: parts.join('\n\n') || '(no text in that range)',
            summary: `Read pages ${from}\u2013${to}`,
          };
        }

        case 'search_text': {
          const query = typeof input.query === 'string' ? input.query.trim() : '';
          if (!query) return { output: 'query is required.', isError: true, summary: 'search_text' };
          const needle = query.toLowerCase();
          const hits: string[] = [];
          for (let page = 0; page < pageCount && hits.length < MAX_SEARCH_HITS; page += 1) {
            const text = doc.pages[page] ?? '';
            const at = text.toLowerCase().indexOf(needle);
            if (at < 0) continue;
            const from = Math.max(0, at - 60);
            hits.push(`${pageLabel(page)} \u2026${text.slice(from, at + MAX_SNIPPET)}\u2026`);
          }
          return {
            output: hits.length ? hits.join('\n') : `No page contains "${query}".`,
            summary: `Search "${query}" (${hits.length} hit${hits.length === 1 ? '' : 's'})`,
          };
        }

        case 'goto_page': {
          const page = clampPage(input.page);
          if (page === null) {
            return { output: 'page must be a page number.', isError: true, summary: 'goto_page' };
          }
          options.onGotoPage?.(page);
          return { output: `Showing page ${page}.`, summary: `Jump to page ${page}` };
        }

        default:
          return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name };
      }
    },
  };
}
