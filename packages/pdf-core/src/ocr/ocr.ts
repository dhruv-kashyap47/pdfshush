/**
 * OCR -- make scans searchable and selectable, in the tab.
 *
 * The pipeline is deliberately derived from the other raster rebuilds:
 *
 *   1. render each scanned page through the product's pdf.js runtime;
 *   2. recognize words and lines with an injected engine (Tesseract in the
 *      browser worker);
 *   3. rebuild the page from the JPEG and add an invisible text layer whose
 *      boxes are mapped from the recognizer's pixel coordinates;
 *   4. copy pages that already carry a text layer instead of recognizing them
 *      again.
 *
 * The output is a searchable image PDF, not a reconstructed word-processor
 * document: the visible page stays exactly the scan the user supplied. The UI
 * says that before the run, and the result reports how many pages were
 * recognized and how confident the recognizer was.
 *
 * Browser-only in practice: recognition needs a canvas and the host's engine.
 * The layout and sanitization code is pure and tested in Node;
 * `ocrDocument` refuses rather than producing a text layer it cannot verify.
 */

import { PDFDocument, StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { createProgressReporter, type JobContext } from '../job.js';
import { OCR_LIMITS } from '../limits.js';
import { applyDocumentDates } from '../ops/dates.js';
import { loadPdfDocument } from '../ops/pages.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToImage } from '../render/renderPage.js';
import { drawOcrTextLayer } from './draw.js';
import { buildOcrPlacements, sanitizeOcrText } from './layout.js';
import { createOcrEngine } from './runtime.js';
import type { OcrEngine } from './types.js';

export interface OcrOptions {
  /** Render width in pixels, 1200..4000. Defaults to 2200 (~250 dpi at A4). */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. Defaults to 0.9. */
  quality?: number;
}

export interface OcrResult {
  data: Uint8Array;
  pageCount: number;
  /** 1-based numbers of pages that were rasterized and recognized. */
  ocrPages: number[];
  /** 1-based numbers of pages copied because they already had a text layer. */
  textPages: number[];
  wordCount: number;
  characterCount: number;
  /** Word-weighted confidence across recognized pages, 0..100. */
  averageConfidence: number;
}

export async function ocrDocument(
  data: Uint8Array,
  options: OcrOptions,
  ctx: JobContext,
  password?: string,
): Promise<OcrResult> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OCR needs this browser to run; it cannot run without a canvas');
  }

  const targetWidthPx = clampInt(
    options.targetWidthPx ?? OCR_LIMITS.defaultWidthPx,
    OCR_LIMITS.minWidthPx,
    OCR_LIMITS.maxWidthPx,
  );
  const quality = Math.min(1, Math.max(0.3, options.quality ?? 0.9));

  // An empty password is meaningful: it is how pdf-lib and pdf.js open
  // owner-restricted documents. Truthiness would silently drop it.
  const passwordOptions = password !== undefined ? { password } : {};
  const loaded = await loadPdfForRender(data, passwordOptions);
  const progress = createProgressReporter(ctx);

  /** Created lazily: a fully searchable document pays nothing for OCR. */
  let engine: OcrEngine | undefined;
  /** Loaded lazily too: a pure scan never needs a pdf-lib copy source. */
  let sourcePromise: Promise<PDFDocument | null> | undefined;

  const sourceDocument = (): Promise<PDFDocument | null> => {
    if (!sourcePromise) {
      // A document pdf.js can render but pdf-lib cannot copy is still worth
      // OCR-ing; copying is an optimization, not a requirement. Encrypted
      // sources land here when they cannot be opened with the supplied
      // password, and the fallback recognizes every page.
      sourcePromise = loadPdfDocument(data, passwordOptions).catch(() => null);
    }
    return sourcePromise;
  };

  try {
    const total = loaded.doc.numPages;
    if (total > OCR_LIMITS.maxPages) {
      throw new Error(
        `That document has ${total} pages; OCR rebuilds recognized pages as images and the limit is ${OCR_LIMITS.maxPages}. Split it first.`,
      );
    }

    const out = await PDFDocument.create();
    // A rasterized rebuild has no source document to inherit dates from.
    applyDocumentDates(out, {});
    let font: PDFFont | undefined;

    const ocrPages: number[] = [];
    const textPages: number[] = [];
    /** Placements per recognized page, used to verify the exported layer. */
    const placementsByPage = new Map<number, number>();
    let wordCount = 0;
    let characterCount = 0;
    let confidenceSum = 0;
    let confidenceWordCount = 0;

    for (let index = 0; index < total; index += 1) {
      ctx.throwIfAborted();
      const page = await loaded.doc.getPage(index + 1);
      const pageNumber = index + 1;

      try {
        const viewport = page.getViewport({ scale: 1 });

        if (await pageHasTextLayer(page)) {
          const source = await sourceDocument();
          if (source) {
            try {
              const [copied] = await out.copyPages(source, [index]);
              if (copied) {
                out.addPage(copied);
                textPages.push(pageNumber);
                progress.step(index, total, `Keeping page ${pageNumber} of ${total}`);
                continue;
              }
            } catch {
              // A page pdf-lib refuses to copy is recognized instead below.
            }
          }
        }

        const rendered = await renderPageToImage(page, {
          targetWidthPx,
          format: 'jpeg',
          quality,
        });

        engine ??= await createOcrEngine();
        const recognized = await engine.recognize(
          new Blob([rendered.data], { type: 'image/jpeg' }),
          {
            signal: ctx.signal,
            onProgress: (engineProgress) => {
              const ratio =
                engineProgress.ratio !== undefined
                  ? (index + Math.min(1, Math.max(0, engineProgress.ratio))) / total
                  : undefined;
              progress.report(
                phaseFor(engineProgress.status, pageNumber, total),
                ratio,
              );
            },
          },
        );

        const placements = buildOcrPlacements(recognized, {
          imageWidthPx: rendered.width,
          imageHeightPx: rendered.height,
          pageWidthPt: viewport.width,
          pageHeightPt: viewport.height,
        });

        font ??= await out.embedFont(StandardFonts.Helvetica);
        const image = await out.embedJpg(new Uint8Array(rendered.data));
        const outPage = out.addPage([viewport.width, viewport.height]);
        outPage.drawImage(image, {
          x: 0,
          y: 0,
          width: viewport.width,
          height: viewport.height,
        });
        drawOcrTextLayer(outPage, font, placements);
        placementsByPage.set(pageNumber, placements.length);

        for (const placement of placements) {
          wordCount += 1;
          characterCount += placement.text.length;
        }
        for (const line of recognized.lines) {
          for (const word of line.words) {
            // Confidence is word-weighted; words the text layer had to drop
            // are not part of the output and must not pull the average down.
            if (sanitizeOcrText(word.text).length > 0) {
              confidenceSum += word.confidence;
              confidenceWordCount += 1;
            }
          }
        }

        ocrPages.push(pageNumber);
        progress.step(index, total, `Recognizing page ${pageNumber} of ${total}`);
      } finally {
        // Every page proxy is released even when rendering or recognition
        // fails; otherwise the failed page pins its operator list for the run.
        page.cleanup();
      }
    }

    const bytes = await out.save({ useObjectStreams: false });

    // The result panel only enables Download after saying the output was
    // re-parsed. Make that true: reopen the serialized artifact, confirm the
    // page count, and prove every page we claim to have recognized actually
    // carries extractable text. A page with zero placements is legitimately
    // blank, so only pages with words are checked.
    progress.report('Verifying the text layer', 1);
    await verifyOcrOutput(bytes, total, placementsByPage);

    return {
      data: bytes,
      pageCount: total,
      ocrPages,
      textPages,
      wordCount,
      characterCount,
      averageConfidence:
        confidenceWordCount > 0 ? confidenceSum / confidenceWordCount : 0,
    };
  } finally {
    await engine?.terminate().catch(() => undefined);
    await loaded.destroy();
  }
}

