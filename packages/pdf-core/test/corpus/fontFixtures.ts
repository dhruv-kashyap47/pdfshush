/**
 * Font-shape fixtures (G-02/F-01).
 *
 * G-02 was missing the three font shapes the stream path is most likely to
 * mis-read: Type3, a Type0 Identity font, and a Type0 font with a non-Identity
 * CMap. F-01 also needs a real CFF/OTF programme, not only a TrueType one.
 *
 * Everything is generated at test time except the vendored Source Code Pro OTF
 * (SIL OFL, see `licenses/source-code-pro-OFL.md`), so the bytes are portable
 * and no machine font is used. Each entry states the failure it guards.
 */

import {
  PDFDocument,
  PDFName,
  type PDFRef,
} from '@cantoo/pdf-lib';

/** Fixtures must not carry wall-clock metadata; pdf-lib applies it at create. */
const CREATE_OPTIONS = { updateMetadata: false } as const;
/** Fixtures are generated in-process, so object streams add no value. */
const SAVE_OPTIONS = { useObjectStreams: false } as const;

function readFileSync(url: URL): Uint8Array {
  const proc = (globalThis as unknown as {
    process: { getBuiltinModule(name: string): unknown };
  }).process;
  const fs = proc.getBuiltinModule('node:fs') as { readFileSync(path: URL): Uint8Array };
  return fs.readFileSync(url);
}

export type FontFixtureKind = 'type3' | 'type0-identity' | 'type0-nonidentity' | 'cff-otf';

export interface FontFixture {
  kind: FontFixtureKind;
  description: string;
  guards: string;
  bytes: Uint8Array;
  /** Text a reader must recover, when the shape is readable by pdf.js. */
  expectText?: string[];
  /** True when the stream path must refuse, not repair from a guess. */
  expectStreamRefusal?: boolean;
}

export const FONT_FIXTURE_MANIFEST: ReadonlyArray<
  Pick<FontFixture, 'kind' | 'description' | 'guards' | 'expectText' | 'expectStreamRefusal'>
> = [
  {
    kind: 'type3',
    description: 'A Type3 font with CharProcs, /Widths, /FontMatrix and /ToUnicode.',
    guards: 'C-02/C-14: Type3 widths come from FontMatrix, and the stream path must report the shape it cannot rewrite.',
    expectText: ['abc'],
    expectStreamRefusal: true,
  },
  {
    kind: 'type0-identity',
    description: 'A Type0 font with Identity-H and a descendant /W table.',
    guards: 'C-02: two-byte Identity codes and descendant widths drive compensation.',
    expectText: ['AB'],
  },
  {
    kind: 'type0-nonidentity',
    description: 'A Type0 font with a non-Identity CMap.',
    guards: 'C-02: an untrusted CMap must be reliable:false, never guessed.',
    expectStreamRefusal: true,
  },
  {
    kind: 'cff-otf',
    description: 'A source PDF embedding a CFF/OpenType font programme.',
    guards: 'F-01: a CFF/OTF document font must be extracted and re-embedded (or warned), not silently substituted.',
    expectText: ['CFF'],
  },
];

