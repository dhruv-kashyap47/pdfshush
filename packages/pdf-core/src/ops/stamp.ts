/**
 * Text stamping -- powers Page Numbers and Header & Footer.
 *
 * Operates on an already-composed `PDFDocument` so tools can combine it with
 * page selection (extract a range, then stamp only those pages).
 *
 * Templates use `{n}` for the 1-based output page number and `{N}` for the
 * total output page count, so "Page {n} of {N}" works in both tools.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';

export type StampPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface StampStyle {
  /** Point size, 4..72. Defaults to 10. */
  fontSize?: number;
  /** Distance from the page edge in points. Defaults to 24. */
  margin?: number;
  bold?: boolean;
  /** RGB components 0..1. Defaults to near-black. */
  color?: { r: number; g: number; b: number };
}

export interface StampRegion {
  /** Template with `{n}` / `{N}` placeholders. Empty string skips the region. */
  text: string;
  position?: StampPosition;
}

export interface StampContent {
  header?: StampRegion;
  footer?: StampRegion;
}

export const DEFAULT_STAMP_STYLE: Required<Pick<StampStyle, 'fontSize' | 'margin' | 'bold'>> = {
  fontSize: 10,
  margin: 24,
  bold: false,
};

/** Replaces `{n}` / `{N}` tokens. Plain string ops so it is trivially testable. */
export function renderStampTemplate(template: string, pageNumber: number, pageCount: number): string {
  return template.replaceAll('{n}', String(pageNumber)).replaceAll('{N}', String(pageCount));
}

/** Draws header/footer regions onto every page of an open document. */
export async function stampDocument(
  doc: PDFDocument,
  content: StampContent,
  ctx: JobContext,
  style: StampStyle = {},
): Promise<void> {
  const fontSize = clamp(style.fontSize ?? DEFAULT_STAMP_STYLE.fontSize, 4, 72);
  const margin = Math.max(0, style.margin ?? DEFAULT_STAMP_STYLE.margin);
  // Colour arrives over postMessage (and later over the public API), so clamp
  // it -- an out-of-range component emits a malformed colour operator.
  const color = {
    r: clamp01(style.color?.r ?? 0.13),
    g: clamp01(style.color?.g ?? 0.13),
    b: clamp01(style.color?.b ?? 0.13),
  };
  const headerText = content.header?.text?.trim() ?? '';
  const footerText = content.footer?.text?.trim() ?? '';
  if (headerText.length === 0 && footerText.length === 0) return;

  const progress = createProgressReporter(ctx);
  const font = await doc.embedFont(
    style.bold ?? DEFAULT_STAMP_STYLE.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
  );

  const pages = doc.getPages();
  const total = pages.length;
  for (let i = 0; i < total; i += 1) {
    ctx.throwIfAborted();
    const page = pages[i]!;
    stampPage(page, {
      header: headerText
        ? { text: renderStampTemplate(headerText, i + 1, total), position: content.header?.position ?? 'top-center' }
        : undefined,
      footer: footerText
        ? { text: renderStampTemplate(footerText, i + 1, total), position: content.footer?.position ?? 'bottom-center' }
        : undefined,
    }, { font, fontSize, margin, color });
    progress.step(i, total, 'Adding text');
  }
}

interface ResolvedRegion {
  text: string;
  position: StampPosition;
}

function stampPage(
  page: PDFPage,
  regions: { header?: ResolvedRegion; footer?: ResolvedRegion },
  style: { font: PDFFont; fontSize: number; margin: number; color: { r: number; g: number; b: number } },
): void {
  for (const region of [regions.header, regions.footer]) {
    if (!region) continue;
    const { width: pageWidth, height: pageHeight } = page.getSize();
    let textWidth: number;
    try {
      textWidth = style.font.widthOfTextAtSize(region.text, style.fontSize);
    } catch {
      // Characters the standard font cannot encode (e.g. emoji) -- skip rather
      // than fail the whole job; the text simply does not fit the encoding.
      continue;
    }

    const [anchor, align] = region.position.split('-') as [string, string];
    const x =
      align === 'left'
        ? style.margin
        : align === 'right'
          ? Math.max(style.margin, pageWidth - style.margin - textWidth)
          : Math.max(0, (pageWidth - textWidth) / 2);
    // drawText places the baseline: top rows sit just under the top edge, bottom
    // rows rest just above the bottom edge.
    const y = anchor === 'top' ? pageHeight - style.margin - style.fontSize : Math.max(0, style.margin - 2);

    page.drawText(region.text, {
      x,
      y,
      size: style.fontSize,
      font: style.font,
      color: rgb(style.color.r, style.color.g, style.color.b),
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
