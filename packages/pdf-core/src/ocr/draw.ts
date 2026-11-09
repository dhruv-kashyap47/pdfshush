/**
 * Draws the invisible OCR text layer.
 *
 * `TextRenderingMode.Invisible` emits text operators with `Tr 3`: the glyphs
 * are present in the content stream and extractable by a text layer, but they
 * paint nothing. The raster underneath supplies the visible page.
 *
 * Each run is kept inside the width measured by the recognizer. When the
 * natural width overflows, character spacing compresses the run first; only a
 * pathological overflow shrinks the type, because a smaller size would also
 * shrink the run's height and break the line clustering pdf.js rebuilds.
 */

import { TextRenderingMode, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { OcrPlacement } from './layout.js';

export function drawOcrTextLayer(
  page: PDFPage,
  font: PDFFont,
  placements: readonly OcrPlacement[],
): void {
  for (const placement of placements) {
    if (placement.text.length === 0 || !(placement.width > 0) || !(placement.fontSize > 0)) {
      continue;
    }

    let size = placement.fontSize;
    let characterSpacing: number | undefined;
    const natural = font.widthOfTextAtSize(placement.text, size);
    // Leave 8% of the box empty at the end of the run. Together with the gap
    // reserved in `buildOcrPlacements`, that makes the next word's start
    // unambiguously a space to pdf.js.
    const target = placement.width * 0.92;
    if (natural > target) {
      if (placement.text.length > 1) {
        const needed = (target - natural) / (placement.text.length - 1);
        // More than 12% of an em of negative tracking collapses glyphs into
        // each other; at that point shrinking the type is the less broken
        // option.
        if (needed >= -size * 0.12) {
          characterSpacing = needed;
        } else {
          size = Math.max(1, size * (target / natural));
        }
      } else {
        // A single glyph has no inter-character gap to compress, so shrinking
        // the type is the only way to keep it inside its box.
        size = Math.max(1, size * (target / natural));
      }
    }

    page.drawText(placement.text, {
      x: placement.x,
      y: placement.y,
      size,
      font,
      color: rgb(0, 0, 0),
      renderMode: TextRenderingMode.Invisible,
      ...(characterSpacing !== undefined ? { characterSpacing } : {}),
    });
  }
}
