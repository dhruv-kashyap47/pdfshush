/**
 * Date stamps for the editor.
 *
 * Text drawn into a PDF goes through a standard WinAnsi font, so a "long date"
 * in an arbitrary locale can fail validation after the user has already placed
 * it. Formatting is therefore decided up front: use the requested locale when
 * every character is WinAnsi, otherwise fall back to a WinAnsi-safe format and
 * tell the caller, which warns the user.
 *
 * Pure and DOM-free, so `Intl` behaviour is pinned by unit tests rather than by
 * whatever locale the CI machine happens to have.
 */

export type StampDateLocale = 'en-GB' | 'en-US';

export interface StampDateResult {
  /** The date as it should be drawn. */
  text: string;
  /** The locale the text actually came from. */
  locale: StampDateLocale;
  /** True when the requested locale could not be represented in WinAnsi. */
  fallback: boolean;
}

const WIN_ANSI_TYPOGRAPHIC = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Mirrors the engine's `findUnencodable` policy. Kept local because importing
 * the engine module would pull pdf-lib into the main bundle.
 */
export function isWinAnsiText(text: string): boolean {
  for (const char of text) {
    if (char === '\n' || char === '\r' || char === '\t') continue;
    const codePoint = char.codePointAt(0)!;
    const allowed =
      (codePoint >= 0x20 && codePoint <= 0x7e) ||
      (codePoint >= 0xa0 && codePoint <= 0xff) ||
      WIN_ANSI_TYPOGRAPHIC.has(codePoint);
    if (!allowed) return false;
  }
  return true;
}

/**
 * Some locales separate the day and month with a narrow no-break space
 * (U+202F) or a no-break space (U+00A0). U+202F is not in WinAnsi, so both are
 * normalised to an ordinary space; the visual result is the same.
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f\u2009]/gu, ' ').trim();
}

function format(date: Date, locale: StampDateLocale): string {
  return normalizeSpaces(
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
  );
}

/**
 * Long date in the requested locale. Only en-GB and en-US are signed off; any
 * other locale is still formatted first so a real non-WinAnsi result is
 * detected (rather than assumed), then replaced by the en-GB fallback. An
 * invalid locale is treated the same way -- a stamp must never take the editor
 * down.
 */
export function formatStampDate(
  date: Date = new Date(),
  locale: string = 'en-GB',
): StampDateResult {
  // A caller can hand us an invalid Date (a parsed draft, a bad restore). Keep
  // the stamp usable with today rather than throwing out of the error path.
  const when = Number.isFinite(date.getTime()) ? date : new Date();
  let text: string;
  try {
    text = normalizeSpaces(
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(when),
    );
  } catch {
    return { text: format(when, 'en-GB'), locale: 'en-GB', fallback: true };
  }
  const supported = locale === 'en-GB' || locale === 'en-US';
  if (supported && isWinAnsiText(text)) {
    return { text, locale, fallback: false };
  }
  const safe = format(when, 'en-GB');
  return { text: safe, locale: 'en-GB', fallback: true };
}
