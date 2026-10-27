/**
 * Compress PDF -- three honest strategies, no magic.
 *
 * `smart` is the default. It re-encodes the embedded images that can be
 * re-encoded safely (8-bit DeviceRGB / DeviceGray JPEG and Flate streams) while
 * leaving text, links, forms, annotations and vector content completely alone.
 * Images referenced by a soft mask, a colour-key mask or `/Decode` are left
 * untouched: changing those can break transparency or invert a scan. A
 * candidate is only replaced when the new JPEG is at least 3% smaller, so the
 * pass never trades quality for a few bytes.
 *
 * `lossless` re-serializes with object streams: text and images survive
 * byte-for-byte, but the engine cannot deduplicate or re-encode content it does
 * not understand, so already-optimized files may not shrink at all.
 *
 * `raster` rebuilds each page as a JPEG at a chosen resolution and quality --
 * the same rasterize-and-rebuild contract secure redaction and grayscale use.
 * It is what makes scanned/photographic documents genuinely smaller, and it
 * flattens text into pixels. The UI discloses that before the run; the job
 * enforces the same page ceiling as redaction.
 *
 * Browser-only for `smart` and `raster` (they need `OffscreenCanvas`);
 * `lossless` runs anywhere pdf-lib does.
 */

import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from '@cantoo/pdf-lib';
import type { PDFDict, PDFObject } from '@cantoo/pdf-lib';
import { createProgressReporter, type JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { classifyImageStream, isImageStream } from '../ops/images.js';
import { loadPdfDocument } from '../ops/pages.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToCanvas } from '../render/renderPage.js';

export type CompressMode = 'smart' | 'raster' | 'lossless';

export interface CompressOptions {
  mode?: CompressMode;
  /** JPEG quality for the smart and raster paths, 0.3..1. */
  quality?: number;
  /** Target resolution for the raster path, 72..300 dpi. */
  dpi?: number;
}

export interface CompressResult {
  data: Uint8Array;
  pageCount: number;
  mode: CompressMode;
  /** Smart mode: image XObjects that were replaced with smaller JPEGs. */
  imagesOptimized?: number;
  /** Smart mode: image XObjects left untouched (unsupported, masked or no gain). */
  imagesSkipped?: number;
  /** Smart mode: total bytes occupied by image streams before the pass. */
  imageBytesBefore?: number;
  /** Smart mode: total bytes occupied by image streams after the pass. */
  imageBytesAfter?: number;
}

export const COMPRESS_DEFAULTS = {
  // Smart is the safe default: it helps photographic documents without
  // flattening text, links or forms.
  mode: 'smart' as CompressMode,
  quality: 0.72,
  dpi: 150,
};

export const COMPRESS_LIMITS = {
  minQuality: 0.3,
  maxQuality: 1,
  minDpi: 72,
  maxDpi: 300,
  /** Longest edge we keep when re-encoding an image without a soft mask. */
  smartMaxEdge: 3000,
  /** Refuse images whose decoded bitmap would be too large for a worker tab. */
  smartMaxPixels: 16_000_000,
  /** Stop after this many image objects; the rest stay byte-identical. */
  smartMaxImages: 200,
  /** Don't replace an image unless the new JPEG saves at least this much. */
  smartMinSavings: 0.03,
} as const;

const SMART_COLOR_SPACES = new Set(['DeviceRGB', 'DeviceGray']);

export async function compressDocument(
  data: Uint8Array,
  options: CompressOptions,
  ctx: JobContext,
  password?: string,
): Promise<CompressResult> {
  const mode = options.mode ?? COMPRESS_DEFAULTS.mode;
  const quality = clamp(
    options.quality ?? COMPRESS_DEFAULTS.quality,
    COMPRESS_LIMITS.minQuality,
    COMPRESS_LIMITS.maxQuality,
  );
  const dpi = clamp(
    options.dpi ?? COMPRESS_DEFAULTS.dpi,
    COMPRESS_LIMITS.minDpi,
    COMPRESS_LIMITS.maxDpi,
  );

  if (mode === 'lossless') {
    const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
    ctx.throwIfAborted();
    const bytes = await doc.save({ useObjectStreams: true });
    return { data: bytes, pageCount: doc.getPageCount(), mode };
  }

  if (mode === 'smart') {
    return smartCompress(data, { quality }, ctx, password);
  }

  return rasterCompress(data, { quality, dpi }, ctx, password);
}

/**
 * Re-encode embedded images in place. This is deliberately conservative:
 * unsupported colour spaces, masks, decode arrays and streams that do not
 * shrink enough are left byte-identical. That is how smart mode keeps its
 * promise that text and interactive content are untouched.
 */
async function smartCompress(
  data: Uint8Array,
  options: { quality: number },
  ctx: JobContext,
  password?: string,
): Promise<CompressResult> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('Smart compression needs this browser to run; it cannot run without a canvas');
  }

  const doc = await loadPdfDocument(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);

  ctx.throwIfAborted();
  const objects = doc.context.enumerateIndirectObjects();
  const protectedRefs = collectProtectedImageRefs(objects);
  const streams: { ref: PDFRef; stream: PDFRawStream }[] = [];
  for (const [ref, obj] of objects) {
    if (isImageStream(obj)) streams.push({ ref, stream: obj });
  }

  const total = streams.length;
  let imagesOptimized = 0;
  let imagesSkipped = 0;
  let imageBytesBefore = 0;
  let imageBytesAfter = 0;

  for (let index = 0; index < total; index += 1) {
    ctx.throwIfAborted();
    progress.step(index, total, `Checking image ${index + 1} of ${total}`);

    const { ref, stream } = streams[index]!;
    const original = stream.contents;
    imageBytesBefore += original.length;

    // Check the declared raster before inflating it. A tiny Flate stream can
    // describe an enormous bitmap; don't let a decompression bomb into the
    // worker just to discover it a moment later.
    const declaredPixels = declaredPixelCount(stream.dict);
    if (
      declaredPixels === null ||
      declaredPixels < 1 ||
      declaredPixels > COMPRESS_LIMITS.smartMaxPixels
    ) {
      imagesSkipped += 1;
      imageBytesAfter += original.length;
      continue;
    }

    const info = classifyImageStream(stream.dict, original);
    if (
      !info ||
      protectedRefs.has(ref.toString()) ||
      index >= COMPRESS_LIMITS.smartMaxImages ||
      !canSmartOptimize(stream, info)
    ) {
      imagesSkipped += 1;
      imageBytesAfter += original.length;
      continue;
    }

    try {
      const replacement = await reencodeImage(info, options.quality);
      const minimum = original.length * (1 - COMPRESS_LIMITS.smartMinSavings);
      if (!replacement || replacement.data.length >= minimum) {
        imagesSkipped += 1;
        imageBytesAfter += original.length;
        continue;
      }

      applyJpegReplacement(stream, replacement);
      imagesOptimized += 1;
      imageBytesAfter += replacement.data.length;
    } catch {
      // A single odd image must never fail the whole document. It stays
      // exactly as it was.
      imagesSkipped += 1;
      imageBytesAfter += original.length;
    }
  }

  ctx.throwIfAborted();
  const bytes = await doc.save({ useObjectStreams: true });
  return {
    data: bytes,
    pageCount: doc.getPageCount(),
    mode: 'smart',
    imagesOptimized,
    imagesSkipped,
    imageBytesBefore,
    imageBytesAfter,
  };
}

