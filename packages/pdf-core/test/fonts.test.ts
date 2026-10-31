import { describe, expect, it } from 'vitest';
import {
  fontCategory,
  missingGlyphs,
  nativeFontFidelity,
  standardStyle,
  substituteStandardFont,
} from '../src/textedit/fonts.js';

describe('font classification and substitution', () => {
  it('classifies by descriptor flags before names', () => {
    expect(fontCategory({ flags: 0x01, baseName: 'Custom' })).toBe('mono');
    expect(fontCategory({ flags: 0x02, baseName: 'Custom' })).toBe('serif');
    expect(fontCategory({ baseName: 'Helvetica' })).toBe('sans');
    expect(fontCategory({ baseName: 'Courier New' })).toBe('mono');
    expect(fontCategory({ baseName: 'Times-Roman' })).toBe('serif');
    expect(fontCategory({ baseName: 'Mystery' })).toBe('unknown');
  });

  it('substitutes explicitly and reports fidelity', () => {
    expect(substituteStandardFont({ baseName: 'Helvetica', weight: 700 }).family).toBe('helvetica');
    expect(substituteStandardFont({ baseName: 'Helvetica', weight: 700 }).bold).toBe(true);
    expect(substituteStandardFont({ baseName: 'Times-Roman' }).family).toBe('times');
    expect(substituteStandardFont({ baseName: 'Courier' }).family).toBe('courier');
    const unknown = substituteStandardFont({ baseName: 'Mystery' });
    expect(unknown.family).toBe('helvetica');
    expect(unknown.fidelity).toBe('substitute');
  });

  it('detects italic angle and missing glyphs', () => {
    expect(standardStyle({ italicAngle: -12 }).italic).toBe(true);
    const map = new Map<number, number>([
      [0x41, 65],
      [0x42, 66],
    ]);
    expect(missingGlyphs(map, 'AB')).toEqual([]);
    expect(missingGlyphs(map, 'ABC')).toEqual(['C']);
    expect(missingGlyphs(null, 'AB')).toEqual(['A', 'B']);
  });

  it('never calls a non-embedded custom font exact', () => {
    expect(
      nativeFontFidelity({
        baseName: 'Helvetica',
        embedded: false,
      }),
    ).toBe('exact');
    expect(
      nativeFontFidelity({
        baseName: 'MysteryFace',
        embedded: false,
      }),
    ).toBe('metric-compatible');
    expect(
      nativeFontFidelity({
        baseName: 'MysteryFace',
        embedded: true,
      }),
    ).toBe('exact');
  });
});
