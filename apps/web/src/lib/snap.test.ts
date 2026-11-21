import { describe, expect, it } from 'vitest';
import { snapBox } from './snap';

const page = { width: 400, height: 300 };

describe('snap guides (E-07)', () => {
  it('snaps a box to the page centre on both axes', () => {
    const result = snapBox(
      { x: 198, y: 147, width: 4, height: 4 },
      page,
      [],
      { thresholdPt: 4 },
    );
    expect(result.x).toBe(198);
    expect(result.y).toBe(146);
    expect(result.guides.vertical).toEqual([200]);
    expect(result.guides.horizontal).toEqual([150]);
  });

  it('snaps an edge to another object and reports the guide', () => {
    const result = snapBox(
      { x: 102, y: 10, width: 20, height: 10 },
      page,
      [{ x: 100, y: 50, width: 60, height: 20 }],
      { thresholdPt: 3 },
    );
    expect(result.x).toBe(100);
    expect(result.guides.vertical).toEqual([100]);
    expect(result.snappedX).toBe(true);
    // Vertical position was not near anything: it stays exactly where it was.
    expect(result.y).toBe(10);
    expect(result.snappedY).toBe(false);
  });

  it('leaves the box untouched when the correction is outside the threshold', () => {
    const result = snapBox({ x: 190, y: 20, width: 4, height: 4 }, page, [], {
      thresholdPt: 2,
    });
    expect(result.x).toBe(190);
    expect(result.guides.vertical).toEqual([]);
  });

  it('Alt bypass disables snapping completely', () => {
    const result = snapBox({ x: 198, y: 147, width: 4, height: 4 }, page, [], {
      thresholdPt: 10,
      disabled: true,
    });
    expect(result).toMatchObject({
      x: 198,
      y: 147,
      snappedX: false,
      snappedY: false,
      guides: { vertical: [], horizontal: [] },
    });
  });

  it('keeps sub-point coordinates instead of rounding the move', () => {
    const result = snapBox({ x: 120.37, y: 50.61, width: 30, height: 12 }, page, [], {
      thresholdPt: 0.001,
    });
    expect(result.x).toBeCloseTo(120.37, 5);
    expect(result.y).toBeCloseTo(50.61, 5);
  });
});
