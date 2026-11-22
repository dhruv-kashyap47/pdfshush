/**
 * O-02/O-03: add an OCR text layer without rebuilding the document.
 *
 * The standalone OCR tool rebuilds each scanned page from a JPEG. That is the
 * right trade for "make this scan searchable", but it is the wrong operation
 * inside the editor: new page objects would invalidate paragraph ids, object
 * ids and page indices. This pass instead appends invisible text to the pages
 * that need it and leaves every original page, object, font and annotation in
 * place.
 *
 * Recognition is still browser-only in production (Tesseract in the worker).
 * The renderer and engine are injectable so the pipeline — mapping, drawing,
 * preservation and verification — is testable in Node.
 */

import { StandardFonts, type PDFFont } from '@cantoo/pdf-lib';
import type { PDFPageProxy } from 'pdfjs-dist';
import { createProgressReporter, type JobContext } from '../job.js';
import { OCR_LIMITS } from '../limits.js';
import { loadPdfDocument } from '../ops/pages.js';
import { loadPdfForRender } from '../render/pdfjsRuntime.js';
import { renderPageToImage } from '../render/renderPage.js';
import { verifyExportArtifact } from '../textedit/exportVerify.js';
import { drawOcrTextLayer } from './draw.js';
import {
  buildOcrPlacements,
  sanitizeOcrText,
  summarizeOcrPage,
  type OcrBlockSummary,
} from './layout.js';
import { pageHasTextLayer } from './ocr.js';
import { createOcrEngine } from './runtime.js';
import type { OcrEngine, OcrEngineFactory, OcrPage } from './types.js';

export interface OcrTextLayerOptions {
  /** Zero-based pages. Empty or missing means every page. */
  pageIndexes?: number[];
  /** Render width for recognition; 1200..4000. */
  targetWidthPx?: number;
  quality?: number;
  /** Test seam: `renderPageToImage` needs a canvas in production. */
   renderPage?: (
    page: PDFPageProxy,
    options: { targetWidthPx: number; format: 'jpeg'; quality: number },
  ) => Promise<{ data: ArrayBuffer | Uint8Array; width: number; height: number }>;
  /** Test seam: the worker supplies Tesseract. */
  engineFactory?: OcrEngineFactory;
}

export interface OcrTextPageResult {
  /** Zero-based page index. */
  pageIndex: number;
  confidence: number;
  wordCount: number;
  lineCount: number;
  paragraphCount: number;
  /** Small sample of recognized lines, in PDF points. */
  blocks: OcrBlockSummary[];
  provenance: 'ocr';
}

