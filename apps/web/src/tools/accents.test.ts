/**
 * The colour-identity gate.
 *
 * Tests are the only thing stopping the palette from quietly rotting into a
 * pile of one-off hex values: every catalog entry must name a known accent, the
 * two anchor examples stay stable, and no palette hue is dead weight.
 */

import { describe, expect, it } from 'vitest';
import { ACCENT_FAMILY, ACCENT_NAMES } from './accents';
import { ALL_TOOLS, getTool } from './registry';

describe('tool colour identity', () => {
  it('gives every catalog entry a known accent', () => {
    for (const tool of ALL_TOOLS) {
      expect(ACCENT_NAMES, tool.slug).toContain(tool.accent);
    }
  });

  it('keeps the anchor examples stable', () => {
    expect(getTool('merge-pdf')?.accent).toBe(ACCENT_FAMILY.merge);
    expect(getTool('split-by-pages')?.accent).toBe(ACCENT_FAMILY.split);
    expect(getTool('merge-pdf')?.accent).toBe('red');
    expect(getTool('split-by-pages')?.accent).toBe('blue');
  });

  it('uses every accent in the palette', () => {
    const used = new Set(ALL_TOOLS.map((tool) => tool.accent));
    expect([...ACCENT_NAMES].filter((accent) => !used.has(accent))).toEqual([]);
  });
});
