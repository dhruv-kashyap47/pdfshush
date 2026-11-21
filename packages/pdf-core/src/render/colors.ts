/**
 * C-11: ink colour sampling.
 *
 * pdf.js exposes text geometry and style, but not the fill colour that painted
 * a run. The editor therefore defaulted every replacement to near-black, which
 * is wrong the moment a document uses a coloured heading or a red stamp.
 *
 * This module samples the rendered page instead -- the only source that is true
 * for every PDF, whatever produced it. It is deliberately bounded:
 *
 *   - one render per page, at a modest width;
 *   - a fixed number of lines sampled per page;
 *   - antialiasing and the page's own paper colour are rejected by distance,
 *     then the strongest ink pixels are averaged.
 *
 * A page with no measurable ink simply yields no colour; callers keep their
 * default rather than inventing one.
 */

import type { PageLayout } from '../document/types.js';
import type { CanvasFactory } from './canvas.js';
import { renderPageToCanvas } from './renderPage.js';

export interface SampleColorOptions {
  canvasFactory?: CanvasFactory;
  /** Rendered width for sampling. 600-900 is enough for glyph ink. */
  targetWidthPx?: number;
  /** Hard cap on sampled lines per page. */
  maxLines?: number;
}

const DEFAULT_WIDTH = 720;
const DEFAULT_MAX_LINES = 240;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toHex(color: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function paperColor(data: Uint8ClampedArray, width: number, height: number): Rgb {
  const points: Array<[number, number]> = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [0, Math.floor(height / 2)],
  ];
  const samples: Rgb[] = [];
  for (const [x, y] of points) {
    const index = (Math.max(0, y) * width + Math.max(0, x)) * 4;
    samples.push({
      r: data[index] ?? 255,
      g: data[index + 1] ?? 255,
      b: data[index + 2] ?? 255,
    });
  }
  samples.sort((a, b) => a.r + a.g + a.b - (b.r + b.g + b.b));
  const median = samples[Math.floor(samples.length / 2)] ?? { r: 255, g: 255, b: 255 };
  return median;
}

/**
 * Applies sampled colours in place to lines and paragraphs. Returns the number
 * of lines that produced a colour.
 */
export async function applySampledTextColors(
  page: Parameters<typeof renderPageToCanvas>[0],
  layout: PageLayout,
  viewport: { width: number; height: number },
  options: SampleColorOptions = {},
): Promise<number> {
  if (layout.lines.length === 0) return 0;
  const rendered = await renderPageToCanvas(page, {
    targetWidthPx: options.targetWidthPx ?? DEFAULT_WIDTH,
    format: 'png',
    ...(options.canvasFactory ? { canvasFactory: options.canvasFactory } : {}),
  });
  try {
    const context = rendered.context as {
      getImageData(x: number, y: number, w: number, h: number): {
        data: Uint8ClampedArray;
      };
    } | null;
    if (!context) return 0;
    const scaleX = rendered.width / Math.max(1, viewport.width);
    const scaleY = rendered.height / Math.max(1, viewport.height);
    const paper = paperColor(
      context.getImageData(0, 0, rendered.width, rendered.height).data,
      rendered.width,
      rendered.height,
    );

    const lineColors = new Map<string, string>();
    const limit = Math.min(layout.lines.length, options.maxLines ?? DEFAULT_MAX_LINES);
    for (let index = 0; index < limit; index += 1) {
      const line = layout.lines[index]!;
      const left = Math.max(0, Math.floor(line.bbox.x * scaleX));
      const top = Math.max(0, Math.floor(line.bbox.y * scaleY));
      const right = Math.min(rendered.width, Math.ceil((line.bbox.x + line.bbox.width) * scaleX));
      const bottom = Math.min(
        rendered.height,
        Math.ceil((line.bbox.y + line.bbox.height) * scaleY),
      );
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) continue;
      const image = context.getImageData(left, top, width, height);
      const ink: Array<{ color: Rgb; weight: number }> = [];
      const step = Math.max(1, Math.floor(Math.min(width, height) / 16));
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const at = (y * width + x) * 4;
          const color = {
            r: image.data[at] ?? paper.r,
            g: image.data[at + 1] ?? paper.g,
            b: image.data[at + 2] ?? paper.b,
          };
          const d = distance(color, paper);
          // 42 rejects antialiasing and compression noise while keeping dark
          // and saturated inks; the paper-colour comparison keeps this correct
          // on tinted pages too.
          if (d >= 42) ink.push({ color, weight: d });
        }
      }
      if (ink.length < 3) continue;
      ink.sort((a, b) => b.weight - a.weight);
      const strongest = ink.slice(0, Math.max(3, Math.floor(ink.length * 0.4)));
      const total = strongest.reduce((sum, sample) => sum + sample.weight, 0);
      const color = strongest.reduce(
        (sum, sample) => ({
          r: sum.r + (sample.color.r * sample.weight) / total,
          g: sum.g + (sample.color.g * sample.weight) / total,
          b: sum.b + (sample.color.b * sample.weight) / total,
        }),
        { r: 0, g: 0, b: 0 },
      );
      const hex = toHex(color);
      lineColors.set(line.id, hex);
      line.typography = { ...line.typography, color: hex };
    }

    if (lineColors.size === 0) return 0;
    for (const paragraph of layout.paragraphs) {
      const colors = paragraph.lineIds
        .map((id) => lineColors.get(id))
        .filter((color): color is string => Boolean(color));
      if (colors.length === 0) continue;
      const counts = new Map<string, number>();
      for (const color of colors) counts.set(color, (counts.get(color) ?? 0) + 1);
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      paragraph.typography = { ...paragraph.typography, color: dominant };
    }
    return lineColors.size;
  } finally {
    rendered.canvas.release?.();
  }
}
