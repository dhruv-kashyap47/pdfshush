/**
 * The editor's unsaved-changes predicate.
 *
 * Kept pure so the rule can be tested without a DOM. The document object is a
 * snapshot: any object or form-value change produces a new one, and a
 * successful save stores that exact snapshot. Comparing snapshots is therefore
 * precise, and -- unlike "there is at least one form value" -- it goes back to
 * clean once the saved values are the current ones.
 */

import type { EditorDoc } from '@/lib/editor-state';

export interface EditorDirtyInput {
  doc: EditorDoc;
  /** Snapshot last written, or null before the first successful save. */
  saved: EditorDoc | null;
  /** True while an inline paragraph edit exists only in its textarea. */
  paragraphEditActive: boolean;
  /** Page order differs from the order the document was opened with. */
  pageOrderDirty: boolean;
  /** Number of redaction marks awaiting a rebuild. */
  redactMarkCount: number;
}

export function editorIsDirty(input: EditorDirtyInput): boolean {
  const hasDocChanges =
    input.saved !== input.doc &&
    (input.doc.objects.length > 0 || Object.keys(input.doc.formValues).length > 0);
  return (
    hasDocChanges ||
    input.paragraphEditActive ||
    input.pageOrderDirty ||
    input.redactMarkCount > 0
  );
}
