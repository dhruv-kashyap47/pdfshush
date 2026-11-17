import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_LABEL_MAX_CHARS,
  SIGNATURE_PNG_MAX_BYTES,
  SIGNATURE_STROKES_SCHEMA,
  SIGNATURE_STORE_MAX,
  computeInkBounds,
  inkAlphaFromLuminance,
  isSignatureAssetRecord,
  pngPixelSize,
  sanitizeSignatureLabel,
  scaledSignatureSize,
} from '@/lib/signature-assets';

/** Builds an rgba buffer of `width×height` from a list of marked pixels. */
function blankBuffer(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function mark(data: Uint8ClampedArray, width: number, x: number, y: number, alpha = 255): void {
  const index = (y * width + x) * 4;
  data[index] = 20;
  data[index + 1] = 20;
  data[index + 2] = 20;
  data[index + 3] = alpha;
}

describe('sanitizeSignatureLabel', () => {
  it('passes a plain label through', () => {
    expect(sanitizeSignatureLabel('J. R. Smith')).toBe('J. R. Smith');
  });

  it('returns undefined for empty and whitespace-only input', () => {
    expect(sanitizeSignatureLabel('')).toBeUndefined();
    expect(sanitizeSignatureLabel('   ')).toBeUndefined();
    expect(sanitizeSignatureLabel(undefined)).toBeUndefined();
    expect(sanitizeSignatureLabel(null)).toBeUndefined();
  });

  it('strips control characters (including newline and tab: labels are single-line) and flattens whitespace runs', () => {
    expect(sanitizeSignatureLabel('Jane\u0000\u001fDoe\n\n\tX')).toBe('JaneDoeX');
    expect(sanitizeSignatureLabel('  Jane   Doe  ')).toBe('Jane Doe');
  });

  it('caps at the label limit without producing multi-character garbage', () => {
    const long = 'A'.repeat(SIGNATURE_LABEL_MAX_CHARS + 10);
    expect([...sanitizeSignatureLabel(long)!]).toHaveLength(SIGNATURE_LABEL_MAX_CHARS);
    // Astral-plane surrogate pairs are counted as single code points.
    const emojiName = `B${'🩷'.repeat(SIGNATURE_LABEL_MAX_CHARS)}`;
    const result = sanitizeSignatureLabel(emojiName)!;
    expect(Array.from(result)).toHaveLength(SIGNATURE_LABEL_MAX_CHARS);
    expect(result).toBe(`B${'🩷'.repeat(SIGNATURE_LABEL_MAX_CHARS - 1)}`);
  });
});

describe('computeInkBounds', () => {
  it('returns null for an untouched canvas', () => {
    const data = blankBuffer(100, 50);
    expect(computeInkBounds(data, 100, 50)).toBeNull();
  });

  it('rejects degenerate sizes and short buffers', () => {
    const data = blankBuffer(4, 4);
    expect(computeInkBounds(data, 0, 4)).toBeNull();
    expect(computeInkBounds(data, 4, 0)).toBeNull();
    expect(computeInkBounds(new Uint8ClampedArray(4), 4, 4)).toBeNull();
  });

  it('finds a single marked pixel and clamps padding to the canvas', () => {
    const data = blankBuffer(40, 30);
    mark(data, 40, 5, 4);
    const bounds = computeInkBounds(data, 40, 30, { padding: 12 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 18, height: 17 });
  });

  it('finds the tight box around multiple marks with symmetric padding', () => {
    const data = blankBuffer(100, 80);
    mark(data, 100, 10, 8);
    mark(data, 100, 50, 60);
    const bounds = computeInkBounds(data, 100, 80, { padding: 6 });
    expect(bounds).toEqual({ x: 4, y: 2, width: 53, height: 65 });
  });

  it('honour the alpha threshold: invisible ink is nothing', () => {
    const data = blankBuffer(20, 20);
    mark(data, 20, 8, 8, 0); // fully transparent "ink"
    expect(computeInkBounds(data, 20, 20)).toBeNull();
    mark(data, 20, 10, 10, 1); // a single-alpha pixel counts
    const bounds = computeInkBounds(data, 20, 20, { alphaThreshold: 1 });
    expect(bounds).not.toBeNull();
  });
});

describe('isSignatureAssetRecord', () => {
  const png = new Blob([new Uint8Array(64).buffer], { type: 'image/png' });

  const valid = {
    id: 'abc-123',
    createdAt: Date.now(),
    method: 'drawn',
    png,
    width: 320,
    height: 120,
    strokes: {
      schema: SIGNATURE_STROKES_SCHEMA,
      groups: [{ points: [{ x: 1, y: 2, time: 3 }] }],
    },
  };

  it('accepts a well-formed record', () => {
    expect(isSignatureAssetRecord(valid)).toBe(true);
  });

  it('accepts a typed record without strokes', () => {
    expect(
      isSignatureAssetRecord({ ...valid, method: 'typed', strokes: undefined }),
    ).toBe(true);
  });

  it('accepts an uploaded record without strokes', () => {
    expect(
      isSignatureAssetRecord({ ...valid, method: 'uploaded', strokes: undefined }),
    ).toBe(true);
  });

  it('rejects wrong method, missing png, empty png and oversize png', () => {
    expect(isSignatureAssetRecord({ ...valid, method: 'scanned' })).toBe(false);
    expect(isSignatureAssetRecord({ ...valid, png: undefined })).toBe(false);
    const empty = new Blob([], { type: 'image/png' });
    expect(isSignatureAssetRecord({ ...valid, png: empty })).toBe(false);
    const oversized = new Blob([new ArrayBuffer(SIGNATURE_PNG_MAX_BYTES + 1)]);
    expect(isSignatureAssetRecord({ ...valid, png: oversized })).toBe(false);
  });

  it('rejects non-finite and out-of-range capture sizes', () => {
    expect(isSignatureAssetRecord({ ...valid, width: 0 })).toBe(false);
    expect(isSignatureAssetRecord({ ...valid, height: -5 })).toBe(false);
    expect(isSignatureAssetRecord({ ...valid, width: Number.NaN })).toBe(false);
  });

  it('rejects stroke data with a different schema version or empty groups', () => {
    expect(
      isSignatureAssetRecord({
        ...valid,
        strokes: { schema: SIGNATURE_STROKES_SCHEMA + 1, groups: valid.strokes.groups },
      }),
    ).toBe(false);
    expect(isSignatureAssetRecord({ ...valid, strokes: { schema: 1, groups: [] } })).toBe(false);
    expect(
      isSignatureAssetRecord({ ...valid, strokes: { schema: 1, groups: [{ points: [] }] } }),
    ).toBe(false);
  });

  it('rejects non-object shapes everywhere', () => {
    expect(isSignatureAssetRecord(null)).toBe(false);
    expect(isSignatureAssetRecord('signature')).toBe(false);
    expect(isSignatureAssetRecord([])).toBe(false);
  });
});

describe('inkAlphaFromLuminance', () => {
  function pixels(values: Array<[number, number, number, number]>): Uint8ClampedArray {
    return new Uint8ClampedArray(values.flat());
  }

  it('makes paper fully transparent and ink fully opaque', () => {
    const out = inkAlphaFromLuminance(
      pixels([
        [255, 255, 255, 255], // paper
        [0, 0, 0, 255], // ink
      ]),
      2,
      1,
    );
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(255);
  });

  it('ramps the antialiased middle instead of a hard 242 cut', () => {
    // 181 is halfway between the default paper (242) and ink (120).
    const out = inkAlphaFromLuminance(pixels([[181, 181, 181, 255]]), 1, 1);
    expect(out[3]).toBeGreaterThan(100);
    expect(out[3]).toBeLessThan(160);
    // 241 is just below paper: visible but faint, not suddenly opaque.
    const faint = inkAlphaFromLuminance(pixels([[241, 241, 241, 255]]), 1, 1);
    expect(faint[3]).toBeGreaterThan(0);
    expect(faint[3]).toBeLessThan(10);
  });

  it('never invents ink where the source was transparent', () => {
    const out = inkAlphaFromLuminance(pixels([[0, 0, 0, 0]]), 1, 1);
    expect(out[3]).toBe(0);
  });

  it('is pure: the source buffer is untouched', () => {
    const source = pixels([[255, 255, 255, 255]]);
    const copy = new Uint8ClampedArray(source);
    inkAlphaFromLuminance(source, 1, 1);
    expect(Array.from(source)).toEqual(Array.from(copy));
  });

  it('returns an empty buffer for degenerate sizes', () => {
    expect(inkAlphaFromLuminance(new Uint8ClampedArray(4), 0, 1)).toHaveLength(0);
    expect(inkAlphaFromLuminance(new Uint8ClampedArray(4), 1, Number.NaN)).toHaveLength(0);
  });
});

describe('scaledSignatureSize', () => {
  it('caps the width and keeps the trimmed aspect exactly', () => {
    // A 5:1 signature (600x120) must not be given the pad's 3:1 aspect.
    expect(scaledSignatureSize(600, 120, 150)).toEqual({ width: 150, height: 30 });
    // A wide signature captured on a 3:1 pad keeps its own ~6:1 aspect.
    expect(scaledSignatureSize(300, 50, 150)).toEqual({ width: 150, height: 25 });
  });

  it('does not enlarge a small signature past its capture size', () => {
    expect(scaledSignatureSize(90, 30, 150)).toEqual({ width: 90, height: 30 });
  });

  it('keeps the aspect even for a hairline', () => {
    // 4:1 at a 24 pt minimum width stays 6 pt tall rather than being stretched.
    expect(scaledSignatureSize(4, 1, 150)).toEqual({ width: 24, height: 6 });
    expect(scaledSignatureSize(2000, 40, 150)).toEqual({ width: 150, height: 3 });
  });

  it('survives degenerate dimensions with a square fallback', () => {
    expect(scaledSignatureSize(0, 0, 150)).toEqual({ width: 24, height: 24 });
    expect(scaledSignatureSize(Number.NaN, 100, 150)).toEqual({ width: 24, height: 24 });
  });
});

describe('pngPixelSize', () => {
  function pngBlob(width: number, height: number, type = 'image/png'): Blob {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return new Blob([bytes], { type });
  }

  it('reads the IHDR dimensions without decoding the image', async () => {
    await expect(pngPixelSize(pngBlob(600, 120))).resolves.toEqual({ width: 600, height: 120 });
  });

  it('rejects a non-PNG blob', async () => {
    await expect(pngPixelSize(pngBlob(10, 10, 'image/jpeg'))).resolves.toBeNull();
  });

  it('rejects short or zero-size headers', async () => {
    await expect(pngPixelSize(new Blob([new Uint8Array(8)], { type: 'image/png' }))).resolves.toBeNull();
    await expect(pngPixelSize(pngBlob(0, 120))).resolves.toBeNull();
  });
});

describe('constants', () => {
  it('pin the reviewed caps (changing one is a §25.1 decision, not a tweak)', () => {
    expect(SIGNATURE_STORE_MAX).toBe(5);
    expect(SIGNATURE_PNG_MAX_BYTES).toBe(200 * 1024);
    expect(SIGNATURE_STROKES_SCHEMA).toBe(1);
  });
});