type StreamInfo = NonNullable<ReturnType<typeof classifyImageStream>>;
type Replacement = { data: Uint8Array; width: number; height: number };

/** Returns the refs of streams used as soft masks or stencil/colour-key masks. */
function collectProtectedImageRefs(objects: [PDFRef, PDFObject][]): Set<string> {
  const refs = new Set<string>();
  for (const [, obj] of objects) {
    if (!isImageStream(obj)) continue;
    const smask = obj.dict.get(PDFName.of('SMask'));
    if (smask instanceof PDFRef) refs.add(smask.toString());
    const mask = obj.dict.get(PDFName.of('Mask'));
    if (mask instanceof PDFRef) refs.add(mask.toString());
  }
  return refs;
}

function declaredPixelCount(dict: PDFDict): number | null {
  const width = dict.get(PDFName.of('Width'));
  const height = dict.get(PDFName.of('Height'));
  if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return null;
  return width.asNumber() * height.asNumber();
}

function canSmartOptimize(stream: PDFRawStream, info: StreamInfo): boolean {
  const dict = stream.dict;
  // Stencil masks, colour-key masks, explicit decode arrays and external file
  // streams all carry meaning that a JPEG round-trip would change or lose.
  if (dict.get(PDFName.of('ImageMask')) !== undefined) return false;
  if (dict.get(PDFName.of('Mask')) !== undefined) return false;
  if (dict.get(PDFName.of('Decode')) !== undefined) return false;
  if (dict.get(PDFName.of('F')) !== undefined) return false;
  if (dict.get(PDFName.of('FFilter')) !== undefined) return false;
  if (dict.get(PDFName.of('DecodeParms')) !== undefined && info.filter === 'DCTDecode') {
    return false;
  }

  if (!info.colorSpace || !SMART_COLOR_SPACES.has(info.colorSpace)) return false;
  if (info.width * info.height > COMPRESS_LIMITS.smartMaxPixels) return false;
  if (!info.isJpeg && info.samples.length > LIMITS.tool.maxImageBytes) return false;
  return true;
}

