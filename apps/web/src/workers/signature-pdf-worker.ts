/**
 * PDF assembly for signature export.
 *
 * pdf-lib is deliberately confined to this worker: the bundle-boundary check
 * forbids a PDF engine in any app chunk, and a signature PDF is small enough
 * that the round trip costs less than the engine's download.
 *
 * The page is built from the exact PNG the image flow rendered, so "Fit" and
 * "A4" differ only in placement, never in ink.
 */

import { PDFDocument } from '@cantoo/pdf-lib';
import type { SignaturePdfPage } from '@/lib/signature-export';

interface SignaturePdfRequest {
  type: 'pdfshush-signature-pdf';
  /** PNG bytes; transparent pixels are preserved in the embedded image. */
  png: ArrayBuffer;
  /** Final rendered size in CSS pixels. */
  width: number;
  height: number;
  page: SignaturePdfPage;
}

interface SignaturePdfResponse {
  type: 'pdfshush-signature-pdf';
  bytes?: ArrayBuffer;
  error?: string;
}

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const A4_MARGIN_PT = 48;
/** "Around 200pt wide", with a height cap so a tall mark stays on the page. */
const A4_SIGNATURE_WIDTH_PT = 200;
const A4_SIGNATURE_MAX_HEIGHT_PT = 260;
const PX_TO_PT = 0.75;

self.onmessage = async (event: MessageEvent<SignaturePdfRequest>) => {
  const request = event.data;
  if (request?.type !== 'pdfshush-signature-pdf') return;

  try {
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(request.png);

    let pageWidth: number;
    let pageHeight: number;
    let drawWidth: number;
    let drawHeight: number;
    let x: number;
    let y: number;

    if (request.page === 'a4') {
      pageWidth = A4_WIDTH_PT;
      pageHeight = A4_HEIGHT_PT;
      drawWidth = A4_SIGNATURE_WIDTH_PT;
      drawHeight = (drawWidth * request.height) / request.width;
      if (drawHeight > A4_SIGNATURE_MAX_HEIGHT_PT) {
        const shrink = A4_SIGNATURE_MAX_HEIGHT_PT / drawHeight;
        drawWidth *= shrink;
        drawHeight = A4_SIGNATURE_MAX_HEIGHT_PT;
      }
      x = A4_MARGIN_PT;
      y = A4_MARGIN_PT;
    } else {
      // "Fit" is the image's own page: CSS pixels to PDF points at 96 DPI.
      pageWidth = request.width * PX_TO_PT;
      pageHeight = request.height * PX_TO_PT;
      drawWidth = pageWidth;
      drawHeight = pageHeight;
      x = 0;
      y = 0;
    }

    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });

    const saved = await pdf.save();
    const copy = saved.slice();
    const response: SignaturePdfResponse = {
      type: 'pdfshush-signature-pdf',
      bytes: copy.buffer as ArrayBuffer,
    };
    self.postMessage(response);
  } catch (error) {
    const response: SignaturePdfResponse = {
      type: 'pdfshush-signature-pdf',
      error: error instanceof Error ? error.message : 'The PDF could not be built.',
    };
    self.postMessage(response);
  }
};