/**
 * Re-opens the serialized document and checks the claim the UI makes.
 *
 * Page count must survive the rebuild, and a recognized page whose placements
 * were non-empty must still expose text after a fresh parse. This runs on the
 * bytes the user will download, not on the in-memory document, so a bad
 * serializer cannot pass. Pages that were already searchable are copied, not
 * recognized, and are covered by the page-count check only.
 */
async function verifyOcrOutput(
  bytes: Uint8Array,
  expectedPages: number,
  placementsByPage: ReadonlyMap<number, number>,
): Promise<void> {
  const check = await loadPdfForRender(bytes);
  try {
    if (check.doc.numPages !== expectedPages) {
      throw new Error(
        `The rebuilt document has ${check.doc.numPages} pages; expected ${expectedPages}.`,
      );
    }

    for (const [pageNumber, placementCount] of placementsByPage) {
      if (placementCount === 0) continue;
      const page = await check.doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let characters = 0;
        for (const item of content.items) {
          if (!('str' in item) || typeof item.str !== 'string') continue;
          for (const character of item.str) {
            if (!/\s/.test(character)) characters += 1;
          }
        }
        if (characters === 0) {
          throw new Error(
            `Page ${pageNumber} was recognized but its invisible text layer did not survive the rebuild.`,
          );
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await check.destroy();
  }
}

/**
 * A page "already has text" when it carries a real paragraph, not a lone page
 * number or a confidentiality stamp. Such pages are copied untouched, which
 * preserves their original fonts and search quality instead of replacing them
 * with a raster and an approximation.
 */
async function pageHasTextLayer(page: PDFPageProxy): Promise<boolean> {
  try {
    const content = await page.getTextContent();
    let count = 0;
    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string') continue;
      for (const char of item.str) {
        if (!/\s/.test(char)) count += 1;
        if (count >= OCR_LIMITS.minTextLayerChars) return true;
      }
    }
    return false;
  } catch {
    // Unreadable text content is not a text layer; the page is recognized.
    return false;
  }
}

/** Engine statuses are internal strings; only a few deserve user-facing copy. */
function phaseFor(status: string, pageNumber: number, total: number): string {
  if (/recogniz/i.test(status)) return `Reading page ${pageNumber} of ${total}`;
  if (/download|fetch|load|initializ|core|traineddata/i.test(status)) {
    return 'Preparing the OCR engine (first run downloads about 15 MB)';
  }
  return `Reading page ${pageNumber} of ${total}`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
