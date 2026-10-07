/**
 * Text-run extraction -- the data behind the editor's "click text to edit it".
 *
 * pdf.js reports every text-showing operator as an item carrying its font
 * matrix. We convert three anchor points (baseline start/end, ascender,
 * descender) through the page viewport -- the very frame the editor's raster
 * and overlay live in -- so the UI never sees PDF coordinates. Items are then
 * clustered into per-line runs: clicking anywhere on "Invoice number 42"
 * should select the whole line, not one word.
 */

import type { JobContext } from '../job.js';
import { loadPdfForRender } from './pdfjsRuntime.js';

export interface TextRun {
  /** Run text (fragments joined with single spaces where a gap remains). */
  text: string;
  /** Font size in points, taken from the line's first fragment. */
  fontSize: number;
  /** Display-space box: top-left origin, y down, PDF points at 100% zoom. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** true when the baseline runs horizontally (false = rotated/CJK column). */
  horizontal: boolean;
}

/** One pdf.js text item, already converted into display space. */
export interface RunItem {
  text: string;
  fontSize: number;
  /** Display-space box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** true when the baseline runs horizontally (false = vertical/CJK column). */
  horizontal: boolean;
  /**
   * Baseline position across the line (display y for horizontal runs, x for
   * vertical): items sharing this coordinate belong to the same visual line,
   * even at mixed font sizes.
   */
  line: number;
}

/**
 * Merges items that sit on the same visual line into runs.
 *
 * Items are ordered by their baseline coordinate first, so fragments of one
 * line are always adjacent for the merge pass (sorting by box corner would
 * interleave stacked lines). Same-line items then overlap heavily on the cross
 * axis (>= 60% of the shorter box) and stay within 0.8em of each other along
 * the baseline -- stacked lines and adjacent columns fail the cross-axis test,
 * so they never merge.
 */
export function clusterTextRuns(items: RunItem[]): TextRun[] {
  const sorted = [...items].sort(
    (a, b) => a.line - b.line || (a.horizontal ? a.x - b.x : a.y - b.y),
  );
  const runs: RunItem[] = [];

  for (const item of sorted) {
    if (item.text.length === 0) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.horizontal === item.horizontal && sameLine(previous, item)) {
      const gap = item.horizontal
        ? item.x - (previous.x + previous.width)
        : item.y - (previous.y + previous.height);
      const joiner = gap <= Math.min(previous.fontSize, item.fontSize) * 0.15 ? '' : ' ';
      previous.text = `${previous.text}${joiner}${item.text}`;
      // Union box; fontSize keeps the line-start size (the size users retyped at).
      const right = Math.max(previous.x + previous.width, item.x + item.width);
      const bottom = Math.max(previous.y + previous.height, item.y + item.height);
      previous.x = Math.min(previous.x, item.x);
      previous.y = Math.min(previous.y, item.y);
      previous.width = right - previous.x;
      previous.height = bottom - previous.y;
      continue;
    }
    runs.push({ ...item });
  }

  return runs.map((run) => ({
    text: run.text,
    fontSize: run.fontSize,
    x: run.x,
    y: run.y,
    width: run.width,
    height: run.height,
    horizontal: run.horizontal,
  }));
}

function sameLine(a: RunItem, b: RunItem): boolean {
  if (a.horizontal) {
    const overlapY =
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
    const cross = Math.min(a.height, b.height);
    return overlapY >= cross * 0.6 && gapX <= Math.min(a.fontSize, b.fontSize) * 0.8;
  }
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  const cross = Math.min(a.width, b.width);
  return overlapX >= cross * 0.6 && gapY <= Math.min(a.fontSize, b.fontSize) * 0.8;
}

/**
 * Extracts display-space text runs for the given pages (0-based; empty/missing
 * means every page). Returns one run list per requested page, in order.
 */
export async function extractTextRuns(
  data: Uint8Array,
  pageIndexes: number[],
  ctx?: JobContext,
  password?: string,
): Promise<TextRun[][]> {
  const loaded = await loadPdfForRender(data, { ...(password ? { password } : {}) });
  try {
    const pageCount = loaded.doc.numPages;
    const targets =
      pageIndexes.length > 0
        ? pageIndexes
        : Array.from({ length: pageCount }, (_, i) => i);
    for (const index of targets) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        throw new Error(`Page ${index + 1} does not exist (document has ${pageCount} pages)`);
      }
    }

    const results: TextRun[][] = [];
    for (let i = 0; i < targets.length; i += 1) {
      ctx?.throwIfAborted();
      const page = await loaded.doc.getPage(targets[i]! + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: RunItem[] = [];

      for (const raw of content.items) {
        const item = raw as { str?: string; transform?: number[]; width?: number };
        if (typeof item.str !== 'string' || item.str.length === 0) continue;
        if (!Array.isArray(item.transform)) continue;
        const converted = toRunItem(item.str, item.transform, item.width ?? 0, viewport);
        if (converted) items.push(converted);
      }

      results.push(clusterTextRuns(items));
      ctx?.onProgress({
        phase: 'Reading text',
        ratio: (i + 1) / targets.length,
        message: `Page ${targets[i]! + 1}`,
      });
    }
    return results;
  } finally {
    await loaded.destroy();
  }
}

/** Font matrix → display-space box, via the page viewport (rotation-safe). */
function toRunItem(
  text: string,
  transform: number[],
  width: number,
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
): RunItem | null {
  if (transform.length < 6) return null;
  const a = transform[0]!;
  const b = transform[1]!;
  const c = transform[2]!;
  const d = transform[3]!;
  const e = transform[4]!;
  const f = transform[5]!;
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;

  const xLen = Math.hypot(a, b) || 1;
  const upLen = Math.hypot(c, d) || 1;
  const dirX = a / xLen;
  const dirY = b / xLen;
  const upX = c / upLen;
  const upY = d / upLen;
  const fontSize = upLen;
  if (fontSize <= 0 || width <= 0) return null;

  // Anchor points in PDF space: baseline span, ascender line, descender line.
  const points: [number, number][] = [
    [e, f],
    [e + dirX * width, f + dirY * width],
    [e + upX * fontSize, f + upY * fontSize],
    [e + dirX * width + upX * fontSize, f + dirY * width + upY * fontSize],
    [e - upX * fontSize * 0.25, f - upY * fontSize * 0.25],
    [e + dirX * width - upX * fontSize * 0.25, f + dirY * width - upY * fontSize * 0.25],
  ];

  const view: [number, number][] = points.map(([px, py]) => {
    const pair = viewport.convertToViewportPoint(px, py);
    return [pair[0] ?? 0, pair[1] ?? 0];
  });
  const xs = view.map(([vx]) => vx);
  const ys = view.map(([, vy]) => vy);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  // Baseline direction in display space decides the line's orientation.
  const start = view[0]!;
  const end = view[1]!;
  const horizontal = Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]);

  return {
    text,
    fontSize,
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    horizontal,
    line: horizontal ? start[1] : start[0],
  };
}
