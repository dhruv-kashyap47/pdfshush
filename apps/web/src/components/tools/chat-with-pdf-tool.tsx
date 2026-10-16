import { AiWorkspace } from '@/components/ai/ai-workspace';

/** Chat with a PDF: BYOK Q&A grounded in the page text, with page citations. */
export function ChatWithPdfTool() {
  return <AiWorkspace variant="chat" />;
}
