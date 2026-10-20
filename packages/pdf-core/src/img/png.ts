/**
 * Minimal PNG encoder for the engine's Extract Images tool.
 *
 * Writes 8-bit grayscale (colour type 0) and RGB (colour type 2) PNGs from
 * decoded sample data: raw scanlines with filter type 0, zlib-deflated.
 * Dependency-free apart from `fflate` (already the engine's zip backend), so
 * no image codec enters the bundle.
 */

import { zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(type.length + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, type.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encodes 8-bit-per-component planar-interleaved samples.
 * `components` is 1 (gray) or 3 (RGB); `samples` length must be width*height*components.
 */
export function encodeFlatPng(
  width: number,
  height: number,
  components: 1 | 3,
  samples: Uint8Array,
): Uint8Array {
  const stride = width * components;
  if (samples.length !== stride * height) {
    throw new Error(`Sample buffer mismatch: expected ${stride * height}, got ${samples.length}`);
  }
  // Filter type 0 (None) per row.
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = components === 3 ? 2 : 0; // colour type: truecolour / grayscale
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Reverses one PNG-style row filter in place.
 * `row` is the sample row (length `length`), filter value 0..4, `prior` the
 * reconstructed previous row (empty for the first row). Returns the row as-is
 * (same reference, filters are applied in place).
 */
export function unfilterRow(
  filter: number,
  row: Uint8Array,
  prior: Uint8Array,
  bytesPerPixel: number,
): Uint8Array {
  const length = row.length;
  switch (filter) {
    case 0: // None
      return row;
    case 1: {
      // Sub: left neighbour within the row.
      for (let i = bytesPerPixel; i < length; i += 1) {
        row[i] = (row[i]! + row[i - bytesPerPixel]!) & 0xff;
      }
      return row;
    }
    case 2: {
      // Up: the row above.
      for (let i = 0; i < length; i += 1) {
        row[i] = (row[i]! + (prior[i] ?? 0)) & 0xff;
      }
      return row;
    }
    case 3: {
      // Average: floor((left + up) / 2).
      for (let i = 0; i < length; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
        const up = prior[i] ?? 0;
        row[i] = (row[i]! + ((left + up) >>> 1)) & 0xff;
      }
      return row;
    }
    case 4: {
      // Paeth.
      const paeth = (a: number, b: number, c: number): number => {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      };
      for (let i = 0; i < length; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0;
        const up = prior[i] ?? 0;
        const upLeft = i >= bytesPerPixel ? (prior[i - bytesPerPixel] ?? 0) : 0;
        row[i] = (row[i]! + paeth(left, up, upLeft)) & 0xff;
      }
      return row;
    }
    default:
      return row;
  }
}

/** Reverses PNG predictors 12 (PNG filters) across a whole infl decoded buffer. */
export function decodePngPredictor(
  data: Uint8Array,
  width: number,
  height: number,
  components: number,
): Uint8Array {
  const stride = width * components + 1; // filter byte leads every row
  const out = new Uint8Array(width * height * components);
  const prior = new Uint8Array(width * components);
  for (let y = 0; y < height; y += 1) {
    const base = y * stride;
    if (base + stride > data.length) {
      throw new Error('Image data shorter than its declared dimensions (truncated predictor stream)');
    }
    const filter = data[base]!;
    const row = unfilterRow(filter, data.subarray(base + 1, base + stride), prior, components);
    out.set(row.subarray(0, width * components), y * width * components);
    prior.set(out.subarray(y * width * components, (y + 1) * width * components));
  }
  return out;
}
