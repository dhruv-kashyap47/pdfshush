/**
 * Text-surgery fixtures (G-02).
 *
 * Each fixture is generated at test time so it stays portable and hash-stable
 * (no timestamps, no machine fonts). They target the cases the current
 * content-stream path cannot express: partial-word removal, kerned TJ arrays,
 * rotated glyphs, text inside a Form XObject, and an unclosed clip.
 *
 * The manifest is intentionally explicit: a fixture without a stated failure it
 * guards is not worth keeping.
 */

import {
  PDFDocument,
  PDFName,
  StandardFonts,
  type PDFRef,
} from '@cantoo/pdf-lib';

/** Fixtures must not carry wall-clock metadata; pdf-lib applies it at create. */
const CREATE_OPTIONS = { updateMetadata: false } as const;
/** Fixtures are generated in-process, so object streams add no value. */
const SAVE_OPTIONS = { useObjectStreams: false } as const;

export type TextSurgeryFixtureKind =
  | 'partial-word'
  | 'tj-kern'
  | 'rotated'
  | 'rotated-180'
  | 'rotated-270'
  | 'nested-array'
  | 'inline-image'
  | 'xobject-text'
  | 'unclosed-clip';

export interface TextSurgeryFixture {
  kind: TextSurgeryFixtureKind;
  description: string;
  guards: string;
  bytes: Uint8Array;
  expectText: string[];
}

export const TEXT_SURGERY_MANIFEST: ReadonlyArray<
  Pick<TextSurgeryFixture, 'kind' | 'description' | 'guards' | 'expectText'>
> = [
  {
    kind: 'partial-word',
    description: 'One Tj string with a word that must be edited mid-run.',
    guards: 'C-03/C-04: removed glyphs must not shift the kept glyphs after them.',
    expectText: ['INVOICE 2026-0042'],
  },
  {
    kind: 'tj-kern',
    description: 'A TJ array with explicit kerning numbers between words.',
    guards: 'C-04: removing a word must preserve the numeric adjustments around it.',
    expectText: ['INVOICE', '2026', '0042'],
  },
  {
    kind: 'rotated',
    description: 'Glyphs drawn with a 90-degree text matrix.',
    guards: 'C-10: glyph quads and replacement matrices must respect rotation.',
    expectText: ['ROTATED'],
  },
  {
    kind: 'rotated-180',
    description: 'Glyphs drawn upside down with a 180-degree text matrix.',
    guards: 'C-10: a 180-degree removal must compensate on the same baseline.',
    expectText: ['ROTATED'],
  },
  {
    kind: 'rotated-270',
    description: 'Glyphs drawn with a 270-degree text matrix.',
    guards: 'C-10: a 270-degree removal must not rotate the kept run.',
    expectText: ['ROTATED'],
  },
  {
    kind: 'nested-array',
    description: 'A TJ array whose strings and numbers include a nested array.',
    guards: 'C-01: nested arrays must parse without losing the surrounding operands.',
    expectText: ['NESTED'],
  },
  {
    kind: 'inline-image',
    description: 'An inline image before a text run on the same page.',
    guards: 'C-14: inline image data must not stop the text after it from being rewritten.',
    expectText: ['AFTER IMAGE'],
  },
  {
    kind: 'xobject-text',
    description: 'Text inside a Form XObject invoked with Do.',
    guards: 'C-14: text the stream path cannot reach must warn, not report success.',
    expectText: ['IN XOBJECT'],
  },
  {
    kind: 'unclosed-clip',
    description: 'A page content stream that opens a clip and never closes it.',
    guards: 'C-06: appended replacement text must not be clipped away.',
    expectText: ['CLIPPED'],
  },
];

async function baseDocument(): Promise<{
  doc: PDFDocument;
  font: Awaited<ReturnType<PDFDocument['embedFont']>>;
}> {
  const doc = await PDFDocument.create(CREATE_OPTIONS);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return { doc, font };
}

/** Replace the page content and resource table with a raw stream. */
function rawPage(
  doc: PDFDocument,
  fontRef: PDFRef,
  content: string,
  extraResources: Record<string, unknown> = {},
): void {
  const page = doc.addPage([400, 300]);
  const context = doc.context;
  const contents = context.flateStream(content);
  page.node.set(PDFName.of('Contents'), context.register(contents));
  const resources = context.obj({
    Font: { F1: fontRef },
    ...extraResources,
  });
  page.node.set(PDFName.of('Resources'), resources);
}

export async function buildTextSurgeryFixture(
  kind: TextSurgeryFixtureKind,
): Promise<TextSurgeryFixture> {
  const meta = TEXT_SURGERY_MANIFEST.find((entry) => entry.kind === kind);
  if (!meta) throw new Error(`Unknown fixture ${kind}`);
  const { doc, font } = await baseDocument();

  switch (kind) {
    case 'partial-word':
      rawPage(
        doc,
        font.ref,
        'BT /F1 18 Tf 1 0 0 1 40 240 Tm (INVOICE 2026-0042) Tj ET\n',
      );
      break;
    case 'tj-kern':
      rawPage(
        doc,
        font.ref,
        'BT /F1 18 Tf 1 0 0 1 40 240 Tm [(INVOICE) -250 (2026) -250 (0042)] TJ ET\n',
      );
      break;
    case 'rotated':
      rawPage(
        doc,
        font.ref,
        'BT /F1 18 Tf 0 1 -1 0 240 40 Tm (ROTATED) Tj ET\n',
      );
      break;
    case 'rotated-180':
      rawPage(
        doc,
        font.ref,
        'BT /F1 14 Tf -1 0 0 -1 340 240 Tm (ROTATED 180) Tj ET\n',
      );
      break;
    case 'rotated-270':
      rawPage(
        doc,
        font.ref,
        'BT /F1 14 Tf 0 -1 1 0 40 60 Tm (ROTATED 270) Tj ET\n',
      );
      break;
    case 'nested-array':
      rawPage(
        doc,
        font.ref,
        'BT /F1 16 Tf 1 0 0 1 40 220 Tm [(NESTED) -120 [(ARRAY)]] TJ ET\n',
      );
      break;
    case 'inline-image':
      rawPage(
        doc,
        font.ref,
        'q BI /W 1 /H 1 /CS /G /BPC 8 /F /AHx ID 00> EI Q\n' +
          'BT /F1 16 Tf 1 0 0 1 40 200 Tm (AFTER IMAGE) Tj ET\n',
      );
      break;
    case 'xobject-text': {
      const form = doc.context.flateStream(
        'BT /F1 16 Tf 40 200 Td (IN XOBJECT) Tj ET\n',
        {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 400, 300],
          Resources: { Font: { F1: font.ref } },
        },
      );
      const formRef = doc.context.register(form);
      rawPage(
        doc,
        font.ref,
        'q 1 0 0 1 0 0 cm /X1 Do Q\n',
        { XObject: { X1: formRef } },
      );
      break;
    }
    case 'unclosed-clip':
      rawPage(
        doc,
        font.ref,
        'q 0 0 400 300 re W n\nBT /F1 18 Tf 1 0 0 1 40 240 Tm (CLIPPED) Tj ET\n',
      );
      break;
  }

  return {
    ...meta,
    bytes: await doc.save(SAVE_OPTIONS),
  };
}
