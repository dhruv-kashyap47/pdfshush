import { describe, expect, it } from 'vitest';
import {
  QUALITY_SEARCH_ITERATIONS,
  computeExportInkBounds,
  fitQualityToTarget,
  normalizeSignatureExportOptions,
  signatureExportFileName,
} from '@/lib/signature-export';

function blankBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function mark(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  options: { alpha?: number; rgb?: [number, number, number] } = {},
): void {
  const index = (y * width + x) * 4;
  const [r, g, b] = options.rgb ?? [20, 20, 20];
  data[index] = r;
  data[index + 1] = g;
  data[index + 2] = b;
  data[index + 3] = options.alpha ?? 255;
}

describe('computeExportInkBounds', () => {
  it('returns null when the canvas has no ink', () => {
    const data = blankBuffer(80, 40);
    expect(computeExportInkBounds(data, 80, 40)).toBeNull();
  });

  it('finds the tight ink box and adds 16px of clamped padding', () => {
    const data = blankBuffer(100, 60);
    mark(data, 100, 20, 10);
    mark(data, 100, 50, 40);
    expect(computeExportInkBounds(data, 100, 60)).toEqual({
      x: 4,
      y: 0,
      width: 63,
      height: 57,
    });
  });

  it('ignores near-white opaque paper as well as transparency', () => {
    const data = blankBuffer(40, 20);
    // A flattened white background is not ink.
    mark(data, 40, 2, 2, { rgb: [250, 250, 250], alpha: 255 });
    expect(computeExportInkBounds(data, 40, 20)).toBeNull();

    // Alpha 10 is paper; alpha 11 is ink.
    mark(data, 40, 5, 5, { alpha: 10 });
    mark(data, 40, 8, 8, { alpha: 11 });
    expect(computeExportInkBounds(data, 40, 20)).toEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 20,
    });
  });

  it('honours a custom white threshold and padding', () => {
    const data = blankBuffer(30, 30);
    mark(data, 30, 10, 10, { rgb: [220, 220, 220] });
    expect(
      computeExportInkBounds(data, 30, 30, { whiteThreshold: 230, padding: 0 }),
    ).toEqual({ x: 10, y: 10, width: 1, height: 1 });
    expect(computeExportInkBounds(data, 30, 30, { whiteThreshold: 210 })).toBeNull();
  });

  it('rejects degenerate sizes and short buffers', () => {
    const data = blankBuffer(4, 4);
    expect(computeExportInkBounds(data, 0, 4)).toBeNull();
    expect(computeExportInkBounds(data, 4, 0)).toBeNull();
    expect(computeExportInkBounds(new Uint8ClampedArray(4), 4, 4)).toBeNull();
  });
});

describe('fitQualityToTarget', () => {
  const blobOf = (size: number) =>
    new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

  it('keeps the requested quality when it already fits', async () => {
    let calls = 0;
    const result = await fitQualityToTarget({
      maxBytes: 5_000,
      maxQuality: 92,
      encode: async (quality) => {
        calls += 1;
        return blobOf(quality * 50);
      },
    });
    expect(result.reached).toBe(true);
    expect(result.quality).toBe(92);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it('binary-searches the highest quality under the cap', async () => {
    const result = await fitQualityToTarget({
      maxBytes: 7_500,
      maxQuality: 92,
      encode: async (quality) => blobOf(quality * 100),
    });
    expect(result.reached).toBe(true);
    expect(result.quality).toBe(75);
    expect(result.blob.size).toBeLessThanOrEqual(7_500);
    expect(result.attempts).toBeLessThanOrEqual(1 + QUALITY_SEARCH_ITERATIONS);
  });

  it('returns the smallest attempt with a warning when the cap is unreachable', async () => {
    const result = await fitQualityToTarget({
      maxBytes: 2_000,
      maxQuality: 92,
      encode: async (quality) => blobOf(quality * 100),
    });
    expect(result.reached).toBe(false);
    expect(result.quality).toBe(50);
    expect(result.blob.size).toBe(5_000);
    expect(result.attempts).toBeLessThanOrEqual(1 + QUALITY_SEARCH_ITERATIONS);
  });

  it('never drops below the 50% floor', async () => {
    const seen: number[] = [];
    await fitQualityToTarget({
      maxBytes: 1,
      minQuality: 10,
      maxQuality: 10,
      encode: async (quality) => {
        seen.push(quality);
        return blobOf(100);
      },
    });
    expect(seen).toEqual([50]);
  });
});

describe('signatureExportFileName', () => {
  it('uses the local date and the requested extension', () => {
    expect(signatureExportFileName('png', new Date(2026, 10, 13))).toBe(
      'signature-2026-11-13.png',
    );
    expect(signatureExportFileName('pdf', new Date(2026, 0, 2))).toBe(
      'signature-2026-01-02.pdf',
    );
  });
});

describe('normalizeSignatureExportOptions', () => {
  it('keeps trimming on when the option is omitted', () => {
    expect(normalizeSignatureExportOptions({ format: 'png' }).trim).toBe(true);
    // An explicit undefined is still "not provided", not "off".
    expect(normalizeSignatureExportOptions({ trim: undefined }).trim).toBe(true);
  });

  it('honours an explicit trim=false and clamps quality', () => {
    const options = normalizeSignatureExportOptions({ trim: false, quality: 1 });
    expect(options.trim).toBe(false);
    expect(options.quality).toBe(50);
  });
});
