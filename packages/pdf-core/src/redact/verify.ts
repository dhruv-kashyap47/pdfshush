/**
 * Independent verification of a serialized redaction.
 *
 * It reopens the exported bytes and asks the same question three different ways,
 * because a rebuilt document has several ways to be wrong:
 *
 *   - **pdf.js** extracts the text layer. Different implementation from the one
 *     that produced the file, so a bug in our pipeline cannot hide a retained
 *     text or OCR layer from the check meant to catch it.
 *   - **a raw content-stream scan** looks for text-showing operators at the byte
 *     level, with no parser in common with pdf.js. Two engines have to be wrong
 *     the same way before a text layer escapes both.
 *   - **pdf-lib** re-reads the object graph for structure that should not exist
 *     at all: annotations, attachments, metadata, and pages that are not a single
 *     image.
 *
 * Visual appearance is never the evidence. A black box proves nothing about what
 * is underneath it, so nothing here decides anything from pixels — the pixel
 * checks live in the browser suite, where the marks can actually be sampled.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFStream,
} from '@cantoo/pdf-lib';
import { inflateSync, unzlibSync } from 'fflate';
import { extractTextRuns } from '../render/textRuns.js';
import type { RedactRegion, VerificationCheck, VerificationResult } from './types.js';

export interface VerifyOptions {
  regions: RedactRegion[];
  expectedPageCount: number;
  /** Strings that must not appear anywhere. Optional; the strongest statement. */
  forbiddenStrings?: string[];
}

/** Minimum long edge for a rebuilt page image. Catches placeholders and 1×1s. */
const MIN_IMAGE_EDGE = 200;
/** Aspect drift allowed between a page image and its page box. */
const ASPECT_TOLERANCE = 0.03;

function filterName(dict: PDFDict): string | undefined {
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFName) return filter.asString().replace(/^\//, '');
  if (filter instanceof PDFArray && filter.size() === 1) {
    return filter.lookupMaybe(0, PDFName)?.asString().replace(/^\//, '') ?? 'multiple';
  }
  return filter ? 'multiple' : undefined;
}

/** Decodes a stream to a binary string. Only unfiltered and FlateDecode. */
function streamText(stream: PDFRawStream): string | undefined {
  const filter = filterName(stream.dict);
  let bytes: Uint8Array;
  if (filter === undefined) bytes = stream.contents;
  else if (filter === 'FlateDecode') {
    try {
      bytes = unzlibSync(stream.contents);
    } catch {
      try {
        bytes = inflateSync(stream.contents);
      } catch {
        return undefined;
      }
    }
  } else return undefined;

  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function pageContentStreams(doc: PDFDocument, pageIndex: number): PDFRawStream[] {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return [];
  const list: PDFRawStream[] = [];
  const push = (entry: unknown) => {
    if (entry instanceof PDFRawStream) {
      list.push(entry);
      return;
    }
    const resolved = doc.context.lookupMaybe(entry as never, PDFStream);
    if (resolved instanceof PDFRawStream) list.push(resolved);
  };
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i += 1) push(contents.get(i));
  } else {
    push(contents);
  }
  return list;
}

function readNumber(dict: PDFDict, key: string): number | undefined {
  return dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();
}

/* ------------------------------------------------------- pixel verification */

/** Channels implied by /ColorSpace, or undefined when it is not a raw form. */
function colourChannels(dict: PDFDict): number | undefined {
  const space = dict.get(PDFName.of('ColorSpace'));
  const name = space instanceof PDFName ? space.asString() : undefined;
  if (name === '/DeviceRGB') return 3;
  if (name === '/DeviceGray') return 1;
  return undefined;
}

