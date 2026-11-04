/**
 * AI surface copy, kept free of the workspace implementation.
 *
 * The manual editor needs one sentence from this file for its frontispiece. It
 * used to import it from `ai-workspace.tsx`, which dragged the whole studio --
 * provider protocols, planner, assistant loop -- into every editor route. Copy
 * is data; it must not carry an engine.
 */

import type { CoverMark } from '@/components/ai/ai-cover';

/** Which AI surface this is; only the copy, the skill and the extra panel differ. */
export type AiToolVariant = 'summarize' | 'chat' | 'edit';

export interface VariantCopy {
  /** Two display lines for the frontispiece. Keep each under ~22 characters. */
  title: [string, string];
  lead: string;
  note: string;
  quote: string;
  marginTitle: string;
  marks: CoverMark[];
  placeholder: string;
  suggestions?: string[];
  rail: { title: string; hint: string; emptyLead: string };
}

export const COPY: Record<AiToolVariant, VariantCopy> = {
  summarize: {
    title: ['A summary,', 'with its sources.'],
    lead: 'A grounded summary with clickable page citations. Every claim points at the page it came from.',
    note: 'Read on this device; only the text you ask about reaches your provider.',
    quote: 'Every claim keeps its page.',
    marginTitle: 'What it does',
    marks: [
      { icon: 'read', label: 'Read every page', detail: 'The document text, in reading order.' },
      { icon: 'cite', label: 'Cite the source', detail: 'Each claim carries its page number.' },
      { icon: 'ask', label: 'Ask a follow-up', detail: 'The conversation keeps its context.' },
    ],
    placeholder: 'Ask a follow-up about this document…',
    rail: {
      title: 'Summary',
      hint: 'Grounded in the page text, with citations.',
      emptyLead: 'Reading the document…',
    },
  },
  chat: {
    title: ['Ask your PDF', 'anything.'],
    lead: 'The assistant reads the document page by page, and every answer carries the pages it used.',
    note: 'Read on this device; only the text you ask about reaches your provider.',
    quote: 'Every answer keeps its page.',
    marginTitle: 'What it does',
    marks: [
      { icon: 'read', label: 'Read the document', detail: 'Page by page, not one guess.' },
      { icon: 'cite', label: 'Cite the page', detail: 'Press a citation to move the stage.' },
      { icon: 'ask', label: 'Keep the thread', detail: 'Follow-ups remember what came before.' },
    ],
    placeholder: 'Ask a question about this PDF…',
    suggestions: [
      'What is this document about?',
      'List every date, amount and name.',
      'Summarize the key points.',
    ],
    rail: {
      title: 'Assistant',
      hint: 'Answers cite the page they used.',
      emptyLead: 'Ask the document a question.',
    },
  },
  edit: {
    title: ['Mark up a PDF', 'in plain English.'],
    lead: 'Describe the change you want. The assistant proposes every mark; you review the ledger before a byte is written.',
    note: 'Parsed here; only the text you ask about reaches your provider.',
    quote: 'Nothing is written until you apply.',
    marginTitle: 'Marks it can make',
    marks: [
      { icon: 'highlight', label: 'Highlight', detail: 'Mark a phrase with a warm wash.' },
      { icon: 'replace', label: 'Rewrite', detail: 'Replace text in the document’s own run.' },
      { icon: 'erase', label: 'Erase', detail: 'Remove a clause, leaving a proof mark.' },
      { icon: 'insert', label: 'Insert', detail: 'Set new text at any point on the page.' },
      { icon: 'reorder', label: 'Reorder', detail: 'Rotate, delete or resequence pages.' },
      { icon: 'stamp', label: 'Stamp', detail: 'Add page numbers or a running header.' },
    ],
    placeholder: 'Describe a change, e.g. “Highlight every date on page 1”.',
    suggestions: ['Highlight every date on page 1', 'Add page numbers', 'Delete the last page'],
    rail: {
      title: 'Notes',
      hint: 'The assistant proposes; you decide.',
      emptyLead: 'Describe the change you want.',
    },
  },
};

/** Shared copy for the AI editor's frontispiece and its in-editor rail. */
export const AI_EDIT_COPY = COPY.edit;
