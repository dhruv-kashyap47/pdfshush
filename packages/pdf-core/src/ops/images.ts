/**
 * Embedded-image extraction -- powers Extract Images.
 *
 * Walks every image XObject in the document's indirect objects and hands back
 * a lossless export where one is possible:
 *  - DCTDecode streams are real JPEGs and are returned byte-for-byte;
 *  - FlateDecode 8-bit DeviceGray / DeviceRGB streams (with or without PNG
 *    predictors, filters 0-4) are re-encoded as PNG.
 * Everything else -- CMYK, indexed, ICC-based, 16-bit, JBIG2, CCITT -- is
 * counted as skipped rather than silently degraded, and the caller reports
 * the split honestly ("kept N, skipped M").
 *
 * Inline images (`BI … EI` inside content streams) are not XObjects and are
 * out of scope here; tools that need them rasterize pages instead.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from '@cantoo/pdf-lib';
import type { PDFObject } from '@cantoo/pdf-lib';
import { unzlibSync } from 'fflate';
import { LIMITS } from '../limits.js';
import { decodePngPredictor, encodeFlatPng } from '../img/png.js';

export interface ExtractedImage {
  name: string;
  ext: 'jpg' | 'png';
  data: Uint8Array;
  /** Pixel dimensions as declared by the XObject. */
  width: number;
  height: number;
  /** true when the stream carried an SMask whose alpha was left out. */
  alphaDropped: boolean;
}

export interface ExtractionResult {
  images: ExtractedImage[];
  skipped: number;
}

interface RawImageInfo {
  width: number;
  height: number;
  components: 1 | 3;
  /** DCTDecode: raw JPEG bytes. Flate: decoded samples. */
  samples: Uint8Array;
  isJpeg: boolean;
  hasSMask: boolean;
  /** Source spelling of the image's colour space, for callers that care. */
  colorSpace: string | undefined;
  /** Single filter in the stream's `/Filter` entry. */
  filter: 'FlateDecode' | 'DCTDecode';
}

export function isImageStream(obj: PDFObject): obj is PDFRawStream {
  if (!(obj instanceof PDFRawStream)) return false;
  return obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image');
}

function asName(value: PDFObject | undefined): string | undefined {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : undefined;
}

function numberValue(dict: PDFDict, name: string): number | undefined {
  const value = dict.get(PDFName.of(name));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function numberOfComponents(colorSpace: string | undefined): 1 | 3 | undefined {
  if (!colorSpace) return undefined;
  if (colorSpace === 'DeviceGray' || colorSpace === 'CalGray' || colorSpace === 'G') return 1;
  if (colorSpace === 'DeviceRGB' || colorSpace === 'CalRGB' || colorSpace === 'RGB') return 3;
  return undefined;
}

/** `DecodeParms` may be a dict or an array with one entry per component. */
function predictorOf(dict: PDFDict): number | undefined {
  const value = dict.get(PDFName.of('DecodeParms')) ?? dict.get(PDFName.of('DP'));
  if (!value) return undefined;
  if (value instanceof PDFDict) return numberValue(value, 'Predictor');
  if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i += 1) {
      const entry = value.get(i);
      if (entry instanceof PDFDict) {
        const predictor = numberValue(entry, 'Predictor');
        if (predictor !== undefined) return predictor;
      }
    }
  }
  return undefined;
}

const SUPPORTED_FILTERS = new Set(['FlateDecode', 'DCTDecode']);

/**
 * Inflates a Flate image stream into a buffer that cannot grow.
 *
 * `unzlibSync` without an `out` buffer estimates the output size and doubles
 * its buffer as it goes, with no ceiling: a 2 MB stream that expands to 1 GB is
 * fully materialised *before* the caller gets to compare it against the image
 * limits. That is a decompression bomb, and the size check that is supposed to
 * stop it (`LIMITS.tool.maxImageBytes`) only ran afterwards.
 *
 * Passing `out` makes fflate write into a fixed buffer instead of growing one.
 * A stream longer than the buffer is truncated rather than rejected, so the
 * buffer is sized one byte past the raster the dictionary declares: a stream
 * that matches the declared raster still fits with room to spare, and a stream
 * that does not fills the buffer completely and is caught by the length check
 * in `classifyImageStream`.
 *
 * `expectedBytes` is the sample count the declared raster implies. It is
 * attacker-controlled, so the allocation is additionally capped at the image
 * ceiling: a dictionary claiming a gigabyte gets the ceiling, not the claim.
 */
