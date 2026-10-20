/**
 * Watermarking -- one mark (text or image) drawn over every page, centred or
 * tiled, rotated and semi-transparent.
 *
 * Operates on an already-composed `PDFDocument` so callers can combine it with
 * page selection. Placement maths runs entirely in DISPLAY space (the same
 * helpers the stamp op uses), with a single `viewToPdf` conversion of the
 * mark's centre -- so CropBox-offset scans and rotated pages come out exactly
 * where the user expects, and the user's angle is relative to what they see.
 *
 * Every numeric option is clamped: values arrive over postMessage (and later
 * the public API) unsanitised, and a `fontSize: 9999` emits malformed
 * operators -- the exact defect the P0/P1 audit caught in stamps.
 */

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage } from '@cantoo/pdf-lib';
import type { PDFPage } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { displayAngle } from './edit.js';
import { displaySize, pageGeom, viewToPdf, type PageGeom } from './geometry.js';

export type WatermarkMode = 'text' | 'image';
export type WatermarkPlacement = 'center' | 'tile';

export interface WatermarkSpec {
  mode: WatermarkMode;
  /** Text mode: non-empty string (standard-font requirement enforced above). */
  text?: string;
  /** Image mode: PNG or JPEG bytes. */
  image?: { data: Uint8Array; type?: string };
  /** Mark width as a fraction of the shorter displayed side. 0.05..0.9. */
  imageScale?: number;
  /** Text mode point size, 6..144. Defaults to 48. */
  fontSize?: number;
  /** The angle the user sees, in degrees, -180..180. Defaults to -45. */
  rotation?: number;
  /** 0.02..1. Defaults to 0.2. */
  opacity?: number;
  /** RGB components 0..1 (text only). Defaults to 50% grey. */
  color?: { r: number; g: number; b: number };
  placement?: WatermarkPlacement;
}

export const DEFAULT_WATERMARK = {
  fontSize: 48,
  rotation: -45,
  opacity: 0.2,
  imageScale: 0.35,
  placement: 'center' as WatermarkPlacement,
} as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);

/** A standard font cannot encode astral-plane characters (emoji) -- reject explicitly. */
function isEmojiOnly(text: string): boolean {
  return [...text].every((char) => (char.codePointAt(0) ?? 0) > 0xffff);
}

/**
 * Draws the watermark on every page. Throws when neither a usable text nor a
 * usable image was supplied -- the job layer validates options first; this is
 * the belt to those braces.
 */
export async function watermarkDocument(
  doc: PDFDocument,
  spec: WatermarkSpec,
  ctx: JobContext,
): Promise<void> {
  const fontSize = clamp(Math.round(spec.fontSize ?? DEFAULT_WATERMARK.fontSize), 6, 144);
  const rotation = clamp(spec.rotation ?? DEFAULT_WATERMARK.rotation, -180, 180);
  const opacity = clamp01(spec.opacity ?? DEFAULT_WATERMARK.opacity);
  const imageScale = clamp(spec.imageScale ?? DEFAULT_WATERMARK.imageScale, 0.05, 0.9);
  const place: WatermarkPlacement = spec.placement ?? DEFAULT_WATERMARK.placement;
  const textColour = {
    r: clamp01(spec.color?.r ?? 0.5),
    g: clamp01(spec.color?.g ?? 0.5),
    b: clamp01(spec.color?.b ?? 0.5),
  };

  let font: PDFFont | undefined;
  let text: string | undefined;
  let image: PDFImage | undefined;
  if (spec.mode === 'image' && spec.image?.data?.length) {
    try {
      image = await doc.embedPng(spec.image.data);
    } catch {
      try {
        image = await doc.embedJpg(spec.image.data);
      } catch {
        throw new Error('Watermark image must be a PNG or JPEG file');
      }
    }
  } else if (spec.mode === 'text') {
    text = (spec.text ?? '').trim();
    if (!text) throw new Error('Enter watermark text');
    if (isEmojiOnly(text)) throw new Error('Watermark text must contain normal characters');
    font = await doc.embedFont(StandardFonts.HelveticaBold);
  } else {
    throw new Error('Enter watermark text or choose an image');
  }

  const progress = createProgressReporter(ctx);
  const pages = doc.getPages();

  /** One mark centred on a display-space point of `page`. */
  function drawMark(page: PDFPage, geom: PageGeom, vx: number, vy: number, markWidth: number, markHeight: number): void {
    const [px, py] = viewToPdf(geom, vx, vy);
    // Total drawn angle in PDF space = the page's display orientation plus the
    // user's angle (both CCW, PDF y-up).
    const angle = displayAngle(geom) + rotation;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    if (image) {
      // drawImage pivots at its lower-left origin; subtract the rotated
      // half-extents so the mark lands centred on the point:
      // origin = centre − R(θ)·(w/2, h/2).
      const offsetX = (cos * markWidth - sin * markHeight) / 2;
      const offsetY = (sin * markWidth + cos * markHeight) / 2;
      page.drawImage(image, {
        x: px - offsetX,
        y: py - offsetY,
        width: markWidth,
        height: markHeight,
        rotate: degrees(angle),
        opacity,
      });
      return;
    }

    if (font && text) {
      const measured = font.widthOfTextAtSize(text, fontSize);
      // The baseline sits ~36% of the point size above the visual middle
      // (approximate cap-height/2 for the Helvetica stack), so the whole
      // visible glyph run is centred, not just the baseline.
      const ascent = fontSize * 0.36;
      page.drawText(text, {
        x: px - (cos * measured) / 2 + sin * ascent,
        y: py - (sin * measured) / 2 - cos * ascent,
        size: fontSize,
        font,
        rotate: degrees(angle),
        opacity,
        color: rgb(textColour.r, textColour.g, textColour.b),
      });
      return;
    }
  }

  for (let i = 0; i < pages.length; i += 1) {
    ctx.throwIfAborted();
    const page = pages[i]!;
    const geom = pageGeom(page);
    const { width: viewWidth, height: viewHeight } = displaySize(geom);

    let markWidth: number;
    let markHeight: number;
    if (image) {
      markWidth = Math.min(viewWidth, viewHeight) * imageScale;
      markHeight = markWidth * (image.height / image.width);
    } else {
      markWidth = font!.widthOfTextAtSize(text ?? '', fontSize);
      markHeight = fontSize * 1.35;
    }

    if (place === 'center') {
      drawMark(page, geom, viewWidth / 2, viewHeight / 2, markWidth, markHeight);
    } else {
      // Grid of centres covering the whole page; generous spacing so marks do
      // not collide on wide tiles.
      const stepX = Math.max(markWidth * 1.35, 96);
      const stepY = Math.max(markHeight * 1.35, 72);
      const columns = Math.max(1, Math.ceil(viewWidth / stepX));
      const rows = Math.max(1, Math.ceil(viewHeight / stepY));
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const vx = ((col + 0.5) * viewWidth) / columns;
          const vy = ((row + 0.5) * viewHeight) / rows;
          drawMark(page, geom, vx, vy, markWidth, markHeight);
        }
      }
    }
    progress.step(i, pages.length, 'Applying watermark');
  }
}
