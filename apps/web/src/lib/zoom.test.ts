import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitZoom, parseZoomPercent } from './zoom';

describe('clampZoom', () => {
  it('allows the full 25–400% window', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(4)).toBe(4);
    expect(clampZoom(0.25)).toBe(0.25);
  });

  it('rounds to a 5% step', () => {
    expect(clampZoom(1.234)).toBe(1.25);
    expect(clampZoom(0.777)).toBe(0.8);
  });

  it('falls back to 100% for a non-finite value', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('fitZoom', () => {
  const portrait = { width: 612, height: 792 };
  const landscape = { width: 792, height: 612 };
  const viewport = { width: 900, height: 700, paddingX: 40, paddingY: 40 };

  it('fits width using the page width only', () => {
    expect(fitZoom(viewport, portrait, 'width')).toBe(1.4);
    expect(fitZoom(viewport, landscape, 'width')).toBe(1.1);
  });

  it('fits the whole page using both dimensions', () => {
    // Width would allow 1.4x for portrait, but 658/792 caps it at 0.85.
    expect(fitZoom(viewport, portrait, 'page')).toBe(0.85);
    expect(fitZoom(viewport, landscape, 'page')).toBe(1.1);
  });

  it('centres a landscape page instead of letting it overflow', () => {
    const heightLimited = { width: 900, height: 400, paddingX: 40, paddingY: 40 };
    expect(fitZoom(heightLimited, landscape, 'page')).toBeLessThan(
      fitZoom(heightLimited, landscape, 'width'),
    );
  });

  it('never returns zero for a degenerate viewport', () => {
    expect(fitZoom({ width: 0, height: 0 }, portrait, 'page')).toBe(MIN_ZOOM);
  });
});

describe('parseZoomPercent', () => {
  it('parses plain numbers and a trailing percent sign', () => {
    expect(parseZoomPercent('150')).toBe(1.5);
    expect(parseZoomPercent('150%')).toBe(1.5);
    expect(parseZoomPercent(' 37.5 ')).toBe(0.4);
  });

  it('clamps typed values to the supported window', () => {
    expect(parseZoomPercent('999')).toBe(MAX_ZOOM);
    expect(parseZoomPercent('1')).toBe(MIN_ZOOM);
    expect(parseZoomPercent('400')).toBe(4);
  });

  it('rejects unusable input so the current zoom can be restored', () => {
    expect(parseZoomPercent('')).toBeNull();
    expect(parseZoomPercent('abc')).toBeNull();
    expect(parseZoomPercent('0')).toBeNull();
    expect(parseZoomPercent('-20')).toBeNull();
  });
});
