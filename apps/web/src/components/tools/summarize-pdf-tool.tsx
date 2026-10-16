import { AiWorkspace } from '@/components/ai/ai-workspace';

const SUMMARIZE_PROMPT = [
  'Summarize this document for someone who has not read it.',
  'Start with a two-sentence overview, then list the key points as short bullets.',
  'Cite the pages that matter most as [page N]. Keep it under 250 words.',
].join(' ');

/** Summarize a PDF: one grounded summary pass over the extracted text. */
export function SummarizePdfTool() {
  return <AiWorkspace variant="summarize" autoPrompt={SUMMARIZE_PROMPT} />;
}
