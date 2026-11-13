/**
 * Signature export (P6.1 follow-up): turn a saved signature PNG into a file a
 * bank, employer or office will accept.
 *
 * Everything here is device-local. The module is deliberately split so the
 * maths is testable in Node:
 *
 * - `computeExportInkBounds` / `fitQualityToTarget` are pure and unit-tested,
 * - `renderSignatureCanvas` / `exportSignature` touch the DOM only when called,
 * - PDF assembly runs in `workers/signature-pdf-worker.ts`, keeping pdf-lib out
 *   of every app chunk (the bundle-boundary test enforces that rule).
 *
 * Trimming ignores both transparent paper and near-white paper: a signature may
 * arrive as an alpha PNG (drawn) or as a flattened white image.
 */

import type { Rect } from '@/lib/signature-assets';

export const SIGNATURE_EXPORT_FORMATS = ['png', 'jpg', 'webp', 'pdf'] as const;
export type SignatureExportFormat = (typeof SIGNATURE_EXPORT_FORMATS)[number];

export const SIGNATURE_EXPORT_BACKGROUNDS = ['transparent', 'white'] as const;
export type SignatureExportBackground = (typeof SIGNATURE_EXPORT_BACKGROUNDS)[number];

export const SIGNATURE_EXPORT_SIZES = ['original', 'small', 'medium', 'large'] as const;
export type SignatureExportSize = (typeof SIGNATURE_EXPORT_SIZES)[number];

export const SIGNATURE_EXPORT_PDF_PAGES = ['fit', 'a4'] as const;
export type SignaturePdfPage = (typeof SIGNATURE_EXPORT_PDF_PAGES)[number];

export const SIGNATURE_EXPORT_QUALITY_MIN = 50;
export const SIGNATURE_EXPORT_QUALITY_MAX = 100;
export const SIGNATURE_EXPORT_QUALITY_DEFAULT = 92;
/** Width in source pixels when "Original" is not chosen. */
const SIZE_WIDTHS: Record<Exclude<SignatureExportSize, 'original'>, number> = {
  small: 400,
  medium: 800,
  large: 1200,
};
/** Trimming margin in source pixels, as specified for the export crop. */
export const SIGNATURE_EXPORT_TRIM_PADDING = 16;
const INK_ALPHA_THRESHOLD = 10;
const NEAR_WHITE_THRESHOLD = 245;
/** Quality probes after the first encode. Seven keeps the loop under ~8 encodes. */
export const QUALITY_SEARCH_ITERATIONS = 7;

const MIME_BY_FORMAT: Record<Exclude<SignatureExportFormat, 'pdf'>, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export interface SignatureExportOptions {
  format: SignatureExportFormat;
  background: SignatureExportBackground;
  size: SignatureExportSize;
  trim: boolean;
  /** JPG/WebP quality, 50-100. Ignored by PNG and PDF. */
  quality: number;
  pdfPage: SignaturePdfPage;
  /** Optional cap for JPG/WebP; quality is lowered until the file fits. */
  maxBytes?: number;
}

export const DEFAULT_SIGNATURE_EXPORT_OPTIONS: SignatureExportOptions = {
  format: 'png',
  background: 'transparent',
  size: 'original',
  trim: true,
  quality: SIGNATURE_EXPORT_QUALITY_DEFAULT,
  pdfPage: 'fit',
};

/** JPG has no alpha channel, so the UI and the exporter agree on white. */
export function resolveExportBackground(
  format: SignatureExportFormat,
  background: SignatureExportBackground,
): SignatureExportBackground {
  return format === 'jpg' ? 'white' : background;
}

export function mimeForExportFormat(format: SignatureExportFormat): string {
  return format === 'pdf' ? 'application/pdf' : MIME_BY_FORMAT[format];
}

export function extensionForExportFormat(format: SignatureExportFormat): string {
  return format;
}

/** `signature-2026-11-13.png`, in local time (the date the user sees). */
export function signatureExportFileName(
  format: SignatureExportFormat,
  date: Date = new Date(),
): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `signature-${year}-${month}-${day}.${extensionForExportFormat(format)}`;
}

/** Clamps persisted/partial options into something the exporter can trust. */
export function normalizeSignatureExportOptions(
  options: Partial<SignatureExportOptions> = {},
): SignatureExportOptions {
  const merged = { ...DEFAULT_SIGNATURE_EXPORT_OPTIONS, ...options };
  const quality = Number.isFinite(merged.quality)
    ? Math.min(
        SIGNATURE_EXPORT_QUALITY_MAX,
        Math.max(SIGNATURE_EXPORT_QUALITY_MIN, Math.round(merged.quality)),
      )
    : SIGNATURE_EXPORT_QUALITY_DEFAULT;
  return {
    format: SIGNATURE_EXPORT_FORMATS.includes(merged.format) ? merged.format : 'png',
    background: SIGNATURE_EXPORT_BACKGROUNDS.includes(merged.background)
      ? merged.background
      : 'transparent',
    size: SIGNATURE_EXPORT_SIZES.includes(merged.size) ? merged.size : 'original',
    trim: typeof merged.trim === 'boolean' ? merged.trim : DEFAULT_SIGNATURE_EXPORT_OPTIONS.trim,
    quality,
    pdfPage: SIGNATURE_EXPORT_PDF_PAGES.includes(merged.pdfPage) ? merged.pdfPage : 'fit',
    ...(typeof merged.maxBytes === 'number' && Number.isFinite(merged.maxBytes) && merged.maxBytes > 0
      ? { maxBytes: Math.round(merged.maxBytes) }
      : {}),
  };
}

