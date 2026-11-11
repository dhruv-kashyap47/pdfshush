/**
 * PDF-RENDER-003, session 6 decision: do not bundle a CJK fallback font.
 *
 * The audit keeps the `it.fails` glyph repro in `render-regression.test.ts`:
 * a non-embedded Type0 font still paints `.notdef` boxes. What changed is that
 * the loss is no longer silent -- the render jobs carry a warning naming the
 * font, which the result screen shows as a non-blocking notice.
 */

import { describe, expect, it } from 'vitest';

import { nonEmbeddedFontWarnings } from '../../src/render/fontWarnings.js';
import { readAuditFixture } from './fixtures.js';

describe('non-embedded font warnings (PDF-RENDER-003)', () => {
  it('names the CJK font that has no glyph program', async () => {
    const warnings = await nonEmbeddedFontWarnings(readAuditFixture('nonembedded-cjk.pdf'));
    expect(warnings.join(' ')).toMatch(/non-embedded/i);
    expect(warnings.join(' ')).toContain('STSong-Light');
  });

  it('stays quiet for a normal embedded/standard-font PDF', async () => {
    expect(await nonEmbeddedFontWarnings(readAuditFixture('tiny-1page.pdf'))).toEqual([]);
  });
});