function ttfBytes(): Uint8Array {
  return readFileSync(
    new URL('../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url),
  );
}

const OTF_URL = new URL('../fixtures/fonts/SourceCodePro-Regular.otf', import.meta.url);

/** Hash of the vendored SIL OFL CFF/OpenType face; a changed font must be intentional. */
export const VENDORED_FONT_SHA256 =
  '9f9664e2edf6f045c11e774f9bd0be6993971f2544a39061a5ce478b96b051f8';

function toUnicodeMap(entries: ReadonlyArray<[number, string]>): string {
  const lines = entries.map(
    ([code, text]) =>
      `<${code.toString(16).padStart(4, '0')}> <${Array.from(text)
        .map((character) => character.codePointAt(0)!.toString(16).padStart(4, '0'))
        .join('')}>`,
  );
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${lines.length} beginbfchar`,
    ...lines,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

function addPage(
  doc: PDFDocument,
  fontRef: PDFRef,
  content: string,
): void {
  const page = doc.addPage([400, 300]);
  const context = doc.context;
  const contents = context.flateStream(content);
  page.node.set(PDFName.of('Contents'), context.register(contents));
  page.node.set(
    PDFName.of('Resources'),
    context.obj({ Font: { F1: fontRef } }),
  );
}

async function type3Bytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create(CREATE_OPTIONS);
  const context = doc.context;
  const charProc = () =>
    context.register(
      context.flateStream('500 0 0 0 500 700 d1 0 0 500 700 re f\n', {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [0, 0, 500, 700],
        Resources: {},
      }),
    );
  const charProcs = context.obj({
    a: charProc(),
    b: charProc(),
    c: charProc(),
  });
  const toUnicode = context.register(
    context.flateStream(
      toUnicodeMap([
        [0, 'a'],
        [1, 'b'],
        [2, 'c'],
      ]),
    ),
  );
  const font = context.obj({
    Type: 'Font',
    Subtype: 'Type3',
    Name: 'F1',
    FontBBox: [0, 0, 500, 700],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: charProcs,
    Encoding: context.obj({
      Type: 'Encoding',
      Differences: [0, PDFName.of('a'), PDFName.of('b'), PDFName.of('c')],
    }),
    FirstChar: 0,
    LastChar: 2,
    Widths: [500, 500, 500],
    Resources: context.obj({}),
    ToUnicode: toUnicode,
  });
  const fontRef = context.register(font);
  addPage(doc, fontRef, 'BT /F1 24 Tf 1 0 0 1 40 200 Tm (\\000\\001\\002) Tj ET\n');
  return doc.save(SAVE_OPTIONS) as unknown as Uint8Array;
}

async function type0Bytes(nonIdentity: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create(CREATE_OPTIONS);
  const context = doc.context;
  const ttf = ttfBytes();
  const program = context.register(
    context.flateStream(ttf, { Length1: ttf.byteLength, Subtype: 'TrueType' }),
  );
  const descriptor = context.obj({
    Type: 'FontDescriptor',
    FontName: 'FixtureSans',
    Flags: 4,
    FontBBox: [0, -200, 1000, 900],
    ItalicAngle: 0,
    Ascent: 800,
    Descent: -200,
    CapHeight: 700,
    StemV: 80,
    FontFile2: program,
  });
  const descriptorRef = context.register(descriptor);
  const descendant = context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'FixtureSans',
    CIDSystemInfo: {
      Registry: 'Adobe',
      Ordering: 'Identity',
      Supplement: 0,
    },
    FontDescriptor: descriptorRef,
    DW: 1000,
    W: [65, [500, 600]],
  });
  const descendantRef = context.register(descendant);
  const toUnicode = context.register(
    context.flateStream(
      toUnicodeMap([
        [65, 'A'],
        [66, 'B'],
      ]),
    ),
  );
  const font = context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'FixtureSans',
    Encoding: PDFName.of(nonIdentity ? 'UniJIS-UCS2-H' : 'Identity-H'),
    DescendantFonts: [descendantRef],
    ToUnicode: toUnicode,
  });
  const fontRef = context.register(font);
  addPage(doc, fontRef, 'BT /F1 20 Tf 1 0 0 1 40 200 Tm <00410042> Tj ET\n');
  return doc.save(SAVE_OPTIONS) as unknown as Uint8Array;
}

async function cffBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create(CREATE_OPTIONS);
  const context = doc.context;
  const otf = readFileSync(OTF_URL);
  const program = context.register(
    context.flateStream(otf, { Subtype: 'OpenType', Length1: otf.byteLength }),
  );
  const descriptor = context.obj({
    Type: 'FontDescriptor',
    FontName: 'SourceCodePro-Regular',
    Flags: 4,
    FontBBox: [0, -200, 1000, 900],
    ItalicAngle: 0,
    Ascent: 800,
    Descent: -200,
    CapHeight: 700,
    StemV: 80,
    FontFile3: program,
  });
  const descriptorRef = context.register(descriptor);
  const descendant = context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType0',
    BaseFont: 'SourceCodePro-Regular',
    CIDSystemInfo: {
      Registry: 'Adobe',
      Ordering: 'Identity',
      Supplement: 0,
    },
    FontDescriptor: descriptorRef,
    DW: 600,
    W: [0, [600, 600, 600, 600, 600, 600, 600, 600]],
  });
  const descendantRef = context.register(descendant);
  const font = context.obj({
    Type: 'Font',
    Subtype: 'Type0',
    BaseFont: 'SourceCodePro-Regular',
    Encoding: PDFName.of('Identity-H'),
    DescendantFonts: [descendantRef],
  });
  const fontRef = context.register(font);
  addPage(doc, fontRef, 'q 0.2 0.2 0.2 RG 40 180 m 300 180 l S Q\n');
  return doc.save(SAVE_OPTIONS) as unknown as Uint8Array;
}

export async function buildFontFixture(kind: FontFixtureKind): Promise<FontFixture> {
  const meta = FONT_FIXTURE_MANIFEST.find((entry) => entry.kind === kind);
  if (!meta) throw new Error(`Unknown font fixture ${kind}`);
  const bytes =
    kind === 'type3'
      ? await type3Bytes()
      : kind === 'type0-identity'
        ? await type0Bytes(false)
        : kind === 'type0-nonidentity'
          ? await type0Bytes(true)
          : await cffBytes();
  return { ...meta, bytes };
}
