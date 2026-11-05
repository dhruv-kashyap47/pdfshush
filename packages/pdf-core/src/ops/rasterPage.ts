/**
 * Add one rasterized page whose JPEG fills the whole page box.
 *
 * Embedding an image and adding a blank page is not enough: pdf-lib keeps the
 * image object but the page never references it, so the saved document renders
 * blank. That exact bug shipped in the grayscale, dark-mode and strong-compress
 * rebuilds; this helper is the one place the image is both embedded and drawn.
 */

import type { PDFDocument } from '@cantoo/pdf-lib';

export async function addRasterPage(
  out: PDFDocument,
  jpeg: Uint8Array,
  widthPt: number,
  heightPt: number,
): Promise<void> {
  const image = await out.embedJpg(jpeg);
  const page = out.addPage([widthPt, heightPt]);
  page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
}
