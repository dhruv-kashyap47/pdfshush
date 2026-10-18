/**
 * Caveat (SIL OFL 1.1, author Pablo Impallari) loader for the Type tab.
 *
 * Two variable (wght 400–700) subsets are bundled, not hotlinked (PLAN.md §2:
 * no Google Fonts links) and the license copy lives in `licenses/`. Faces are
 * registered lazily by the pad dialog chunk only -- no other surface should
 * pay the ~104 kB.
 */

import caveatLatinUrl from '@/assets/signature/caveat-latin-wght.woff2?url';
import caveatLatinExtUrl from '@/assets/signature/caveat-latin-ext-wght.woff2?url';

export const SIGNATURE_FONT_FAMILY = 'Caveat';

/* Subset ranges, mirrored from the font vendor's own css2 output. */
const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';

let loadFonts: Promise<boolean> | undefined;

/**
 * Resolves once both faces are loaded and usable. `false` means the Type tab
 * must fail visibly (disabled with a message) rather than silently falling
 * back to a generic serif that looks nothing like a signature (D4).
 */
export function loadSignatureFont(): Promise<boolean> {
  loadFonts ??= (async () => {
    try {
      const faces = [
        new FontFace(SIGNATURE_FONT_FAMILY, `url(${caveatLatinUrl}) format('woff2')`, {
          style: 'normal',
          weight: '400 700',
          display: 'swap',
          unicodeRange: LATIN_RANGE,
        }),
        new FontFace(SIGNATURE_FONT_FAMILY, `url(${caveatLatinExtUrl}) format('woff2')`, {
          style: 'normal',
          weight: '400 700',
          display: 'swap',
          unicodeRange: LATIN_EXT_RANGE,
        }),
      ];
      await Promise.all(faces.map(async (face) => {
        document.fonts.add(face);
        await face.load();
      }));
      return document.fonts.check(`16px ${SIGNATURE_FONT_FAMILY}`);
    } catch {
      return false;
    }
  })();
  return loadFonts;
}
