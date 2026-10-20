/**
 * Annotation removal -- powers Remove Annotations.
 *
 * Strips presentation annotations (comments, highlights, ink, links...) from
 * every page while keeping form-field widgets: widget annotations are the
 * visible half of an AcroForm field, so deleting them would blank out every
 * fillable form. Flattening (which does remove them) is a separate tool.
 *
 * Operates on an open document and reports what it removed so the UI can say
 * something precise instead of "done".
 */

import { PDFArray, PDFDict, PDFName, type PDFDocument } from '@cantoo/pdf-lib';
import type { PDFObject } from '@cantoo/pdf-lib';

export interface AnnotationRemovalResult {
  /** Pages touched (only those that actually had annotations). */
  pages: number;
  annotations: number;
}

/** Resolves and removes every non-widget annotation from one page dict. */
function stripPageAnnotations(doc: PDFDocument, pageDict: PDFDict): number {
  const annotsRef = pageDict.get(PDFName.of('Annots'));
  if (!annotsRef) return 0;
  const annots = doc.context.lookup(annotsRef);
  if (!(annots instanceof PDFArray)) {
    // A malformed /Annots cannot be honoured; removing it drops the junk.
    pageDict.delete(PDFName.of('Annots'));
    return 0;
  }

  const kept: unknown[] = [];
  let removed = 0;
  for (let i = 0; i < annots.size(); i += 1) {
    const entry = annots.get(i);
    const resolved = entry instanceof PDFDict ? entry : doc.context.lookup(entry);
    if (resolved instanceof PDFDict && resolved.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
      kept.push(entry);
    } else {
      removed += 1;
    }
  }

  if (kept.length === 0) {
    pageDict.delete(PDFName.of('Annots'));
  } else if (removed > 0) {
    pageDict.set(PDFName.of('Annots'), doc.context.obj(kept as PDFObject[]));
  }
  return removed;
}

export function removeAnnotations(doc: PDFDocument): AnnotationRemovalResult {
  let annotations = 0;
  let pages = 0;
  for (const page of doc.getPages()) {
    const removed = stripPageAnnotations(doc, page.node);
    if (removed > 0) {
      annotations += removed;
      pages += 1;
    }
  }
  return { pages, annotations };
}
