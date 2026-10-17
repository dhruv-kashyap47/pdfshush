import { AiWorkspace } from '@/components/ai/ai-workspace';

/**
 * Edit PDF with AI: ask for changes in plain language, review the queued edits,
 * then apply them through the engine.
 *
 * The model only *proposes*: it reads the document text and queues edits, shown
 * as a review list with a live preview of each change. "Apply" runs them through
 * the existing `edit`, `organize` and `stamp` jobs (each of which validates its
 * own input and output) and hands back a new PDF. Nothing is written until then.
 */
export function EditPdfWithAiTool() {
  return <AiWorkspace variant="edit" />;
}