/* ----------------------------------------------------------------- trimming */

export interface ExportInkBoundsOptions {
  /** Pixels at or below this alpha are paper, not ink. Default 10. */
  alphaThreshold?: number;
  /** Opaque channels at or above this value count as white paper. Default 245. */
  whiteThreshold?: number;
  /** Margin added around the tight box, clamped to the image. Default 16. */
  padding?: number;
}

function isInkPixel(
  data: Uint8ClampedArray | Uint8Array,
  index: number,
  alphaThreshold: number,
  whiteThreshold: number,
): boolean {
  const alpha = data[index + 3]!;
  if (alpha <= alphaThreshold) return false;
  // Alpha is opaque but the pixel is white paper (a JPG or a flattened canvas).
  return !(
    data[index]! >= whiteThreshold &&
    data[index + 1]! >= whiteThreshold &&
    data[index + 2]! >= whiteThreshold
  );
}

/**
 * Tight bounding box of the ink in an RGBA buffer, expanded by `padding`.
 * Returns `null` when nothing qualifies, which callers treat as "keep the
 * untrimmed image" rather than "export a blank canvas".
 */
export function computeExportInkBounds(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: ExportInkBoundsOptions = {},
): Rect | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (data.length < width * height * 4) return null;

  const alphaThreshold = options.alphaThreshold ?? INK_ALPHA_THRESHOLD;
  const whiteThreshold = options.whiteThreshold ?? NEAR_WHITE_THRESHOLD;
  const padding = Math.max(0, Math.round(options.padding ?? SIGNATURE_EXPORT_TRIM_PADDING));

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (!isInkPixel(data, row + x * 4, alphaThreshold, whiteThreshold)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/* -------------------------------------------------------------- canvas work */

export interface RenderedSignature {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** `false` when trimming found no ink and the full image was kept. */
  trimmed: boolean;
}

async function loadImage(source: string | Blob): Promise<HTMLImageElement> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loaded =
      typeof image.decode === 'function'
        ? null
        : new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('The saved signature could not be read.'));
          });
    if (typeof source === 'string') image.src = source;
    else image.src = objectUrl as string;
    if (loaded) await loaded;
    else await image.decode();
    return image;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Renders the exact pixels an export will encode: optional trim, optional
 * downscale (never upscaled), and the chosen background.
 */
export async function renderSignatureCanvas(
  source: string | Blob,
  options: Partial<SignatureExportOptions> = {},
): Promise<RenderedSignature> {
  const resolved = normalizeSignatureExportOptions(options);
  const image = await loadImage(source);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error('The saved signature has no pixels to export.');
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('This browser could not prepare the signature image.');
  sourceContext.drawImage(image, 0, 0);

  let bounds: Rect = { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  let trimmed = false;
  if (resolved.trim) {
    try {
      const pixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
      const found = computeExportInkBounds(pixels.data, sourceWidth, sourceHeight);
      // No ink: fall back to the untrimmed image rather than a blank file.
      if (found) {
        bounds = found;
        trimmed = true;
      }
    } catch {
      // A browser that refuses pixel reads must not lose the whole export.
    }
  }

  const requestedWidth =
    resolved.size === 'original' ? bounds.width : SIZE_WIDTHS[resolved.size];
  const targetWidth = Math.max(1, Math.round(Math.min(requestedWidth, bounds.width)));
  const scale = targetWidth / bounds.width;
  const targetHeight = Math.max(1, Math.round(bounds.height * scale));

  const output = document.createElement('canvas');
  output.width = targetWidth;
  output.height = targetHeight;
  const context = output.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the signature image.');

  const background = resolveExportBackground(resolved.format, resolved.background);
  if (background === 'white') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return { canvas: output, width: targetWidth, height: targetHeight, trimmed };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The browser could not encode this image. Try another format.'));
        },
        mime,
        quality,
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('The browser could not encode this image.'));
    }
  });
}

/** Renders the export as a PNG, used as the visual preview of a PDF too. */
export async function renderSignaturePng(
  source: string | Blob,
  options: Partial<SignatureExportOptions> = {},
): Promise<Blob> {
  const { canvas } = await renderSignatureCanvas(source, options);
  return canvasToBlob(canvas, 'image/png');
}

/* ------------------------------------------------------- quality targeting */

export interface QualityFitOptions {
  /** Encodes a candidate quality (50-100). Implemented with `canvas.toBlob`. */
  encode: (quality: number) => Promise<Blob>;
  maxBytes: number;
  minQuality?: number;
  maxQuality?: number;
  /** Extra probes after the first encode. Default 7. */
  iterations?: number;
}

