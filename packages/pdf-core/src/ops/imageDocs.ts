/**
 * Images -> PDF (JPG to PDF).
 *
 * Only JPEG and PNG are embedded directly: both are native PDF image codecs,
 * so the bytes pass through untouched (no re-encode, no quality loss). Anything
 * else is refused rather than silently decoded and re-compressed -- a browser
 * canvas would also lose the colour profile, and this engine has to run in Node.
 *
 * The page plan is a pure function so the web preview can show exactly where the
 * photo will sit without opening a document.
 */

import { PDFDocument, type PDFImage } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';

export type ImagePageSize = 'a4' | 'letter' | 'image';
export type ImageOrientation = 'auto' | 'portrait' | 'landscape';

export interface ImagesToPdfOptions {
  /** Fixed paper, or "image" to make each page the photo's own size at 72 dpi. */
  pageSize?: ImagePageSize;
  /** For fixed paper: follow the image aspect, or force a direction. */
  orientation?: ImageOrientation;
  /** Margin in points (0..72) on fixed paper. */
  margin?: number;
}

export type ImageKind = 'jpeg' | 'png';

export interface ImagePlacement {
  pageWidthPt: number;
  pageHeightPt: number;
  /** Lower-left corner and drawn size, in PDF points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A4 and Letter in points (portrait). */
const PAGE_SIZES: Record<'a4' | 'letter', readonly [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export const IMAGE_LIMITS = {
  maxImages: 100,
  maxMarginPt: 72,
} as const;

/** Magic-byte sniffing: extensions lie, and a mislabelled file cannot embed. */
export function detectImageKind(data: Uint8Array): ImageKind | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return 'png';
  }
  return null;
}

/**
 * Where one image lands on its page. Uses the page's own pixel size at 72 dpi
 * for "image" paper, and contain-fits (never crops) on fixed paper.
 */
export function planImagePlacement(
  imageWidthPx: number,
  imageHeightPx: number,
  options: ImagesToPdfOptions = {},
): ImagePlacement {
  const width = Math.max(1, imageWidthPx);
  const height = Math.max(1, imageHeightPx);
  const pageSize = options.pageSize ?? 'a4';

  if (pageSize === 'image') {
    return {
      pageWidthPt: width,
      pageHeightPt: height,
      x: 0,
      y: 0,
      width,
      height,
    };
  }

  const portrait = PAGE_SIZES[pageSize];
  const landscape =
    options.orientation === 'landscape' ||
    (options.orientation !== 'portrait' && width > height);
  const pageWidthPt = landscape ? portrait[1] : portrait[0];
  const pageHeightPt = landscape ? portrait[0] : portrait[1];

  const margin = clamp(options.margin ?? 24, 0, IMAGE_LIMITS.maxMarginPt);
  const availableWidth = Math.max(1, pageWidthPt - margin * 2);
  const availableHeight = Math.max(1, pageHeightPt - margin * 2);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  return {
    pageWidthPt,
    pageHeightPt,
    x: (pageWidthPt - drawWidth) / 2,
    y: (pageHeightPt - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

export interface ImagesToPdfResult {
  data: Uint8Array;
  pageCount: number;
}

export interface ImageInput {
  name: string;
  data: Uint8Array;
}

export async function imagesToPdf(
  images: ImageInput[],
  options: ImagesToPdfOptions,
  ctx: JobContext,
): Promise<ImagesToPdfResult> {
  const out = await PDFDocument.create();
  const progress = createProgressReporter(ctx);

  for (let index = 0; index < images.length; index += 1) {
    ctx.throwIfAborted();
    const image = images[index]!;
    const kind = detectImageKind(image.data);
    if (!kind) {
      throw new Error(`"${image.name}" is not a JPEG or PNG image`);
    }

    let embedded: PDFImage;
    try {
      embedded = kind === 'jpeg' ? await out.embedJpg(image.data) : await out.embedPng(image.data);
    } catch {
      // A truncated or corrupt file keeps its magic bytes but has no usable
      // frame; name it instead of failing the whole batch anonymously.
      throw new Error(`"${image.name}" could not be decoded as ${kind === 'jpeg' ? 'JPEG' : 'PNG'}`);
    }

    const placement = planImagePlacement(embedded.width, embedded.height, options);
    const page = out.addPage([placement.pageWidthPt, placement.pageHeightPt]);
    page.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    });

    progress.step(index, images.length, `Placing image ${index + 1} of ${images.length}`);
  }

  const data = await out.save({ useObjectStreams: false });
  return { data, pageCount: images.length };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
