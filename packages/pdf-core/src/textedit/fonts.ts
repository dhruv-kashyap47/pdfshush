/**
 * Font classification and substitution for the editing engine.
 *
 * The native path never substitutes: it reuses the document's own font pointer,
 * so the replacement is drawn with the original embedded/subset font. This
 * module exists for the two cases where that is not possible:
 *
 *   - the fallback overlay needs a standard PDF font, and
 *   - capability analysis must tell the user *before* they edit whether the
 *     replacement glyphs exist in the original font.
 *
 * A substitution is always reported with a fidelity level. Nothing here silently
 * swaps Times for Helvetica and calls it preserved typography.
 */

export type StandardFontFamily = 'helvetica' | 'times' | 'courier';

export type FontFidelity = 'exact' | 'metric-compatible' | 'substitute' | 'none';

export interface FontSubstitution {
  family: StandardFontFamily;
  bold: boolean;
  italic: boolean;
  fidelity: FontFidelity;
  reason: string;
}

export interface FontLike {
  baseName?: string;
  familyName?: string;
  weight?: number;
  italicAngle?: number;
  flags?: number;
  monospace?: boolean;
  serif?: boolean;
  embedded?: boolean;
}

function lower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

/** Rough family category from descriptor flags first, names second. */
export function fontCategory(font: FontLike): 'sans' | 'serif' | 'mono' | 'unknown' {
  if (font.monospace) return 'mono';
  if (font.serif) return 'serif';
  if (((font.flags ?? 0) & 0x01) !== 0) return 'mono';
  if (((font.flags ?? 0) & 0x02) !== 0) return 'serif';
  const name = `${lower(font.baseName)} ${lower(font.familyName)}`;
  if (/courier|mono|consol|menlo/.test(name)) return 'mono';
  if (/times|serif|georgia|garamond|roman|book/.test(name)) return 'serif';
  if (/helvetica|arial|sans|grotesk|liberation sans/.test(name)) return 'sans';
  return 'unknown';
}

/** Weight/italic facts that the standard-font overlay can reproduce. */
export function standardStyle(font: FontLike): { bold: boolean; italic: boolean } {
  return {
    bold: (font.weight ?? 400) >= 600,
    italic: Math.abs(font.italicAngle ?? 0) > 0.5,
  };
}

/**
 * Closest standard font. `metric-compatible` means the family category is
 * known (so the substitution is intentional), `substitute` means the original
 * category was unknown and the caller must disclose the guess.
 */
export function substituteStandardFont(font: FontLike): FontSubstitution {
  const category = fontCategory(font);
  const style = standardStyle(font);
  if (category === 'serif') {
    return {
      family: 'times',
      ...style,
      fidelity: 'metric-compatible',
      reason: 'serif font substituted with Times (standard PDF font)',
    };
  }
  if (category === 'mono') {
    return {
      family: 'courier',
      ...style,
      fidelity: 'metric-compatible',
      reason: 'monospaced font substituted with Courier (standard PDF font)',
    };
  }
  if (category === 'sans') {
    return {
      family: 'helvetica',
      ...style,
      fidelity: 'metric-compatible',
      reason: 'sans-serif font substituted with Helvetica (standard PDF font)',
    };
  }
  return {
    family: 'helvetica',
    ...style,
    fidelity: 'substitute',
    reason: 'font family unknown; Helvetica used as an explicit substitute',
  };
}

/** Characters in `text` with no entry in the document-derived charcode map. */
export function missingGlyphs(
  map: ReadonlyMap<number, number> | null | undefined,
  text: string,
): string[] {
  if (!map) return [...new Set(Array.from(text))];
  const missing: string[] = [];
  for (const character of Array.from(text)) {
    if (!map.has(character.codePointAt(0)!)) missing.push(character);
  }
  return [...new Set(missing)];
}

/** Normalize a PDFium descriptor into the plain shape the rest of the engine uses. */
export function fontLikeFromPdfium(info: FontLike | null | undefined): FontLike {
  if (!info) return {};
  return {
    baseName: info.baseName,
    familyName: info.familyName,
    weight: info.weight,
    italicAngle: info.italicAngle,
    flags: info.flags,
    monospace: info.monospace,
    serif: info.serif,
    embedded: info.embedded,
  };
}

/**
 * Fidelity of a native replacement: reusing the exact font is only exact when
 * the document embeds it (or when it is one of the standard 14 fonts, which
 * every reader supplies). A non-embedded custom font is still reused by
 * PDFium, but its glyphs depend on the reader.
 */
export function nativeFontFidelity(info: FontLike | null): FontFidelity {
  if (!info) return 'none';
  if (info.embedded) return 'exact';
  const standard = /^(helvetica|times|courier|symbol|zapfdingbats)/i;
  const name = `${info.baseName} ${info.familyName}`;
  return standard.test(name) ? 'exact' : 'metric-compatible';
}
