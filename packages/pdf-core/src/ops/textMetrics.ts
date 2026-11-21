/**
 * Text metrics shared by the exporter and the editor preview.
 *
 * This module is deliberately dependency-free (same rule as `ops/ranges.ts`):
 * the web app imports these numbers to style its textarea, and importing a
 * value from a module that reaches for `@cantoo/pdf-lib` would pull the whole
 * library into the main browser bundle.
 */

/** CSS `line-height` the editor preview renders text with. */
export const TEXT_LINE_HEIGHT = 1.2;

/**
 * Where the first baseline sits below the text box top.
 *
 * With `line-height: 1.2` over an Arial-metric font stack, CSS places the
 * baseline at `(1.2 - (0.905 + 0.212)) / 2 + 0.905 = 0.9465em`. The exporter
 * reproduces that, so text does not jump when a document is saved.
 */
export const TEXT_ASCENT = 0.9465;

/**
 * C-08: the horizontal-scale window a replacement may use to fit its box.
 *
 * `Tz` (character squeeze) is the honest way to keep a line's right edge when a
 * replacement is slightly wider than the run it replaces. The outer window is
 * the product limit (40-250%); inside it, 70-140% is the range that still
 * reads as normal typography. Outside that inner band the text is not refused
 * -- it is drawn and the export receipt names the squeeze.
 */
export const TEXT_FIT_MIN_PERCENT = 40;
export const TEXT_FIT_MAX_PERCENT = 250;
export const TEXT_FIT_READABLE_MIN_PERCENT = 70;
export const TEXT_FIT_READABLE_MAX_PERCENT = 140;

export interface TextFit {
  /** Horizontal scale as a percentage (100 = untouched). */
  percent: number;
  /** True when fitting required any squeeze or stretch. */
  fitted: boolean;
  /** True when the line has to be squeezed/stretched outside the readable band. */
  unreadable: boolean;
  /** Width after applying `percent`. */
  width: number;
}

/**
 * Fits one measured line into `maxWidth`.
 *
 * The clamp is deliberate: a line that would need 20% is not scaled into
 * illegibility, it stops at 40% and the caller can decide to wrap or rasterise.
 * A line that already fits is left at exactly 100%, so ordinary text never
 * pays a `Tz` write.
 */
export function fitTextToWidth(naturalWidth: number, maxWidth: number): TextFit {
  const width = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 0;
  const target = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : 0;
  if (width === 0 || target === 0 || width <= target) {
    return { percent: 100, fitted: false, unreadable: false, width };
  }
  const raw = (target / width) * 100;
  const percent = Math.min(TEXT_FIT_MAX_PERCENT, Math.max(TEXT_FIT_MIN_PERCENT, raw));
  return {
    percent,
    fitted: percent !== 100,
    unreadable:
      percent < TEXT_FIT_READABLE_MIN_PERCENT || percent > TEXT_FIT_READABLE_MAX_PERCENT,
    width: width * (percent / 100),
  };
}