/** Undoes PNG row filters (Predictor 10–15). `bpp` is bytes per pixel. */
function unfilterPng(raw: Uint8Array, columns: number, rows: number, bpp: number): Uint8Array | undefined {
  const stride = columns * bpp;
  const expected = (stride + 1) * rows;
  if (raw.length < expected) return undefined;
  const out = new Uint8Array(stride * rows);

  for (let y = 0; y < rows; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[src + i]!;
      const left = i >= bpp ? out[dst + i - bpp]! : 0;
      const up = y > 0 ? out[dst - stride + i]! : 0;
      const upLeft = y > 0 && i >= bpp ? out[dst - stride + i - bpp]! : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          result = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return undefined;
      }
      out[dst + i] = result & 0xff;
    }
  }
  return out;
}

interface DecodedImage {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}

/** Decodes a page image into raw samples, or undefined if the form is unknown. */
function decodeImage(stream: PDFRawStream): DecodedImage | undefined {
  const width = readNumber(stream.dict, 'Width');
  const height = readNumber(stream.dict, 'Height');
  const bits = readNumber(stream.dict, 'BitsPerComponent') ?? 8;
  const channels = colourChannels(stream.dict);
  if (!width || !height || bits !== 8 || !channels) return undefined;

  const filter = filterName(stream.dict);
  let raw: Uint8Array;
  if (filter === undefined) raw = stream.contents;
  else if (filter === 'FlateDecode') {
    try {
      raw = unzlibSync(stream.contents);
    } catch {
      try {
        raw = inflateSync(stream.contents);
      } catch {
        return undefined;
      }
    }
  } else return undefined;

  const params = stream.dict.lookupMaybe(PDFName.of('DecodeParms'), PDFDict);
  const predictor = params ? (readNumber(params, 'Predictor') ?? 1) : 1;
  if (predictor >= 10) {
    const unfiltered = unfilterPng(raw, width, height, channels);
    if (!unfiltered) return undefined;
    raw = unfiltered;
  }
  if (raw.length < width * height * channels) return undefined;
  return { width, height, channels, pixels: raw };
}

function luminanceAt(image: DecodedImage, x: number, y: number): number {
  const i = (y * image.width + x) * image.channels;
  if (image.channels === 1) return image.pixels[i]!;
  return (image.pixels[i]! + image.pixels[i + 1]! + image.pixels[i + 2]!) / 3;
}

/** How dark a marked area must be, as a fraction of full scale. */
const MARK_MAX_LUMA = 60;
/** Variance a page must retain outside its marks, or it was rebuilt blank. */
const MIN_CONTENT_SPREAD = 12;

