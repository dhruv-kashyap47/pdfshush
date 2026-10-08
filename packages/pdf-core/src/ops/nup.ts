/**
 * N-up imposition -- packs 2, 4 or 8 source pages onto one output sheet.
 *
 * Layout is row-major (reading order). The default sheet is built from the
 * source page size itself (2-up: 1x2 cells, 4-up: 2x2, 8-up: 4x2), so page
 * aspect ratios are preserved with no paper-size guessing. A4/Letter sheets are
 * also offered, with each cell contain-fitted like a photo on a print sheet.
 */

import { PDFDocument, type PDFEmbeddedPage } from '@cantoo/pdf-lib';
import type { JobContext } from '../job.js';
import { createProgressReporter } from '../job.js';
import { loadPdfDocument } from './pages.js';
import type { SourceDocument } from './compose.js';

export type NupCount = 2 | 4 | 8;
export type NupSheet = 'source' | 'a4' | 'letter';

export interface NupOptions {
  /** Pages per output sheet. */
  n: NupCount;
  /** Sheet size: 'source' derives from page 1, otherwise a named paper size. */
  sheet?: NupSheet;
}

export interface NupResult {
  data: Uint8Array;
  pageCount: number;
}

/** ISO A4 and US Letter in points, landscape when the grid is wider than tall. */
const PAPER_POINTS: Record<'a4' | 'letter', { width: number; height: number }> = {
  a4: { width: 841.9, height: 595.3 }, // A4 landscape
  letter: { width: 792, height: 612 }, // Letter landscape
};

interface Grid {
  cols: number;
  rows: number;
}

function gridFor(n: NupCount): Grid {
  // 2-up is side-by-side (landscape), 4-up is 2x2 (square), 8-up is 4x2.
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 4, rows: 2 };
}

export async function imposePages(
  source: SourceDocument,
  options: NupOptions,
  ctx: JobContext,
): Promise<NupResult> {
  // This op is exported and callable without the job validator. `n: 0` would be
  // an unbounded loop and `n: NaN` a silent zero-page document, so check here.
  if (options.n !== 2 && options.n !== 4 && options.n !== 8) {
    throw new Error('N-up sheets must hold 2, 4 or 8 pages');
  }
  if (options.sheet !== undefined && !['source', 'a4', 'letter'].includes(options.sheet)) {
    throw new Error(`Unknown sheet size "${String(options.sheet)}"`);
  }
  const progress = createProgressReporter(ctx);
  progress.report('Opening document', 0.02);

  const src = await loadPdfDocument(source.data, { password: source.password });
  const sourcePages = src.getPages();
  const totalPages = sourcePages.length;
  if (totalPages === 0) throw new Error('Document has no pages');

  const grid = gridFor(options.n);
  const sheetKind = options.sheet ?? 'source';

  let sheetWidth: number;
  let sheetHeight: number;
  if (sheetKind === 'source') {
    const first = sourcePages[0]!.getSize();
    sheetWidth = first.width * grid.cols;
    sheetHeight = first.height * grid.rows;
  } else {
    sheetWidth = PAPER_POINTS[sheetKind].width;
    sheetHeight = PAPER_POINTS[sheetKind].height;
  }
  const cellWidth = sheetWidth / grid.cols;
  const cellHeight = sheetHeight / grid.rows;

  const out = await PDFDocument.create();
  const embedded = new Map<number, PDFEmbeddedPage>();
  const sheetCount = Math.ceil(totalPages / options.n);

  for (let sheet = 0; sheet < sheetCount; sheet += 1) {
    ctx.throwIfAborted();
    const outPage = out.addPage([sheetWidth, sheetHeight]);

    for (let slot = 0; slot < options.n; slot += 1) {
      const index = sheet * options.n + slot;
      if (index >= totalPages) break;

      let emb = embedded.get(index);
      if (!emb) {
        emb = await out.embedPage(sourcePages[index]!);
        embedded.set(index, emb);
      }

      // Row-major fill: col = slot % cols from the top-left.
      const col = slot % grid.cols;
      const row = Math.floor(slot / grid.cols);
      const scale = Math.min(cellWidth / emb.width, cellHeight / emb.height);
      const drawWidth = emb.width * scale;
      const drawHeight = emb.height * scale;
      const x = col * cellWidth + (cellWidth - drawWidth) / 2;
      // PDF y grows upward; row 0 sits at the top of the sheet.
      const y = sheetHeight - (row + 1) * cellHeight + (cellHeight - drawHeight) / 2;

      outPage.drawPage(emb, { x, y, width: drawWidth, height: drawHeight });
    }
    progress.step(sheet, sheetCount, 'Imposing pages');
  }

  progress.report('Writing file', 0.97);
  return {
    data: await out.save({ useObjectStreams: false }),
    pageCount: sheetCount,
  };
}