export interface QualityFitResult {
  blob: Blob;
  quality: number;
  /** `false` means even the minimum quality could not reach `maxBytes`. */
  reached: boolean;
  /** Encodes performed, useful in tests and for honest UI copy. */
  attempts: number;
}

/**
 * Binary-searches the highest quality whose encoded file fits `maxBytes`.
 * Returns the smallest file it managed when the cap is unreachable, so callers
 * can still offer a download plus a visible warning.
 */
export async function fitQualityToTarget(options: QualityFitOptions): Promise<QualityFitResult> {
  const min = Math.min(
    SIGNATURE_EXPORT_QUALITY_MAX,
    Math.max(
      SIGNATURE_EXPORT_QUALITY_MIN,
      Math.round(options.minQuality ?? SIGNATURE_EXPORT_QUALITY_MIN),
    ),
  );
  const max = Math.min(
    SIGNATURE_EXPORT_QUALITY_MAX,
    Math.max(min, Math.round(options.maxQuality ?? SIGNATURE_EXPORT_QUALITY_MAX)),
  );
  if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) {
    throw new Error('The target size must be a positive number of bytes.');
  }

  let attempts = 0;
  const encodeAt = async (quality: number): Promise<Blob> => {
    attempts += 1;
    return options.encode(quality);
  };

  const first = await encodeAt(max);
  if (first.size <= options.maxBytes) {
    return { blob: first, quality: max, reached: true, attempts };
  }

  let best: { blob: Blob; quality: number } | null = null;
  let smallest: { blob: Blob; quality: number } = { blob: first, quality: max };
  let lo = min;
  let hi = max - 1;
  let probes = 0;
  while (lo <= hi && probes < (options.iterations ?? QUALITY_SEARCH_ITERATIONS)) {
    probes += 1;
    const mid = Math.floor((lo + hi) / 2);
    const candidate = await encodeAt(mid);
    if (candidate.size < smallest.blob.size) smallest = { blob: candidate, quality: mid };
    if (candidate.size <= options.maxBytes) {
      best = { blob: candidate, quality: mid };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best
    ? { ...best, reached: true, attempts }
    : { ...smallest, reached: false, attempts };
}

/* ------------------------------------------------------------------ export */

/**
 * The one public entry point the UI needs. Returns the encoded file; object
 * URLs are created (and revoked) inside the loader, never leaked to callers.
 */
export async function exportSignature(
  source: string | Blob,
  options: Partial<SignatureExportOptions> = {},
): Promise<Blob> {
  const resolved = normalizeSignatureExportOptions(options);
  const { canvas, width, height } = await renderSignatureCanvas(source, resolved);

  if (resolved.format === 'pdf') {
    const png = await canvasToBlob(canvas, 'image/png');
    const bytes = await buildPdfInWorker(png, width, height, resolved.pdfPage);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  const mime = MIME_BY_FORMAT[resolved.format];
  const encode = (quality: number) => canvasToBlob(canvas, mime, quality / 100);
  let blob: Blob;

  if (
    (resolved.format === 'jpg' || resolved.format === 'webp') &&
    typeof resolved.maxBytes === 'number'
  ) {
    const fitted = await fitQualityToTarget({
      encode,
      maxBytes: resolved.maxBytes,
      maxQuality: resolved.quality,
    });
    blob = fitted.blob;
  } else {
    blob = await encode(resolved.quality);
  }

  // Some browsers quietly substitute PNG for an unsupported WebP request.
  // Returning that as `.webp` would be a lie about the file we just handed over.
  if (blob.type && blob.type !== mime) {
    throw new Error(`This browser cannot create a ${resolved.format.toUpperCase()} file.`);
  }
  return blob;
}

/* --------------------------------------------------------------- pdf worker */

interface SignaturePdfWorkerResponse {
  type?: string;
  bytes?: ArrayBuffer;
  error?: string;
}

const PDF_WORKER_TIMEOUT_MS = 20_000;

async function buildPdfInWorker(
  png: Blob,
  width: number,
  height: number,
  page: SignaturePdfPage,
): Promise<ArrayBuffer> {
  const pngBytes = await png.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/signature-pdf-worker.ts', import.meta.url),
      { type: 'module' },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('PDF export took too long. Try a smaller size.'));
    }, PDF_WORKER_TIMEOUT_MS);
    const finish = (error: Error | null, bytes?: ArrayBuffer) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else if (bytes) resolve(bytes);
      else reject(new Error('The PDF export returned no data.'));
    };
    worker.onmessage = (event: MessageEvent<SignaturePdfWorkerResponse>) => {
      if (event.data?.type !== 'pdfshush-signature-pdf') return;
      if (event.data.error) finish(new Error(event.data.error));
      else finish(null, event.data.bytes);
    };
    worker.onerror = (event) => {
      finish(new Error(event.message || 'The PDF export worker crashed.'));
    };
    worker.postMessage(
      { type: 'pdfshush-signature-pdf', png: pngBytes, width, height, page },
      [pngBytes],
    );
  });
}