async function reencodeImage(info: StreamInfo, quality: number): Promise<Replacement | null> {
  // Never resize a base image that has a separate soft mask: the mask would no
  // longer line up with the pixels.
  const scale = info.hasSMask
    ? 1
    : Math.min(1, COMPRESS_LIMITS.smartMaxEdge / Math.max(info.width, info.height));
  const targetWidth = Math.max(1, Math.round(info.width * scale));
  const targetHeight = Math.max(1, Math.round(info.height * scale));

  if (info.isJpeg) {
    const blob = new Blob([info.samples as unknown as BlobPart], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    try {
      // A JPEG whose EXIF orientation swaps dimensions cannot be safely
      // re-embedded with the original /Width and /Height.
      if (bitmap.width !== info.width || bitmap.height !== info.height) return null;

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const context = canvas.getContext('2d');
      if (!context) {
        releaseCanvas(canvas);
        return null;
      }
      // JPEG has no alpha. Fill white so an image with a soft mask does not
      // pick up black fringes around transparent pixels.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      const jpeg = await canvasToJpeg(canvas, quality);
      releaseCanvas(canvas);
      return jpeg ? { data: jpeg, width: targetWidth, height: targetHeight } : null;
    } finally {
      bitmap.close();
    }
  }

  const source = new OffscreenCanvas(info.width, info.height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) {
    releaseCanvas(source);
    return null;
  }

  const imageData = sourceContext.createImageData(info.width, info.height);
  const rgba = imageData.data;
  if (info.components === 1) {
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
      const gray = info.samples[p]!;
      rgba[i] = gray;
      rgba[i + 1] = gray;
      rgba[i + 2] = gray;
      rgba[i + 3] = 255;
    }
  } else {
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 3) {
      rgba[i] = info.samples[p]!;
      rgba[i + 1] = info.samples[p + 1]!;
      rgba[i + 2] = info.samples[p + 2]!;
      rgba[i + 3] = 255;
    }
  }
  sourceContext.putImageData(imageData, 0, 0);

  let canvas = source;
  if (targetWidth !== info.width || targetHeight !== info.height) {
    const scaled = new OffscreenCanvas(targetWidth, targetHeight);
    const scaledContext = scaled.getContext('2d');
    if (!scaledContext) {
      releaseCanvas(source);
      return null;
    }
    scaledContext.imageSmoothingEnabled = true;
    scaledContext.imageSmoothingQuality = 'high';
    scaledContext.drawImage(source, 0, 0, targetWidth, targetHeight);
    releaseCanvas(source);
    canvas = scaled;
  }

  const jpeg = await canvasToJpeg(canvas, quality);
  releaseCanvas(canvas);
  return jpeg ? { data: jpeg, width: targetWidth, height: targetHeight } : null;
}

async function canvasToJpeg(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array | null> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (!blob || blob.size === 0) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function releaseCanvas(canvas: OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Replaces a stream's samples and normalizes its dictionary for a JPEG. */
function applyJpegReplacement(stream: PDFRawStream, replacement: Replacement): void {
  const dict = stream.dict;
  dict.set(PDFName.of('Width'), PDFNumber.of(replacement.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(replacement.height));
  dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
  dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
  dict.delete(PDFName.of('DecodeParms'));
  dict.delete(PDFName.of('Decode'));
  dict.delete(PDFName.of('DL'));
  stream.updateContents(replacement.data);
}

async function rasterCompress(
  data: Uint8Array,
  options: { quality: number; dpi: number },
  ctx: JobContext,
  password?: string,
): Promise<CompressResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Strong compression needs this browser to run; it cannot run without a canvas');
  }

  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  const progress = createProgressReporter(ctx);

  try {
    const total = loaded.doc.numPages;
    if (total > LIMITS.tool.maxRedactPages) {
      throw new Error(
        `That document has ${total} pages; strong compression rebuilds each page as an image and the limit is ${LIMITS.tool.maxRedactPages}. Split it first, or use repack-only.`,
      );
    }

    const out = await PDFDocument.create();
    for (let index = 1; index <= total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index);
      const unit = page.getViewport({ scale: 1 });
      // DPI is physical: a Letter page at 150 dpi is ~1275 px wide, whatever the
      // source resolution was.
      const targetWidthPx = Math.max(1, Math.round((unit.width * options.dpi) / 72));
      const rendered = await renderPageToCanvas(page, {
        targetWidthPx,
        format: 'jpeg',
        quality: options.quality,
      });

      const blob = await rendered.canvas.toBlob('image/jpeg', options.quality);
      if (!blob) {
        rendered.canvas.release?.();
        page.cleanup();
        throw new Error(`Could not encode page ${index} as a JPEG.`);
      }
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      await out.embedJpg(jpeg);
      out.addPage([unit.width, unit.height]);
      page.cleanup();
      rendered.canvas.release?.();

      progress.step(index - 1, total, `Compressing page ${index} of ${total}`);
    }

    const bytes = await out.save({ useObjectStreams: false });
    return { data: bytes, pageCount: total, mode: 'raster' };
  } finally {
    await loaded.destroy();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
