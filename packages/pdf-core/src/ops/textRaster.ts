/**
 * C-09: raster-word fallback.
 *
 * Standard PDF fonts cover WinAnsi, and a document's embedded programme covers
 * whatever subset it was built with. Everything else -- emoji, CJK, a glyph the
 * subset dropped -- used to be refused at validation, because pdf-lib mangles
 * it silently. Refusing is honest but not always useful: a single missing glyph
 * should not make an otherwise valid edit unsaveable.
 *
 * This module renders the smallest run (one line) locally, with the closest
 * CSS family the editor already shows, and returns PNG bytes the overlay pass
 * can embed. The result is appearance, not text: the export reports
 * `glyph-rasterised` and the verifier does not expect the words in the text
 * layer. No document bytes leave the worker.
 */

import type { CanvasFactory, RenderCanvas } from '../render/canvas.js';

export interface RasteriseTextOptions {
  text: string;
  fontSize: number;
  color: { r: number; g: number; b: number };
  family: 'helvetica' | 'times' | 'courier';
  bold?: boolean;
  italic?: boolean;
  /** Display-space width the line should occupy, in points. */
  width: number;
  canvasFactory: CanvasFactory;
  /** Pixels per point. Bounded so a 200 pt line does not allocate a poster. */
  scale?: number;
}

export interface RasterisedText {
  data: Uint8Array;
  /** Display-space size in points. */
  width: number;
  height: number;
}

const MAX_RASTER_SCALE = 6;
const MAX_RASTER_PIXELS = 4_000_000;
const BASELINE_RATIO = 0.8;

function cssFamily(family: RasteriseTextOptions['family']): string {
  if (family === 'times') return '"Times New Roman", Times, serif';
  if (family === 'courier') return '"Courier New", Courier, monospace';
  return 'Arial, Helvetica, sans-serif';
}

function toHex(color: { r: number; g: number; b: number }): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/**
 * Rasterises one line. The canvas height follows the font's nominal box, so the
 * caller can place it at the same baseline a drawn line would use.
 */
export async function rasteriseTextLine(
  options: RasteriseTextOptions,
): Promise<RasterisedText | null> {
  if (options.text.length === 0) return null;
  const requested = options.scale ?? 4;
  const naturalWidth = Math.max(1, options.width);
  let scale = Math.min(MAX_RASTER_SCALE, Math.max(1, requested));
  const maxByArea = Math.sqrt(
    MAX_RASTER_PIXELS / Math.max(1, naturalWidth * options.fontSize * 1.4),
  );
  scale = Math.min(scale, Math.max(0.5, maxByArea));

  const widthPx = Math.max(1, Math.ceil(naturalWidth * scale) + 4);
  const heightPx = Math.max(1, Math.ceil(options.fontSize * 1.4 * scale) + 4);
  let canvas: RenderCanvas | null = null;
  try {
    canvas = options.canvasFactory(widthPx, heightPx);
    const context = canvas.context as {
      font: string;
      fillStyle: string;
      textBaseline: string;
      measureText?(text: string): { width: number };
      fillText(text: string, x: number, y: number): void;
      clearRect?(x: number, y: number, width: number, height: number): void;
    } | null;
    if (!context) return null;
    context.clearRect?.(0, 0, widthPx, heightPx);
    const weight = options.bold ? '700 ' : '';
    const style = options.italic ? 'italic ' : '';
    context.font = `${style}${weight}${options.fontSize * scale}px ${cssFamily(options.family)}`;
    context.fillStyle = toHex(options.color);
    context.textBaseline = 'alphabetic';
    // A point of padding keeps antialiased edges off the bitmap boundary.
    context.fillText(options.text, 2, options.fontSize * BASELINE_RATIO * scale + 2);
    const blob = await canvas.toBlob('image/png');
    const data = new Uint8Array(await blob.arrayBuffer());
    return {
      data,
      width: widthPx / scale,
      height: heightPx / scale,
    };
  } catch {
    return null;
  } finally {
    canvas?.release?.();
  }
}