export async function verifyRedaction(
  bytes: Uint8Array,
  options: VerifyOptions,
): Promise<VerificationResult> {
  const checks: VerificationCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  /* ------------------------------------------------------------ structure */

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  } catch (error) {
    add(
      'parses',
      false,
      `the exported bytes did not load: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, checks };
  }
  add('parses', true, 'exported bytes reload as a PDF');

  const pageCount = doc.getPageCount();
  add(
    'page-count',
    pageCount === options.expectedPageCount,
    `expected ${options.expectedPageCount}, found ${pageCount}`,
  );

  /* ------------------------------------------------ no retained page content */

  let strayAnnotations = 0;
  let pagesNotImages = 0;
  let smallImages = 0;
  let textOperators = 0;
  const imageProblems: string[] = [];
  const imageStreams: (PDFRawStream | undefined)[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const page = doc.getPage(index);
    const annots = page.node.Annots();
    if (annots) strayAnnotations += annots.size();

    const xobjects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    // XObject entries are streams, not dicts: `lookupMaybe(key, PDFDict)` asserts
    // the type and throws when it finds a stream, which every image is.
    const imageKeys = (xobjects?.keys() ?? []).filter((key) => {
      const stream = xobjects?.lookupMaybe(key, PDFStream);
      const subtype = stream?.dict.get(PDFName.of('Subtype'));
      return subtype instanceof PDFName && subtype.asString() === '/Image';
    });
    const nonImageKeys = (xobjects?.keys() ?? []).filter((key) => !imageKeys.includes(key));

    if (imageKeys.length !== 1 || nonImageKeys.length > 0) {
      pagesNotImages += 1;
      imageProblems.push(`p${index + 1}: ${imageKeys.length} image, ${nonImageKeys.length} other`);
    } else {
      const image = xobjects?.lookupMaybe(imageKeys[0]!, PDFStream);
      imageStreams[index] = image instanceof PDFRawStream ? image : undefined;
      const width = image ? readNumber(image.dict, 'Width') : undefined;
      const height = image ? readNumber(image.dict, 'Height') : undefined;
      if (width === undefined || height === undefined) {
        smallImages += 1;
        imageProblems.push(`p${index + 1}: image has no dimensions`);
      } else {
        if (Math.max(width, height) < MIN_IMAGE_EDGE) {
          smallImages += 1;
          imageProblems.push(`p${index + 1}: image is ${width}x${height}`);
        }
        // The image must cover the page box, or part of the page is unpainted.
        const box = page.getCropBox();
        const pageAspect = box.width / box.height;
        const imageAspect = width / height;
        if (Math.abs(imageAspect - pageAspect) / pageAspect > ASPECT_TOLERANCE) {
          smallImages += 1;
          imageProblems.push(
            `p${index + 1}: aspect ${imageAspect.toFixed(3)} vs page ${pageAspect.toFixed(3)}`,
          );
        }
      }
    }

    // Byte-level scan: a rebuilt page must not contain text-showing operators.
    for (const stream of pageContentStreams(doc, index)) {
      const text = streamText(stream);
      if (!text) continue;
      const matches = text.match(/(?:^|[\s>)\]}])T[jJ*'"](?=[\s([/<]|$)/g);
      if (matches) textOperators += matches.length;
    }
  }

  add(
    'no-annotations',
    strayAnnotations === 0,
    strayAnnotations === 0 ? 'no annotations on any page' : `${strayAnnotations} annotation(s) remain`,
  );
  add(
    'pages-are-single-images',
    pagesNotImages === 0,
    pagesNotImages === 0
      ? 'every page is exactly one image'
      : `${pagesNotImages} page(s) are not a single image — ${imageProblems.slice(0, 3).join('; ')}`,
  );
  add(
    'page-images-substantial',
    smallImages === 0,
    smallImages === 0 ? 'every page image is full-size' : `${smallImages} page image(s) wrong — ${imageProblems.slice(0, 3).join('; ')}`,
  );
  add(
    'content-has-no-text-operators',
    textOperators === 0,
    textOperators === 0
      ? 'no text-showing operators in any content stream'
      : `${textOperators} text-showing operator(s) remain`,
  );

  /* ------------------------------------------------- pixel evidence, decoded */

  // The marks have to be *in the pixels*. This decodes the page image that was
  // written into the file — not the one we think we drew — and samples it, so a
  // pipeline that stopped burning marks would fail here rather than ship.
  let marksOk = true;
  let contentOk = true;
  const markProblems: string[] = [];
  const contentProblems: string[] = [];

  for (let index = 0; index < pageCount; index += 1) {
    const pageRegions = options.regions.filter((region) => region.pageIndex === index);
    const stream = imageStreams[index];
    if (!stream) continue;
    const decoded = decodeImage(stream);
    if (!decoded) {
      if (pageRegions.length > 0) {
        marksOk = false;
        markProblems.push(`p${index + 1}: image could not be decoded`);
      }
      continue;
    }

    const box = doc.getPage(index).getCropBox();
    const scaleX = decoded.width / box.width;
    const scaleY = decoded.height / box.height;

    for (const region of pageRegions) {
      // Sample the interior, inset past the edges, so mark antialiasing cannot
      // decide the result either way.
      const x0 = Math.max(0, Math.ceil(region.x * scaleX) + 2);
      const y0 = Math.max(0, Math.ceil(region.y * scaleY) + 2);
      const x1 = Math.min(decoded.width - 1, Math.floor((region.x + region.width) * scaleX) - 3);
      const y1 = Math.min(decoded.height - 1, Math.floor((region.y + region.height) * scaleY) - 3);
      if (x1 <= x0 || y1 <= y0) continue;

      let brightest = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const luma = luminanceAt(decoded, x, y);
          if (luma > brightest) brightest = luma;
        }
      }
      if (brightest > MARK_MAX_LUMA) {
        marksOk = false;
        markProblems.push(`p${index + 1}: a marked area reaches luma ${Math.round(brightest)}`);
      }
    }

    // Outside the marks the page must still have contrast; a rebuild that
    // produced a blank page would otherwise pass every other check. A *fine*
    // stride matters: text is sparse, so a coarse grid samples mostly white and
    // would report a legitimate page as blank.
    let darkest = 255;
    let lightest = 0;
    const stride = 4;
    for (let y = 0; y < decoded.height; y += stride) {
      for (let x = 0; x < decoded.width; x += stride) {
        const inside = pageRegions.some(
          (region) =>
            x >= region.x * scaleX &&
            x <= (region.x + region.width) * scaleX &&
            y >= region.y * scaleY &&
            y <= (region.y + region.height) * scaleY,
        );
        if (inside) continue;
        const luma = luminanceAt(decoded, x, y);
        if (luma < darkest) darkest = luma;
        if (luma > lightest) lightest = luma;
      }
    }
    if (lightest - darkest < MIN_CONTENT_SPREAD) {
      contentOk = false;
      contentProblems.push(`p${index + 1}: contrast spread only ${lightest - darkest}`);
    }
  }

  add(
    'marks-burned-in',
    marksOk,
    marksOk
      ? `${options.regions.length} marked area(s) are opaque in the output pixels`
      : `a mark is not opaque — ${markProblems.slice(0, 3).join('; ')}`,
  );
  add(
    'page-not-blank',
    contentOk,
    contentOk
      ? 'pages retain visible content outside the marks'
      : `a page lost its content — ${contentProblems.slice(0, 3).join('; ')}`,
  );

  /* ------------------------------------------------------ retained carriers */

  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.get(PDFName.of('EmbeddedFiles'));
  const af = doc.catalog.get(PDFName.of('AF'));
  add(
    'no-attachments',
    !embedded && !af,
    embedded || af ? 'an attachment tree is present' : 'no embedded files',
  );

  const present = [
    doc.catalog.get(PDFName.of('Metadata')) ? 'XMP' : '',
    doc.getTitle() ? 'Title' : '',
    doc.getAuthor() ? 'Author' : '',
    doc.getSubject() ? 'Subject' : '',
    doc.getKeywords() ? 'Keywords' : '',
    doc.getProducer() ? 'Producer' : '',
    doc.getCreator() ? 'Creator' : '',
  ].filter(Boolean);
  add(
    'metadata-stripped',
    present.length === 0,
    present.length === 0 ? 'no document metadata' : `still present: ${present.join(', ')}`,
  );

  /* -------------------------------------------------- text layer, two ways */

  let runs: Awaited<ReturnType<typeof extractTextRuns>>;
  try {
    runs = await extractTextRuns(bytes, []);
  } catch (error) {
    add(
      'text-extractable',
      false,
      `pdf.js could not read the document: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, checks };
  }

  const surviving = runs.flat().filter((run) => run.text.trim().length > 0);
  add(
    'no-extractable-text',
    surviving.length === 0,
    surviving.length === 0
      ? 'no text is extractable from any page'
      : `${surviving.length} text run(s) survive — e.g. ${JSON.stringify(surviving[0]!.text.slice(0, 40))}`,
  );

  if (options.forbiddenStrings && options.forbiddenStrings.length > 0) {
    const haystack = runs.flat().map((run) => run.text).join('\u0000');
    const found = options.forbiddenStrings.filter((needle) => needle.length > 0 && haystack.includes(needle));
    add(
      'forbidden-strings-absent',
      found.length === 0,
      found.length === 0
        ? `${options.forbiddenStrings.length} forbidden string(s) absent`
        : `still extractable: ${found.map((value) => JSON.stringify(value.slice(0, 40))).join(', ')}`,
    );
  }

  return { ok: checks.every((check) => check.ok), checks };
}
