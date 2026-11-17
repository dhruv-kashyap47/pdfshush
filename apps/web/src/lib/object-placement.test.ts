import { describe, expect, it } from 'vitest';
import { clampToPage, intersectsPage, offsetOnPage } from './object-placement';

const page = { width: 595, height: 842 };

describe('clampToPage', () => {
  it('leaves an on-page rect alone', () => {
    const rect = { x: 100, y: 200, width: 80, height: 40 };
    expect(clampToPage(rect, page)).toEqual(rect);
  });

  it('pulls an off-edge object back inside', () => {
    expect(clampToPage({ x: 560, y: 830, width: 80, height: 40 }, page)).toEqual({
      x: 515,
      y: 802,
      width: 80,
      height: 40,
    });
    expect(clampToPage({ x: -50, y: -20, width: 80, height: 40 }, page)).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 40,
    });
  });

  it('pins an oversized object to the top-left rather than off the page', () => {
    expect(clampToPage({ x: 40, y: 40, width: 900, height: 1_200 }, page)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 1_200,
    });
  });

  it('repairs non-finite coordinates', () => {
    expect(clampToPage({ x: Number.NaN, y: 30, width: 10, height: 10 }, page).x).toBe(0);
    expect(clampToPage({ x: 10, y: 10, width: Number.NaN, height: 10 }, page).x).toBe(10);
  });
});

describe('offsetOnPage', () => {
  it('applies the duplicate and paste offsets', () => {
    const rect = { x: 10, y: 10, width: 50, height: 50 };
    expect(offsetOnPage(rect, page, 8, 8)).toEqual({ ...rect, x: 18, y: 18 });
    expect(offsetOnPage(rect, page, 12, 12)).toEqual({ ...rect, x: 22, y: 22 });
  });

  it('clamps a copy near the edge and keeps it on the page', () => {
    const rect = { x: 570, y: 830, width: 20, height: 10 };
    const moved = offsetOnPage(rect, page, 12, 12);
    expect(moved.x + moved.width).toBeLessThanOrEqual(page.width);
    expect(moved.y + moved.height).toBeLessThanOrEqual(page.height);
    expect(intersectsPage(moved, page)).toBe(true);
  });
});

describe('intersectsPage', () => {
  it('rejects a box entirely past every edge', () => {
    expect(intersectsPage({ x: 700, y: 10, width: 40, height: 40 }, page)).toBe(false);
    expect(intersectsPage({ x: -100, y: 10, width: 40, height: 40 }, page)).toBe(false);
  });

  it('accepts an overhanging box that still covers page pixels', () => {
    expect(intersectsPage({ x: -10, y: -10, width: 40, height: 40 }, page)).toBe(true);
  });
});
