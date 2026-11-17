import { describe, expect, it } from 'vitest';
import {
  INK_MAX_POINTS,
  INK_SAMPLE_DISTANCE_PT,
  capInkPoints,
  inkBounds,
  normalizeInk,
  sampleInk,
  scaleInkPoints,
  simplifyInk,
  type InkPoint,
} from './ink';

function line(count: number): InkPoint[] {
  return Array.from({ length: count }, (_, index) => ({ x: index, y: 0 }));
}

describe('sampleInk', () => {
  it('drops samples closer than the minimum distance', () => {
    const start = [{ x: 0, y: 0 }];
    expect(sampleInk(start, { x: 0.2, y: 0 })).toBe(start);
    expect(sampleInk(start, { x: INK_SAMPLE_DISTANCE_PT, y: 0 })).toHaveLength(2);
  });

  it('ignores non-finite pointer samples', () => {
    const start = [{ x: 0, y: 0 }];
    expect(sampleInk(start, { x: Number.NaN, y: 0 })).toBe(start);
  });
});

describe('capInkPoints', () => {
  it('returns the input untouched below the cap', () => {
    const points = line(10);
    expect(capInkPoints(points, 10)).toBe(points);
  });

  it('keeps the endpoints and the requested count', () => {
    const capped = capInkPoints(line(1_000), 100);
    expect(capped).toHaveLength(100);
    expect(capped[0]).toEqual({ x: 0, y: 0 });
    expect(capped[99]).toEqual({ x: 999, y: 0 });
  });

  it('is bounded by the shared maximum', () => {
    expect(capInkPoints(line(INK_MAX_POINTS + 500))).toHaveLength(INK_MAX_POINTS);
  });
});

describe('simplifyInk', () => {
  it('collapses a collinear run to its endpoints', () => {
    expect(simplifyInk(line(200))).toEqual([
      { x: 0, y: 0 },
      { x: 199, y: 0 },
    ]);
  });

  it('keeps a corner', () => {
    const points: InkPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ];
    expect(simplifyInk(points)).toEqual(points);
  });

  it('keeps the first and last point of a noisy stroke', () => {
    const simplified = simplifyInk([
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: -0.1 },
      { x: 3, y: 0 },
    ]);
    expect(simplified[0]).toEqual({ x: 0, y: 0 });
    expect(simplified[simplified.length - 1]).toEqual({ x: 3, y: 0 });
  });
});

describe('inkBounds', () => {
  it('returns null for an empty stroke', () => {
    expect(inkBounds([])).toBeNull();
  });

  it('never reports a zero-size box', () => {
    expect(inkBounds([{ x: 4, y: 4 }])).toEqual({ x: 4, y: 4, width: 1, height: 1 });
    expect(inkBounds([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 1,
    });
  });
});

describe('normalizeInk', () => {
  it('returns points relative to a tight box', () => {
    const normalized = normalizeInk([
      { x: 100, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 140 },
    ]);
    expect(normalized).not.toBeNull();
    expect(normalized!.bounds).toEqual({ x: 100, y: 100, width: 50, height: 40 });
    expect(normalized!.points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
    ]);
  });

  it('returns null for no points', () => {
    expect(normalizeInk([])).toBeNull();
  });
});

describe('scaleInkPoints', () => {
  it('scales relative points with the box', () => {
    expect(
      scaleInkPoints(
        [
          { x: 10, y: 5 },
          { x: 20, y: 10 },
        ],
        { width: 20, height: 10 },
        { width: 40, height: 20 },
      ),
    ).toEqual([
      { x: 20, y: 10 },
      { x: 40, y: 20 },
    ]);
  });

  it('does not divide by zero on a degenerate source box', () => {
    expect(
      scaleInkPoints([{ x: 1, y: 1 }], { width: 0, height: 0 }, { width: 10, height: 10 }),
    ).toEqual([{ x: 1, y: 1 }]);
  });
});
