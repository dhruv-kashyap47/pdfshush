/**
 * Document font programmes for the overlay/native text draw path.
 *
 * A PDF may embed a font the standard-14 set cannot reproduce. pdf-lib can
 * embed it only when it has the programme bytes and fontkit is registered, so
 * this module extracts the embedded programme from the source document (via
 * the page font resources) and caches a fontkit-backed PDFFont. The caller
 * supplies the font key (BaseFont or FamilyName) on the text object; the draw
 * path falls back to a standard face when the programme is absent, cannot be
 * parsed, or cannot encode the requested text.
 *
 * This is deliberately conservative: no programme is invented, no subset is
 * silently widened, and every failure returns null so the caller can warn.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import fontkit from '@cantoo/fontkit';

export type FontProgramFormat = 'truetype' | 'cff' | 'type1' | 'opentype';

export interface DocumentFontProgram {
  /** Normalised lookup key (subset prefix stripped, lowercase alphanumeric). */
  key: string;
  /** Raw BaseFont name, for receipts and diagnostics. */
  baseName: string;
  bytes: Uint8Array;
  format: FontProgramFormat;
}

export function normalizeFontKey(value: string): string {
  return value
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function nameValue(value: unknown): string | null {
  if (value instanceof PDFName) return value.toString().replace(/^\//, '');
  if (value && typeof (value as { decodeText?: unknown }).decodeText === 'function') {
    try {
      return (value as { decodeText: () => string }).decodeText();
    } catch {
      return null;
    }
  }
  return null;
}

function streamBytes(stream: unknown): Uint8Array | null {
  try {
    if (stream instanceof PDFRawStream) {
      return Uint8Array.from(decodePDFRawStream(stream).decode());
    }
    if (stream instanceof PDFStream) {
      return Uint8Array.from(stream.getContents());
    }
  } catch {
    return null;
  }
  return null;
}

function resourcesDict(context: PDFContext, page: PDFPage): PDFDict | null {
  try {
    const node = page.node as unknown as {
      Resources?: () => unknown;
      normalizedEntries?: () => { Resources?: unknown };
    };
    // Inherited resources are legal; check the normalised entries first.
    const value = node.normalizedEntries?.().Resources ?? node.Resources?.();
    const dict = value ? context.lookup(value as never) : null;
    return dict instanceof PDFDict ? dict : null;
  } catch {
    return null;
  }
}

/**
 * Collect every embedded font programme reachable from page resources.
 *
 * Aliases include BaseFont, FamilyName and the descriptor's FontName so an
 * editor that only knows one of them can still resolve the face.
 */
export function collectFontPrograms(
  doc: PDFDocument,
  pages: readonly PDFPage[] = doc.getPages(),
): Map<string, DocumentFontProgram> {
  const context = doc.context;
  const programs = new Map<string, DocumentFontProgram>();
  const add = (alias: string | null, program: DocumentFontProgram): void => {
    if (!alias) return;
    const key = normalizeFontKey(alias);
    if (key.length === 0 || programs.has(key)) return;
    programs.set(key, program);
  };

  for (const page of pages) {
    const resources = resourcesDict(context, page);
    if (!resources) continue;
    let fonts: unknown;
    try {
      fonts = context.lookup(resources.get(PDFName.of('Font')) as never);
    } catch {
      continue;
    }
    if (!(fonts instanceof PDFDict)) continue;

    for (const [, ref] of fonts.entries()) {
      let font: unknown;
      try {
        font = context.lookup(ref as never);
      } catch {
        continue;
      }
      if (!(font instanceof PDFDict)) continue;

      const subtype = nameValue(font.get(PDFName.of('Subtype'))) ?? '';
      let target: PDFDict = font;
      if (/type0/i.test(subtype)) {
        const descendants = context.lookup(font.get(PDFName.of('DescendantFonts')) as never);
        if (descendants instanceof PDFArray) {
          const first = descendants.asArray()[0];
          if (first) {
            const child = context.lookup(first as never);
            if (child instanceof PDFDict) target = child;
          }
        }
      }

      const baseName = nameValue(target.get(PDFName.of('BaseFont'))) ??
        nameValue(font.get(PDFName.of('BaseFont'))) ??
        '';
      const descriptor = context.lookup(target.get(PDFName.of('FontDescriptor')) as never);
      if (!(descriptor instanceof PDFDict)) continue;

      const familyName = nameValue(descriptor.get(PDFName.of('FontFamily'))) ??
        nameValue(descriptor.get(PDFName.of('FontName')));
      const aliases = [baseName, familyName].filter((value): value is string => Boolean(value));

      const candidates: Array<[PDFName, FontProgramFormat]> = [
        [PDFName.of('FontFile2'), 'truetype'],
        [PDFName.of('FontFile3'), 'cff'],
        [PDFName.of('FontFile'), 'type1'],
      ];
      for (const [name, defaultFormat] of candidates) {
        const stream = context.lookup(descriptor.get(name) as never);
        const bytes = streamBytes(stream);
        if (!bytes || bytes.byteLength < 16) continue;
        const subtypeName = stream instanceof PDFStream
          ? nameValue(stream.dict.get(PDFName.of('Subtype')))
          : null;
        const format: FontProgramFormat =
          subtypeName && /opentype/i.test(subtypeName)
            ? 'opentype'
            : subtypeName && /cidfonttype0c|type1c/i.test(subtypeName)
              ? 'cff'
              : defaultFormat;
        const program: DocumentFontProgram = {
          key: normalizeFontKey(baseName || aliases[0] || 'font'),
          baseName: baseName || aliases[0] || 'font',
          bytes,
          format,
        };
        for (const alias of aliases) add(alias, program);
        // Always make the canonical key resolve, even if aliases were empty.
        if (!programs.has(program.key)) programs.set(program.key, program);
        break;
      }
    }
  }

  return programs;
}

export interface DocumentFontResolverOptions {
  /** Called when a programme exists but cannot be embedded; the caller warns. */
  onFailure?: (key: string, detail: string) => void;
}

/**
 * Embeds document programmes on demand. Subset first, full font second.
 * Returns null rather than throwing: the draw path can use a standard face.
 */
export class DocumentFontResolver {
  private readonly cache = new Map<string, PDFFont | null>();
  private readonly programs: Map<string, DocumentFontProgram>;
  private readonly onFailure?: (key: string, detail: string) => void;

  constructor(
    private readonly doc: PDFDocument,
    programs?: Map<string, DocumentFontProgram>,
    options: DocumentFontResolverOptions = {},
  ) {
    this.programs = programs ?? collectFontPrograms(doc);
    this.onFailure = options.onFailure;
  }

  has(key: string): boolean {
    return this.programs.has(normalizeFontKey(key));
  }

  async embed(key: string): Promise<PDFFont | null> {
    const normalized = normalizeFontKey(key);
    if (normalized.length === 0) return null;
    if (this.cache.has(normalized)) return this.cache.get(normalized) ?? null;
    const program = this.programs.get(normalized);
    if (!program) {
      this.cache.set(normalized, null);
      return null;
    }

    this.doc.registerFontkit(fontkit);
    const attempts: Array<{ label: string; subset: boolean }> = [
      { label: 'subset', subset: true },
      { label: 'full', subset: false },
    ];
    for (const attempt of attempts) {
      try {
        const font = await this.doc.embedFont(program.bytes, {
          subset: attempt.subset,
          customName: program.baseName,
        });
        this.cache.set(normalized, font);
        return font;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.onFailure?.(program.baseName, `${attempt.label} embed failed: ${detail}`);
      }
    }
    this.cache.set(normalized, null);
    return null;
  }
}
