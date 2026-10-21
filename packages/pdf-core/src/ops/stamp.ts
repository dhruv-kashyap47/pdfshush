/**
 * Text stamping -- powers Page Numbers and Header & Footer.
 *
 * Operates on an already-composed `PDFDocument` so tools can combine it with
 * page selection (extract a range, then stamp only those pages).
 *
 * Templates use `{n}` for the 1-based output page number and `{N}` for the
 * total output page count, so "Page {n} of {N}" works in both tools.
 */

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { displayAngle } from './edit.js';
import { pageGeom, displaySize, viewToPdf } from './geometry.js';

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
  /**
   * When set, called once per page instead of expanding `{n}`/`{N}`.
   *
   * Bates numbering needs a zero-padded, offset value that a template cannot
   * express, and it must not re-implement the placement maths here. Returning
   * an empty string skips that page's region. `pageIndex` is zero-based.
   */
  textFor?: (pageIndex: number, pageCount: number) => string;
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
  const margin = clamp(style.margin ?? DEFAULT_STAMP_STYLE.margin, 0, 200);
  // Colour arrives over postMessage (and later over the public API), so clamp
  // it -- an out-of-range component emits a malformed colour operator.
  const color = {
    r: clamp01(style.color?.r ?? 0.13),
    g: clamp01(style.color?.g ?? 0.13),
    b: clamp01(style.color?.b ?? 0.13),
  };
  const headerText = content.header?.text?.trim() ?? '';
  const footerText = content.footer?.text?.trim() ?? '';
  if (
    !content.header?.textFor &&
    !content.footer?.textFor &&
    headerText.length === 0 &&
    footerText.length === 0
  ) {
    return;
  }

  const progress = createProgressReporter(ctx);
  const font = await doc.embedFont(
    style.bold ?? DEFAULT_STAMP_STYLE.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
  );

  const pages = doc.getPages();
  const total = pages.length;
  for (let i = 0; i < total; i += 1) {
    ctx.throwIfAborted();
    const page = pages[i]!;
    stampPage(
      page,
      {
        header: resolveRegion(content.header, i, total, 'top-center'),
        footer: resolveRegion(content.footer, i, total, 'bottom-center'),
      },
      { font, fontSize, margin, color },
    );
    progress.step(i, total, 'Adding text');
  }
}

/**
 * Turns a template region into this page's text. A `textFor` resolver wins so
 * callers such as Bates numbering keep the placement code below as the single
 * owner of where stamped text lands (including rotated pages).
 */
function resolveRegion(
  region: StampRegion | undefined,
  pageIndex: number,
  pageCount: number,
  fallback: StampPosition,
): ResolvedRegion | undefined {
  if (!region) return undefined;
  const text = region.textFor
    ? region.textFor(pageIndex, pageCount)
    : renderStampTemplate(region.text.trim(), pageIndex + 1, pageCount);
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return { text: trimmed, position: region.position ?? fallback };
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
  // Placement is computed in display space (the visible box, /Rotate applied) and
  // mapped to PDF space. Using the raw MediaBox put headers outside the visible
  // area on CropBox-offset scans and sideways on rotated pages.
  const geom = pageGeom(page);
  const { width: viewWidth, height: viewHeight } = displaySize(geom);
  const angle = degrees(displayAngle(geom));
  for (const region of [regions.header, regions.footer]) {
    if (!region) continue;
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
          ? Math.max(style.margin, viewWidth - style.margin - textWidth)
          : Math.max(0, (viewWidth - textWidth) / 2);
    // Display y grows downward. The baseline of a top row sits one font size plus
    // the margin below the top edge; a bottom row rests just above the bottom edge.
    const y = anchor === 'top' ? style.margin + style.fontSize : viewHeight - style.margin + 2;
    const [px, py] = viewToPdf(geom, x, y);

    page.drawText(region.text, {
      x: px,
      y: py,
      size: style.fontSize,
      font: style.font,
      color: rgb(style.color.r, style.color.g, style.color.b),
      rotate: angle,
    });
  }
}
function clamp(value: number, min: number, max: number): number {
  // NaN and Infinity from an untrusted request would otherwise propagate into the
  // drawing operators; fall back to the lower bound instead.
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}
