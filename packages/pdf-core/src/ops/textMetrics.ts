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