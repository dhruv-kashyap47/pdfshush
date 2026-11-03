import { PdfEditorWorkspace } from '@/components/tools/edit-pdf-tool';

/**
 * Edit PDF with AI is the shared editor with the assistant capability active.
 *
 * It loads the same document session, viewport, page rail and history as the
 * manual editor. The assistant only proposes; the review ledger applies through
 * the same engine, and the result panel is the same export surface.
 */
export function EditPdfWithAiTool() {
  return <PdfEditorWorkspace mode="ai" />;
}