function inflateBounded(raw: Uint8Array, expectedBytes: number): Uint8Array | null {
  const expected = Number.isFinite(expectedBytes) ? Math.max(0, Math.ceil(expectedBytes)) : 0;
  const cap = Math.min(LIMITS.tool.maxImageBytes, expected) + 1;
  const out = new Uint8Array(cap);
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(raw, { out });
  } catch {
    return null;
  }
  // The buffer filled completely: the stream was longer than the declared
  // raster. Nothing above the ceiling is ever accepted.
  if (inflated.length > LIMITS.tool.maxImageBytes) return null;
  // Copy out of the (possibly much larger) backing buffer, so a small image
  // does not keep a 12 MB allocation alive for as long as its samples are.
  return inflated.slice();
}

/**
 * Classifies one image stream. Returns the workable case or `null` (skip).
 * Honestly skips: any other filter, CMYK/indexed/ICC/16-bit components,
 * unsupported predictors, and streams whose sample count disagrees with
 * their declared dimensions.
 */
export function classifyImageStream(dict: PDFDict, raw: Uint8Array): RawImageInfo | null {
  const width = numberValue(dict, 'Width');
  const height = numberValue(dict, 'Height');
  const bits = numberValue(dict, 'BitsPerComponent') ?? 8;
  const colorName = asName(dict.get(PDFName.of('ColorSpace')));
  const components = numberOfComponents(colorName);

  const filter = dict.get(PDFName.of('Filter')) ?? dict.get(PDFName.of('F'));
  let filterName: string | undefined;
  if (filter instanceof PDFArray) {
    // [FlateDecode] chains are routine; anything else is out of scope.
    if (filter.size() !== 1) return null;
    filterName = asName(filter.get(0));
  } else {
    filterName = asName(filter);
  }
  if (!filterName || !SUPPORTED_FILTERS.has(filterName)) return null;
  const supportedFilter = filterName as 'FlateDecode' | 'DCTDecode';

  if (width === undefined || height === undefined || width < 1 || height < 1) return null;
  if (bits !== 8) return null;

  const hasSMask = dict.get(PDFName.of('SMask')) !== undefined;

  if (supportedFilter === 'DCTDecode') {
    // A JPEG needs no colour-space voyage; pass the bytes through untouched.
    return {
      width,
      height,
      components: components ?? 3,
      samples: raw,
      isJpeg: true,
      hasSMask,
      colorSpace: colorName,
      filter: supportedFilter,
    };
  }

  // FlateDecode: decode, honour predictors 1/none and 12/15 (PNG filters),
  // then require the sample count to agree with the declared raster.
  if (components === undefined) return null;
  const predictor = predictorOf(dict);
  if (predictor !== undefined && predictor !== 1 && predictor !== 12 && predictor !== 15) {
    return null;
  }
  // The sample count the declared raster implies. A PNG-predictor stream
  // carries one filter byte per row on top of the samples; a plain one does
  // not. The predictor is read before the inflate because it decides how much
  // room the buffer needs.
  const stride = width * components;
  const expectedSamples =
    predictor === 12 || predictor === 15 ? height * (stride + 1) : stride * height;
  const samples = inflateBounded(raw, expectedSamples);
  if (!samples) return null;
  let decoded = samples;
  if (predictor === 12 || predictor === 15) {
    try {
      decoded = decodePngPredictor(samples, width, height, components);
    } catch {
      return null;
    }
  } else if (samples.length !== stride * height) {
    return null;
  }
  return {
    width,
    height,
    components,
    samples: decoded,
    isJpeg: false,
    hasSMask,
    colorSpace: colorName,
    filter: supportedFilter,
  };
}

/**
 * Extracts every lossless-exportable image. `stem` names output files
 * (`<stem>-img-001.jpg`). Order follows indirect-object discovery order.
 */
export function extractImages(doc: PDFDocument, stem: string): ExtractionResult {
  const images: ExtractedImage[] = [];
  let skipped = 0;

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!isImageStream(obj)) continue;
    const info = classifyImageStream(obj.dict, obj.contents);
    if (!info || info.samples.length > LIMITS.tool.maxImageBytes) {
      skipped += 1;
      continue;
    }
    if (info.isJpeg) {
      images.push({
        name: `${stem}-img-${String(images.length + 1).padStart(3, '0')}.jpg`,
        ext: 'jpg',
        data: info.samples,
        width: info.width,
        height: info.height,
        alphaDropped: info.hasSMask,
      });
      continue;
    }
    images.push({
      name: `${stem}-img-${String(images.length + 1).padStart(3, '0')}.png`,
      ext: 'png',
      data: encodeFlatPng(info.width, info.height, info.components, info.samples),
      width: info.width,
      height: info.height,
      alphaDropped: info.hasSMask,
    });
  }

  return { images, skipped };
}
