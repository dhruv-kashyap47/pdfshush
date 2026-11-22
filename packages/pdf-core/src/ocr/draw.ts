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

import { TextRenderingMode, degrees, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { OcrPlacement } from './layout.js';

/**
 * The page's own /Rotate. Placements are built in display space (what the
 * recognizer saw); a rotated page needs their origin and baseline rotated back
 * into unrotated PDF space, or the invisible words land somewhere else.
 */
export interface OcrLayerTransform {
  rotation: 0 | 90 | 180 | 270;
  /** Unrotated page size in points. */
  pageWidth: number;
  pageHeight: number;
}

/** A placement's target in PDF user space, with its baseline direction. */
export interface OcrPdfPlacement {
  x: number;
  y: number;
  /** Counter-clockwise text angle in degrees. */
  rotationDeg: number;
}

/**
 * Converts a display-space placement. Production passes a converter derived
 * from pdf.js's own viewport transform, which also handles CropBox offsets and
 * any rotation; the simple struct is kept for callers that only have a page.
 */
export type OcrPlacementConverter = (placement: OcrPlacement) => OcrPdfPlacement;

export function drawOcrTextLayer(
  page: PDFPage,
  font: PDFFont,
  placements: readonly OcrPlacement[],
  transform:
    | OcrLayerTransform
    | OcrPlacementConverter = {
    rotation: 0,
    pageWidth: page.getWidth(),
    pageHeight: page.getHeight(),
  },
): void {
  const convert: OcrPlacementConverter =
    typeof transform === 'function'
      ? transform
      : (placement) => ({
          ...rotatePlacement(placement, transform),
          rotationDeg: transform.rotation,
        });
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

    const point = convert(placement);
    page.drawText(placement.text, {
      x: point.x,
      y: point.y,
      size,
      font,
      color: rgb(0, 0, 0),
      renderMode: TextRenderingMode.Invisible,
      ...(point.rotationDeg !== 0 ? { rotate: degrees(point.rotationDeg) } : {}),
      ...(characterSpacing !== undefined ? { characterSpacing } : {}),
    });
  }
}

/** display-space bottom-left point → unrotated PDF user space. */
function rotatePlacement(
  placement: OcrPlacement,
  transform: OcrLayerTransform,
): { x: number; y: number } {
  const { rotation, pageWidth: width, pageHeight: height } = transform;
  switch (rotation) {
    case 90:
      return { x: width - placement.y, y: placement.x };
    case 180:
      return { x: width - placement.x, y: height - placement.y };
    case 270:
      return { x: placement.y, y: height - placement.x };
    default:
      return { x: placement.x, y: placement.y };
  }
}
