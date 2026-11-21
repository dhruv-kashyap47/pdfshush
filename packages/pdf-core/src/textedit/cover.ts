/**
 * C-07: leftover-cover policy.
 *
 * Deleting glyphs from a content stream is exact about glyphs, not about
 * antialiasing: a reader can leave a faint edge where the ink used to be. The
 * editor used to solve that by always shipping full-line whiteout rectangles,
 * which made a real whiteout indistinguishable from a deletion patch. This
 * module is the explicit, narrow alternative:
 *
 *   - only runs when an edit asks for `coverPolicy: 'leftover-cover'`;
 *   - only after the removal itself completed (`in-place`/`content-stream`);
 *   - only when the paint under the removed region is actually white. The
 *     question is answered from the page's own fill operators and image/form
 *     placements, not from a guessed background, so a coloured panel or an
 *     image behind the text suppresses the patch instead of getting a visible
 *     white rectangle;
 *   - it returns the smallest boxes it needs, one per removed line/run.
 */

import {
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { loadPdfDocument } from '../ops/pages.js';
import { pageGeom, viewRectToPdf } from '../ops/geometry.js';
import { parseOperations, tokenizeContentStream } from './stream/lexer.js';
import type { TextEditBox } from './types.js';

export interface CoverDecision {
  /** True when the page background is white enough for an invisible patch. */
  white: boolean;
  /** The actual paper fill (`#rrggbb`), so an off-white page gets an off-white patch. */
  paper?: string;
  /** Detail for the receipt when the patch was skipped. */
  reason?: string;
}

type Rgb = [number, number, number];
type Matrix = [number, number, number, number, number, number];

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function apply(matrix: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function isWhite(color: Rgb): boolean {
  return color.every((part) => part >= 0.96);
}

function toHex(color: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(color[0])}${part(color[1])}${part(color[2])}`;
}

function cmykToRgb(c: number, m: number, y: number, k: number): Rgb {
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
}

function numberAt(
  operation: ReturnType<typeof parseOperations>[number],
  index: number,
): number | undefined {
  const token = operation.operands[index];
  return token?.kind === 'number' && Number.isFinite(token.value) ? token.value : undefined;
}

function nameAt(
  operation: ReturnType<typeof parseOperations>[number],
  index: number,
): string | undefined {
  const token = operation.operands[index];
  return token?.kind === 'name' ? token.text : undefined;
}

interface PathBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rectangular: boolean;
}

function emptyPath(): PathBox {
  return {
    x0: Number.POSITIVE_INFINITY,
    y0: Number.POSITIVE_INFINITY,
    x1: Number.NEGATIVE_INFINITY,
    y1: Number.NEGATIVE_INFINITY,
    rectangular: true,
  };
}

function addPoint(path: PathBox, x: number, y: number): void {
  path.x0 = Math.min(path.x0, x);
  path.y0 = Math.min(path.y0, y);
  path.x1 = Math.max(path.x1, x);
  path.y1 = Math.max(path.y1, y);
}

function intersects(
  path: PathBox,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return path.x0 < box.x + box.width && path.x1 > box.x && path.y0 < box.y + box.height && path.y1 > box.y;
}

function decodeContents(page: PDFPage): Uint8Array | null {
  const { Contents } = page.node.normalizedEntries();
  if (!Contents) return null;
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < Contents.size(); index += 1) {
    const value = Contents.lookup(index);
    const stream = value instanceof PDFStream ? value : undefined;
    if (!stream) continue;
    try {
      if (stream instanceof PDFRawStream) {
        chunks.push(decodePDFRawStream(stream).decode(), Uint8Array.of(0x0a));
      } else if (
        'getUnencodedContents' in stream &&
        typeof (stream as { getUnencodedContents?: () => Uint8Array }).getUnencodedContents ===
          'function'
      ) {
        chunks.push(
          (stream as { getUnencodedContents(): Uint8Array }).getUnencodedContents(),
          Uint8Array.of(0x0a),
        );
      } else {
        chunks.push(stream.getContents(), Uint8Array.of(0x0a));
      }
    } catch {
      return null;
    }
  }
  if (chunks.length === 0) return null;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Answers "is the paint behind these regions white?" by walking the page's own
 * content stream. A full-page tint, a coloured table cell, an image or a form
 * under the removed text all fail the test; an ordinary white page passes.
 */
export async function detectWhiteBackground(
  data: Uint8Array,
  pageIndex: number,
  boxes: readonly TextEditBox[],
  options: { password?: string } = {},
): Promise<CoverDecision> {
  if (boxes.length === 0) return { white: false, reason: 'no removed region to patch' };
  const doc = await loadPdfDocument(data, { ...(options.password ? { password: options.password } : {}) });
  try {
    const pages = doc.getPages();
    const page = pages[pageIndex];
    if (!page) return { white: false, reason: `page ${pageIndex + 1} does not exist` };
    const bytes = decodeContents(page);
    if (!bytes) return { white: false, reason: 'the page content stream could not be read' };
    let operations: ReturnType<typeof parseOperations>;
    try {
      operations = parseOperations(tokenizeContentStream(bytes));
    } catch {
      return { white: false, reason: 'the page content stream is malformed' };
    }
    const geom = pageGeom(page);
    const pdfBoxes = boxes.map((box) => viewRectToPdf(geom, box));
    const resources = page.node.normalizedEntries().Resources;

    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    let fill: Rgb = [0, 0, 0];
    let fillKnown = true;
    let colorSpace = 'DeviceGray';
    let paper: string | undefined;
    let path = emptyPath();
    const stack: Array<{ ctm: Matrix; fill: Rgb; fillKnown: boolean }> = [];

    for (const operation of operations) {
      switch (operation.name) {
        case 'q':
          stack.push({ ctm, fill, fillKnown });
          break;
        case 'Q': {
          const restored = stack.pop();
          if (restored) ({ ctm, fill, fillKnown } = restored);
          break;
        }
        case 'cm': {
          const values = [0, 1, 2, 3, 4, 5].map((index) => numberAt(operation, index));
          if (values.every((value) => value !== undefined)) {
            ctm = multiply(values as Matrix, ctm);
          }
          break;
        }
        case 'g': {
          const gray = numberAt(operation, 0);
          if (gray !== undefined) {
            fill = [gray, gray, gray];
            fillKnown = true;
          }
          break;
        }
        case 'rg': {
          const r = numberAt(operation, 0);
          const g = numberAt(operation, 1);
          const b = numberAt(operation, 2);
          if (r !== undefined && g !== undefined && b !== undefined) {
            fill = [r, g, b];
            fillKnown = true;
          }
          break;
        }
        case 'k': {
          const c = numberAt(operation, 0);
          const m = numberAt(operation, 1);
          const y = numberAt(operation, 2);
          const key = numberAt(operation, 3);
          if (c !== undefined && m !== undefined && y !== undefined && key !== undefined) {
            fill = cmykToRgb(c, m, y, key);
            fillKnown = true;
          }
          break;
        }
        case 'cs': {
          colorSpace = nameAt(operation, 0) ?? '';
          // Separation/DeviceN/ICCBased/Pattern components are not RGB values;
          // do not classify their paint as white from a numeric operand.
          if (!/^(DeviceGray|DeviceRGB|DeviceCMYK|G|RGB|CMYK)$/i.test(colorSpace)) {
            fillKnown = false;
          } else {
            fillKnown = true;
          }
          break;
        }
        case 'sc':
        case 'scn': {
          const values = [0, 1, 2, 3]
            .map((index) => numberAt(operation, index))
            .filter((value): value is number => value !== undefined);
          if (values.length === 1 && !/^(DeviceGray|G)$/i.test(colorSpace)) {
            fillKnown = false;
            break;
          }
          if (values.length === 1) {
            fill = [values[0]!, values[0]!, values[0]!];
            fillKnown = true;
          } else if (values.length === 3) {
            fill = [values[0]!, values[1]!, values[2]!];
            fillKnown = true;
          } else if (values.length === 4) {
            fill = cmykToRgb(values[0]!, values[1]!, values[2]!, values[3]!);
            fillKnown = true;
          } else {
            // A pattern/named colour space: the paint is not a simple RGB we
            // can classify, so treat it as unknown rather than guessing white.
            fillKnown = false;
          }
          break;
        }
        case 're': {
          const x = numberAt(operation, 0);
          const y = numberAt(operation, 1);
          const width = numberAt(operation, 2);
          const height = numberAt(operation, 3);
          if (x === undefined || y === undefined || width === undefined || height === undefined) {
            path.rectangular = false;
            break;
          }
          for (const [px, py] of [
            [x, y],
            [x + width, y],
            [x, y + height],
            [x + width, y + height],
          ] as const) {
            const [vx, vy] = apply(ctm, px, py);
            addPoint(path, vx, vy);
          }
          break;
        }
        case 'm':
        case 'l':
        case 'c':
        case 'v':
        case 'y': {
          path.rectangular = false;
          const x = numberAt(operation, 0);
          const y = numberAt(operation, 1);
          if (x !== undefined && y !== undefined) {
            const [vx, vy] = apply(ctm, x, y);
            addPoint(path, vx, vy);
          }
          break;
        }
        case 'h':
          break;
        case 'f':
        case 'F':
        case 'f*':
        case 'B':
        case 'B*':
        case 'b':
        case 'b*': {
          if (Number.isFinite(path.x0) && pdfBoxes.some((box) => intersects(path, box))) {
            if (!fillKnown || !isWhite(fill)) {
              return {
                white: false,
                reason: 'a filled shape behind the removed text is not white',
              };
            }
            paper ??= toHex(fill);
          }
          path = emptyPath();
          break;
        }
        case 'n':
        case 'S':
        case 's':
          path = emptyPath();
          break;
        case 'sh':
          // A shading has no simple path box; it can cover the removal with
          // any colour. Skipping the patch is safer than a visible white bar.
          return {
            white: false,
            reason: 'a shading fills the page behind the removed text',
          };
        case 'BI':
          return {
            white: false,
            reason: 'an inline image sits behind the removed text',
          };
        case 'Do': {
          // An image or form under the removal is visually unknown; skipping
          // the patch is the only honest answer without sampling pixels.
          const name = nameAt(operation, 0);
          if (name && resources instanceof PDFDict) {
            const xobjectsRaw = resources.get(PDFName.of('XObject'));
            const xobjects = xobjectsRaw ? resources.context.lookup(xobjectsRaw) : undefined;
            if (xobjects instanceof PDFDict) {
              const xobject = xobjects.lookup(PDFName.of(name));
              if (xobject instanceof PDFStream) {
                const points = [
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                ] as const;
                const pathBox = emptyPath();
                pathBox.rectangular = true;
                for (const [x, y] of points) {
                  const [vx, vy] = apply(ctm, x, y);
                  addPoint(pathBox, vx, vy);
                }
                if (pdfBoxes.some((box) => intersects(pathBox, box))) {
                  return {
                    white: false,
                    reason: 'an image or form sits behind the removed text',
                  };
                }
              }
            }
          }
          break;
        }
        default:
          break;
      }
    }
    return { white: true, ...(paper ? { paper } : {}) };
  } finally {
    // pdf-lib documents do not need explicit close.
  }
}

/** Pads a removed region by a hair so antialiased edges are under the patch. */
export function coverBox(box: TextEditBox, pad = 0.75): TextEditBox {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}