export interface OcrTextLayerResult {
  data: Uint8Array;
  pageCount: number;
  /** 1-based pages that received a new text layer. */
  ocrPages: number[];
  /** 1-based pages skipped because they already carried real text. */
  skippedPages: number[];
  pages: OcrTextPageResult[];
  wordCount: number;
  characterCount: number;
  averageConfidence: number;
  warnings: string[];
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normaliseRotation(angle: number): 0 | 90 | 180 | 270 {
  const normalised = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  return normalised === 90 || normalised === 180 || normalised === 270 ? normalised : 0;
}

function requestedIndexes(values: number[] | undefined, pageCount: number): number[] {
  const raw = values && values.length > 0 ? values : Array.from({ length: pageCount }, (_, i) => i);
  return [...new Set(raw)]
    .filter((value) => Number.isInteger(value) && value >= 0 && value < pageCount)
    .sort((a, b) => a - b);
}

function meanConfidence(page: OcrPage): number {
  let sum = 0;
  let count = 0;
  for (const line of page.lines) {
    for (const word of line.words) {
      if (sanitizeOcrText(word.text).length === 0) continue;
      sum += word.confidence;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

export async function addOcrTextLayer(
  data: Uint8Array,
  options: OcrTextLayerOptions,
  ctx: JobContext,
  password?: string,
): Promise<OcrTextLayerResult> {
  const targetWidthPx = clampInt(
    options.targetWidthPx ?? OCR_LIMITS.defaultWidthPx,
    OCR_LIMITS.minWidthPx,
    OCR_LIMITS.maxWidthPx,
  );
  const quality = Math.min(1, Math.max(0.3, options.quality ?? 0.9));
  const passwordOptions = password !== undefined ? { password } : {};

  const rendered = await loadPdfForRender(data, passwordOptions);
  const out = await loadPdfDocument(data, passwordOptions);
  const progress = createProgressReporter(ctx);
  let engine: OcrEngine | undefined;
  let font: PDFFont | undefined;

  const ocrPages: number[] = [];
  const skippedPages: number[] = [];
  const pages: OcrTextPageResult[] = [];
  const warnings: string[] = [];
  const placementsByPage = new Map<number, number>();
  let wordCount = 0;
  let characterCount = 0;
  let confidenceSum = 0;
  let confidenceWordCount = 0;
  let placementsTotal = 0;

  try {
    const pageCount = rendered.doc.numPages;
    if (pageCount > OCR_LIMITS.maxPages) {
      throw new Error(
        `That document has ${pageCount} pages; OCR is limited to ${OCR_LIMITS.maxPages} per run. Split it first.`,
      );
    }
    const requested = requestedIndexes(options.pageIndexes, pageCount);
    if (requested.length === 0) {
      return {
        data: data.slice(),
        pageCount,
        ocrPages: [],
        skippedPages: [],
        pages: [],
        wordCount: 0,
        characterCount: 0,
        averageConfidence: 0,
        warnings: ['ocr-skipped: no page in the requested range exists'],
      };
    }

    const recognize = options.engineFactory ?? createOcrEngine;
    const renderPage = options.renderPage ?? renderPageToImage;

    for (const [position, pageIndex] of requested.entries()) {
      ctx.throwIfAborted();
      const pageNumber = pageIndex + 1;
      const proxy = await rendered.doc.getPage(pageNumber);
      try {
        if (await pageHasTextLayer(proxy)) {
          skippedPages.push(pageNumber);
          warnings.push(
            `ocr-skipped: page ${pageNumber} already has a text layer; it was left untouched`,
          );
          progress.step(position, requested.length, `Skipping page ${pageNumber}`);
          continue;
        }

        const viewport = proxy.getViewport({ scale: 1 });
        const image = await renderPage(proxy, {
          targetWidthPx,
          format: 'jpeg',
          quality,
        });
        engine ??= await recognize();
        const recognized = await engine.recognize(
          new Blob(
            [
              image.data instanceof Uint8Array
                ? (image.data.slice().buffer as ArrayBuffer)
                : image.data,
            ],
            { type: 'image/jpeg' },
          ),
          {
            signal: ctx.signal,
            onProgress: (engineProgress) => {
              const ratio =
                engineProgress.ratio !== undefined
                  ? (position + Math.min(1, Math.max(0, engineProgress.ratio))) / requested.length
                  : undefined;
              progress.report(`Reading page ${pageNumber} of ${pageCount}`, ratio);
            },
          },
        );

        const placements = buildOcrPlacements(recognized, {
          imageWidthPx: image.width,
          imageHeightPx: image.height,
          pageWidthPt: viewport.width,
          pageHeightPt: viewport.height,
        });
        const summary = summarizeOcrPage(recognized, {
          imageWidthPx: image.width,
          imageHeightPx: image.height,
          pageWidthPt: viewport.width,
          pageHeightPt: viewport.height,
        });
        const confidence = meanConfidence(recognized);

        if (placements.length === 0) {
          warnings.push(`ocr-empty-page: page ${pageNumber} produced no encodable words`);
          pages.push({
            pageIndex,
            confidence,
            wordCount: 0,
            lineCount: summary.lineCount,
            paragraphCount: summary.paragraphCount,
            blocks: summary.blocks,
            provenance: 'ocr',
          });
          progress.step(position, requested.length, `No words on page ${pageNumber}`);
          continue;
        }

        font ??= await out.embedFont(StandardFonts.Helvetica);
        const page = out.getPage(pageIndex);
        const rotation = normaliseRotation(page.getRotation().angle);
        drawOcrTextLayer(page, font, placements, {
          rotation,
          pageWidth: page.getWidth(),
          pageHeight: page.getHeight(),
        });
        placementsByPage.set(pageNumber, placements.length);
        placementsTotal += placements.length;

        for (const placement of placements) {
          characterCount += placement.text.length;
        }
        wordCount += placements.length;
        for (const line of recognized.lines) {
          for (const word of line.words) {
            if (sanitizeOcrText(word.text).length === 0) continue;
            confidenceSum += word.confidence;
            confidenceWordCount += 1;
          }
        }

        if (confidence > 0 && confidence < 60) {
          warnings.push(
            `ocr-low-confidence: page ${pageNumber} averaged ${Math.round(confidence)}%; check the text before relying on it`,
          );
        }
        ocrPages.push(pageNumber);
        pages.push({
          pageIndex,
          confidence,
          wordCount: summary.wordCount,
          lineCount: summary.lineCount,
          paragraphCount: summary.paragraphCount,
          blocks: summary.blocks,
          provenance: 'ocr',
        });
        progress.step(position, requested.length, `Recognizing page ${pageNumber} of ${pageCount}`);
      } finally {
        proxy.cleanup();
      }
    }

    if (placementsTotal === 0) {
      // Nothing changed. Returning the original bytes is safer and cheaper than
      // a re-save that only risks moving objects around.
      return {
        data: data.slice(),
        pageCount,
        ocrPages,
        skippedPages,
        pages,
        wordCount,
        characterCount,
        averageConfidence: confidenceWordCount > 0 ? confidenceSum / confidenceWordCount : 0,
        warnings,
      };
    }

    progress.report('Saving the text layer', 0.95);
    const bytes = await out.save({ useObjectStreams: false });

    // Reopen and prove the claim: unchanged page count, each OCR page exposes
    // text, and every page we did *not* touch still extracts the same text.
    // This is the same gate the editor's export uses, so an OCR layer cannot be
    // offered if it silently rewrote a neighbouring page.
    progress.report('Verifying the text layer', 1);
    const expectations = [...placementsByPage.keys()].flatMap((pageNumber) => {
      const page = pages.find((entry) => entry.pageIndex === pageNumber - 1);
      const first = page?.blocks[0]?.text;
      return first ? [{ label: `ocr-page-${pageNumber}`, pageIndex: pageNumber - 1, expect: first }] : [];
    });
    const editedRegions = ocrPages.flatMap((pageNumber) => {
      const page = out.getPage(pageNumber - 1);
      return [
        {
          pageIndex: pageNumber - 1,
          box: { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() },
        },
      ];
    });
    const verification = await verifyExportArtifact({
      original: data,
      output: bytes,
      expectedPageCount: pageCount,
      expectations,
      editedRegions,
      // OCR changes text where it claims to; pixel comparison is not meaningful
      // for an invisible layer and would cost a page render per page.
      visual: false,
      ...(password ? { password } : {}),
    });
    if (!verification.ok) {
      const failures = verification.checks.filter((check) => !check.ok);
      throw new Error(
        `The OCR text layer did not survive verification: ${failures
          .map((check) => `${check.name}: ${check.detail}`)
          .join('; ')}`,
      );
    }

    return {
      data: bytes,
      pageCount,
      ocrPages,
      skippedPages,
      pages,
      wordCount,
      characterCount,
      averageConfidence: confidenceWordCount > 0 ? confidenceSum / confidenceWordCount : 0,
      warnings,
    };
  } finally {
    await engine?.terminate().catch(() => undefined);
    await rendered.destroy();
  }
}

/** Re-exported for tests and callers that only need the shape. */
export type { OcrPage };
