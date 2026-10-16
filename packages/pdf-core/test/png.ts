/**
 * A minimal, dependency-free PNG encoder for redaction tests.
 *
 * The redaction pipeline hands back *image bytes*, and the pixel checks read
 * those bytes rather than trusting the drawing code, so tests must build a real
 * PNG (correct size, genuine detail) with no canvas in reach.
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
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(type.length + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, type.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
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
 * A real RGB PNG of the requested size.
 *
 * The rasterizer must return a correctly sized, non-uniform image: verification
 * rejects placeholder images, and the pixel checks need detail to measure.
 */
export function encodePng(
  width: number,
  height: number,
  dark: { x: number; y: number; w: number; h: number }[],
  flat = false,
): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      // A gradient, so a blank page is distinguishable from a rendered one.
      let value = flat ? 128 : 40 + Math.round((x / width) * 120);
      for (const box of dark) {
        if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) value = 0;
      }
      const i = row + 1 + x * 3;
      raw[i] = value;
      raw[i + 1] = value;
      raw[i + 2] = value;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
