/**
 * Dark-mode transforms — pure, dependency-free, Node-testable.
 *
 * The approach is ported from the MIT-licensed
 * `chizkiyahu/pdf-dark-mode-converter` (attribution in
 * `licenses/pdf-dark-mode-converter-MIT.txt`): a page is rasterized on the
 * pdf.js pipeline the rest of the product renders with, then every pixel's
 * BT.601 brightness is remapped so dark ink stays bright and white paper lands
 * on a chosen dark theme. This module owns the per-pixel math so the browser
 * preview on the main thread and the job inside the worker apply byte-identical
 * transforms — the same reason `ops/ranges.ts` and `ops/textMetrics.ts` carry
 * no imports.
 *
 * Three kinds:
 * - `theme`  — the reference remap: white paper → the theme background, black
 *              ink → white, everything else follows brightness. The best read
 *              for text documents; chroma follows luma rather than its own hue.
 * - `smart`  — lightness flips while each colour keeps its hue (an HSL
 *              L → 1 − L pass), so charts and images stay recognisable.
 * - `invert` — the classic 255 − channel negative.
 */

export type DarkModeThemeId = 'ink' | 'warm' | 'cool' | 'sepia' | 'midnight' | 'forest';

export interface DarkModeTheme {
  id: DarkModeThemeId;
  label: string;
  /** Theme background, 0..255. Ink renders as white on top of it. */
  r: number;
  g: number;
  b: number;
}

export type DarkModeKind = 'theme' | 'smart' | 'invert';

/**
 * The theme set from the reference project (values preserved; ids renamed to
 * neutral words for this product). `ink` is the reference's "Classic".
 */
export const DARK_MODE_THEMES: readonly DarkModeTheme[] = [
  { id: 'ink', label: 'Ink', r: 0, g: 0, b: 0 },
  { id: 'warm', label: 'Warm', r: 42, g: 37, b: 34 },
  { id: 'cool', label: 'Cool', r: 52, g: 53, b: 65 },
  { id: 'sepia', label: 'Sepia', r: 40, g: 35, b: 25 },
  { id: 'midnight', label: 'Midnight', r: 25, g: 30, b: 45 },
  { id: 'forest', label: 'Forest', r: 25, g: 35, b: 30 },
];

export const DARK_MODE_DEFAULT_THEME: DarkModeThemeId = 'ink';

const THEME_IDS: ReadonlySet<string> = new Set(DARK_MODE_THEMES.map((theme) => theme.id));

export function isDarkModeThemeId(value: unknown): value is DarkModeThemeId {
  return typeof value === 'string' && THEME_IDS.has(value);
}

export function darkModeTheme(id: DarkModeThemeId): DarkModeTheme {
  const found = DARK_MODE_THEMES.find((theme) => theme.id === id);
  // `default` only fires for a caller that bypassed validation; fall back to ink.
  return found ?? DARK_MODE_THEMES[0]!;
}

const clamp255 = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/**
 * The reference remap: brightness 0 (black ink) → white, brightness 255 (white
 * paper) → the theme background. `factor` interpolates that span. Mutates
 * `pixels` in place; alpha is left as painted (pdf.js renders pages opaque).
 */
export function applyThemeRgba(pixels: Uint8ClampedArray, theme: DarkModeTheme): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const brightness = 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
    const factor = 1 - brightness / 255;
    pixels[i] = theme.r + (255 - theme.r) * factor;
    pixels[i + 1] = theme.g + (255 - theme.g) * factor;
    pixels[i + 2] = theme.b + (255 - theme.b) * factor;
  }
}

/** Classic negative: 255 − channel. */
export function applyInvertRgba(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i]!;
    pixels[i + 1] = 255 - pixels[i + 1]!;
    pixels[i + 2] = 255 - pixels[i + 2]!;
  }
}

/**
 * Smart invert: convert to HSL, flip lightness, come back. Hue (and the
 * saturation curve) survive, so a blue chart bar stays blue while dark ink on a
 * white page still becomes white ink on a dark page. Grey pixels (max = min)
 * take the simple branch. Slightly more work than the other two kinds per
 * pixel, but it is still one pass over one page at a time.
 */
export function applyHuePreservingRgba(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]! / 255;
    const g = pixels[i + 1]! / 255;
    const b = pixels[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) / 6 + (g < b ? 1 : 0);
      else if (max === g) h = ((b - r) / d) / 6 + 1 / 3;
      else h = ((r - g) / d) / 6 + 2 / 3;
    }
    const l2 = 1 - l;
    const c = (1 - Math.abs(2 * l2 - 1)) * s;
    const hp = h * 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l2 - c / 2;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    if (hp < 1) [r2, g2, b2] = [c, x, 0];
    else if (hp < 2) [r2, g2, b2] = [x, c, 0];
    else if (hp < 3) [r2, g2, b2] = [0, c, x];
    else if (hp < 4) [r2, g2, b2] = [0, x, c];
    else if (hp < 5) [r2, g2, b2] = [x, 0, c];
    else [r2, g2, b2] = [c, 0, x];
    pixels[i] = clamp255((r2 + m) * 255);
    pixels[i + 1] = clamp255((g2 + m) * 255);
    pixels[i + 2] = clamp255((b2 + m) * 255);
  }
}

/** Applies the transform for `kind` in place. `theme` is only read for `theme`. */
export function applyDarkModeRgba(
  pixels: Uint8ClampedArray,
  kind: DarkModeKind,
  theme: DarkModeTheme,
): void {
  if (kind === 'invert') applyInvertRgba(pixels);
  else if (kind === 'smart') applyHuePreservingRgba(pixels);
  else applyThemeRgba(pixels, theme);
}
