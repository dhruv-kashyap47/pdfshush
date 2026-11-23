/**
 * Honest copy for per-page editing capability (E-10).
 *
 * The capability facts come from a PDFium inspection of the page as it was
 * loaded, plus any OCR layer added later in this session. They are a *snapshot*:
 * a page can gain a text layer after OCR, and a document reloaded from source
 * re-runs the inspection. The copy here says that instead of promising that a
 * page will always be editable.
 */

import type { PageTextCapability } from '@pdfshush/pdf-core';

/** Shown beside the capability facts so the snapshot cannot be mistaken for a promise. */
export const CAPABILITY_SNAPSHOT_NOTE =
  'Page facts are a snapshot from the last inspection (page load, OCR or page edit); they are not a permanent promise about the document.';

export interface OcrConfidenceSnapshot {
  confidence: number;
}

function inspected(sentence: string): string {
  return `${sentence}, as inspected.`;
}

/** Short label for the detection-details drawer. */
export function textLayerLabel(capability: PageTextCapability | null): string {
  if (!capability) return 'Not inspected yet';
  if (capability.likelyScanned) return 'No text layer (image-only page), as inspected';
  if (capability.textLayer === 'ocr') return 'OCR layer (invisible text), as inspected';
  if (capability.textLayer === 'mixed') return 'Mixed visible/invisible text, as inspected';
  return 'Native document text, as inspected';
}

/** Status line for the Document panel. */
export function describePageEditStatus(
  capability: PageTextCapability | null,
  ocr: OcrConfidenceSnapshot | null,
): string {
  if (!capability) return 'Inspecting fonts and page objects.';
  if (capability.likelyScanned) {
    return inspected('Image-only page. Text can be marked, but there is no text layer to rewrite');
  }
  if (capability.textLayer === 'ocr') {
    return ocr
      ? `Invisible OCR text layer, as inspected · ${Math.round(
          ocr.confidence,
        )}% mean confidence. Check the text before relying on it.`
      : 'Invisible OCR text layer, as inspected. Confidence was not recorded in this session; check the text before relying on it.';
  }
  if (capability.textLayer === 'mixed') {
    return inspected('Mixed visible and invisible text layer. Native edits are available where the fonts allow');
  }
  return inspected('Document text objects and fonts. Edits are rewritten in place where possible');
}

/** One-line status above the selected text block. */
export function describeParagraphEditStatus(capability: PageTextCapability | null): string {
  if (!capability) return 'Inspecting fonts and page objects.';
  if (capability.likelyScanned) {
    return 'Manual review: image-only page has no text layer, as inspected';
  }
  if (capability.textLayer === 'ocr') {
    return 'Native edit: invisible OCR text layer (render mode preserved), as inspected';
  }
  if (capability.textLayer === 'mixed') {
    return 'Native edit: mixed visible/invisible text layer, as inspected';
  }
  return 'Native edit: document text objects and fonts, as inspected';
}
