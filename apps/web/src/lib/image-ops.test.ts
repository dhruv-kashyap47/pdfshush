import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FILTERS,
  MIN_CROP_PX,
  clampCropRect,
  filterString,
  rectFromDrag,
  selectionToCrop,
  sizeAfterOps,
} from './image-ops';

describe('image operation geometry', () => {
  test('odd quarter turns swap the dimensions and even turns do not', () => {
    const source = { width: 400, height: 200 };
    expect(sizeAfterOps(source, [{ kind: 'rotate', turns: 1 }])).toEqual({ width: 200, height: 400 });
    expect(sizeAfterOps(source, [{ kind: 'rotate', turns: 2 }])).toEqual({ width: 400, height: 200 });
    expect(sizeAfterOps(source, [{ kind: 'rotate', turns: 3 }])).toEqual({ width: 200, height: 400 });
  });

  test('a crop replaces the current dimensions, in operation order', () => {
    const source = { width: 400, height: 200 };
    const ops = [
      { kind: 'rotate', turns: 1 } as const,
      { kind: 'flip', axis: 'horizontal' } as const,
      { kind: 'crop', rect: { x: 10, y: 20, width: 80, height: 50 } } as const,
    ];
    expect(sizeAfterOps(source, ops)).toEqual({ width: 80, height: 50 });
  });
});

describe('crop clamping', () => {
  test('clamps negative and overflowing rectangles to the image', () => {
    const rect = clampCropRect({ x: -20, y: -5, width: 120, height: 120 }, { width: 100, height: 80 });
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  test('rounds edges to whole pixels rather than the width', () => {
    const rect = clampCropRect({ x: 1.4, y: 2.6, width: 40.2, height: 30.8 }, { width: 100, height: 100 });
    // Edges are rounded, so the right edge lands on 42 and the crop is 41 wide.
    expect(rect).toEqual({ x: 1, y: 3, width: 41, height: 30 });
  });

  test('rejects a hairline selection instead of producing a blank canvas', () => {
    expect(
      clampCropRect({ x: 0, y: 0, width: MIN_CROP_PX - 1, height: 40 }, { width: 100, height: 100 }),
    ).toBeNull();
    expect(clampCropRect({ x: 90, y: 0, width: 40, height: 40 }, { width: 100, height: 100 })?.width).toBe(10);
  });
});

describe('drag selection', () => {
  test('normalizes a reverse drag and clamps it to the image', () => {
    expect(rectFromDrag({ x: 0.8, y: 0.9 }, { x: -0.2, y: 0.2 })).toEqual({
      x: 0,
      y: 0.2,
      width: 0.8,
      height: 0.7,
    });
  });

  test('ignores a click-sized selection', () => {
    expect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.51 })).toBeNull();
  });

  test('scales a normalized selection into pixels and clamps it', () => {
    const crop = selectionToCrop({ x: 0.5, y: 0.5, width: 0.75, height: 0.25 }, { width: 400, height: 200 });
    expect(crop).toEqual({ x: 200, y: 100, width: 200, height: 50 });
  });
});

describe('tone filters', () => {
  test('clamps brightness and contrast to a sane range', () => {
    expect(filterString({ brightness: 900, contrast: -40, grayscale: false })).toBe(
      'brightness(200%) contrast(0%) grayscale(0)',
    );
  });

  test('defaults leave the image untouched', () => {
    expect(filterString(DEFAULT_FILTERS)).toBe('brightness(100%) contrast(100%) grayscale(0)');
  });
});
