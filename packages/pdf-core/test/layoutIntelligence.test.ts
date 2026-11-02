/**
 * Layout-intelligence regression tests.
 *
 * Each block pins one defect that the Phase 3 audit reproduced and fixed. They
 * are unit-level on purpose: the benchmark in `layoutBenchmark.test.ts` reports
 * aggregate scores, while these say *which* rule must not regress and why.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { PageGeometry } from '../src/document/geometry.js';
import {
  charAdvanceWeight,
  fontNameSignals,
  glyphsFromTextItems,
  normalizeFontFamily,
  type RawTextContent,
  type RawTextItem,
} from '../src/document/glyphs.js';
import { buildPageLayout, type LayoutBuildOptions } from '../src/document/group.js';
import { buildDocumentLayout } from '../src/document/document.js';
import { assessReflow } from '../src/document/reflow.js';
import { computeStructureConfidence } from '../src/document/confidence.js';
import { relateLines, collisionRisk } from '../src/document/relations.js';
import { extractPageLayouts } from '../src/render/textLayout.js';
import { configurePdfjsRuntime, resetPdfCache } from '../src/render/pdfjsRuntime.js';
import { normalizeForMatch } from '../src/textedit/text.js';
import { analyzeEditCapability } from '../src/textedit/capabilities.js';
import type { PageTextCapability, TextEdit } from '../src/textedit/types.js';
import { buildCase } from './corpus/synthetic.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href,
});

interface TextSpec {
  text: string;
  x: number;
  /** Display-space baseline (top-left origin). */
  y: number;
  size?: number;
  bold?: boolean;
  italic?: boolean;
}

function itemWidth(text: string, size: number): number {
  return Array.from(text).reduce((sum, char) => sum + charAdvanceWeight(char), 0) * size;
}

function makeContent(items: readonly TextSpec[], height: number): RawTextContent {
  const raw: RawTextItem[] = items.map((item) => {
    const size = item.size ?? 11;
    return {
      str: item.text,
      transform: [size, 0, 0, size, item.x, height - item.y - size * 0.82],
      width: itemWidth(item.text, size),
      height: size,
      fontName: item.bold ? 'F2' : item.italic ? 'F3' : 'F1',
    };
  });
  return {
    items: raw,
    styles: {
      F1: { fontFamily: 'Helvetica', fontWeight: 'normal' },
      F2: { fontFamily: 'Helvetica', fontWeight: 'bold' },
      F3: { fontFamily: 'Helvetica-Oblique', fontStyle: 'italic' },
    },
  };
}

function syntheticPage(options: {
  items: readonly TextSpec[];
  width?: number;
  height?: number;
  layout?: LayoutBuildOptions;
}) {
  const width = options.width ?? 612;
  const height = options.height ?? 792;
  const mediaBox = { x: 0, y: 0, width, height };
  const geometry = new PageGeometry({ mediaBox, cropBox: mediaBox, rotation: 0 });
  const content = makeContent(options.items, height);
  const extracted = glyphsFromTextItems(content, { pageIndex: 0, geometry });
  const layout = buildPageLayout({
    pageIndex: 0,
    geometry,
    mediaBox,
    cropBox: mediaBox,
    rotation: 0,
    glyphs: extracted.glyphs,
    ...(options.layout ? { options: options.layout } : {}),
  });
  layout.structureConfidence = computeStructureConfidence(layout);
  return layout;
}

describe('tables', () => {
  it('detects a left-aligned 4x4 table when cell gaps are encoded as wide space glyphs', async () => {
    const testCase = await buildCase('table', 83);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    expect(layout.tables).toHaveLength(1);
    const table = layout.tables[0]!;
    expect(table.rowCount).toBe(4);
    expect(table.columnCount).toBe(4);
    // Every cell is its own paragraph and knows its grid position.
    for (const row of table.rows) {
      for (const cell of row.cells) {
        expect(cell.row).toBe(row.index);
        expect(cell.rowSpan).toBe(1);
        expect(cell.colSpan).toBe(1);
      }
    }
  });

  it('detects a 2x3 table', async () => {
    const testCase = await buildCase('small-table', 97);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    expect(layout.tables).toHaveLength(1);
    expect(layout.tables[0]!.rowCount).toBe(3);
    expect(layout.tables[0]!.columnCount).toBe(2);
  });

  it('keeps cell paragraphs owned by a block and in reading order', async () => {
    const testCase = await buildCase('table', 83);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    const inBlock = new Set(layout.blocks.flatMap((block) => block.paragraphIds));
    for (const paragraph of layout.paragraphs) {
      expect(inBlock.has(paragraph.id)).toBe(true);
      expect(layout.readingOrder).toContain(paragraph.id);
    }
  });

  it('demotes a cell paragraph whose table was rejected, instead of orphaning it', () => {
    // Four candidate cells in two rows, but the second row's columns do not line
    // up with the first, so the table is rejected at the grid stage.
    const layout = syntheticPage({
      items: [
        { text: 'Alpha', x: 60, y: 100 },
        { text: 'Beta', x: 200, y: 100 },
        { text: 'Gamma', x: 60, y: 130 },
        { text: 'Delta', x: 133, y: 130 },
      ],
    });
    for (const table of layout.tables) {
      expect(table.rows.length).toBeGreaterThanOrEqual(2);
    }
    const inBlock = new Set(layout.blocks.flatMap((block) => block.paragraphIds));
    for (const paragraph of layout.paragraphs) {
      expect(paragraph.tableId === undefined || layout.tables.some((t) => t.id === paragraph.tableId)).toBe(
        true,
      );
      expect(inBlock.has(paragraph.id)).toBe(true);
    }
  });
});

describe('columns', () => {
  it('keeps long left-column lines in their column instead of calling them spanning', async () => {
    const testCase = await buildCase('two-column', 67);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    expect(layout.columns).toHaveLength(2);
    const blockOf = (paragraphId: string) =>
      layout.blocks.find((block) => block.paragraphIds.includes(paragraphId));
    // Nothing in either column may be classified as spanning.
    const bodyParagraphs = layout.paragraphs.filter((paragraph) => paragraph.role === 'body');
    for (const paragraph of bodyParagraphs) {
      const block = blockOf(paragraph.id);
      expect(block).toBeDefined();
      // The closing paragraph spans both columns; everything else is in one.
      if (paragraph.bbox.width < (layout.widthPt - 144) * 0.6) {
        expect(block!.columnIndex).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('groups a full-width paragraph without shattering it', async () => {
    const testCase = await buildCase('two-column', 67);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    const spanning = layout.paragraphs.filter((paragraph) => paragraph.role === 'body').at(-1)!;
    expect(spanning.lineIds.length).toBeGreaterThan(1);
  });
});

describe('lines', () => {
  it('does not interleave two overlapping text objects on one baseline', () => {
    // A large form number and a smaller title start at nearly the same x, the
    // way the IRS 1040 draws its masthead.
    const layout = syntheticPage({
      items: [
        { text: 'Department of the Treasury', x: 100, y: 100, size: 6 },
        { text: 'U.S. Individual Income Tax Return', x: 100, y: 108, size: 12 },
      ],
    });
    const texts = layout.lines.map((line) => line.text).join(' | ');
    // Each source string must survive in one piece rather than character by
    // character ("DUep.aSrtm. eInnt...").
    expect(texts).toContain('Department of the Treasury');
    expect(texts).toContain('U.S. Individual Income Tax Return');
  });

  it('still joins a bold lead-in with the rest of its line', () => {
    const layout = syntheticPage({
      items: [
        { text: 'Key finding:', x: 72, y: 100, bold: true },
        { text: ' the results hold', x: 150, y: 100 },
      ],
    });
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]!.text).toBe('Key finding: the results hold');
  });
});

describe('roles', () => {
  it('promotes a same-size bold uppercase line to a heading', () => {
    const layout = syntheticPage({
      items: [
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 100 },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 116 },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 132 },
        { text: 'RESULTS SUMMARY', x: 72, y: 170, bold: true },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 200 },
      ],
    });
    const heading = layout.paragraphs.find((paragraph) => paragraph.text.includes('RESULTS SUMMARY'));
    expect(heading?.role).toBe('heading');
    expect(heading?.headingLevel).toBe(3);
  });

  it('gives the largest text on the page heading level 1', () => {
    const layout = syntheticPage({
      items: [
        { text: 'Document Intelligence Report', x: 72, y: 90, size: 24, bold: true },
        { text: 'Smaller section title', x: 72, y: 140, size: 14, bold: true },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 180 },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 196 },
      ],
    });
    const title = layout.paragraphs.find((paragraph) => paragraph.text.includes('Document Intelligence'));
    const section = layout.paragraphs.find((paragraph) => paragraph.text.includes('Smaller section'));
    expect(title?.role).toBe('heading');
    expect(title?.headingLevel).toBe(1);
    expect(section?.role).toBe('heading');
    expect(section?.headingLevel).toBeGreaterThan(1);
  });

  it('classifies a marker-led line at the bottom as a footnote and keeps its wrap', () => {
    const layout = syntheticPage({
      items: [
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 100 },
        { text: 'Body paragraph text that runs on for a while.', x: 72, y: 116 },
        { text: '1 A footnote that starts with a marker and wraps onto', x: 72, y: 740, size: 8 },
        { text: 'a second line at the very bottom of the page.', x: 72, y: 750, size: 8 },
      ],
    });
    const footnote = layout.paragraphs.find((paragraph) => paragraph.text.startsWith('1 A footnote'));
    expect(footnote?.role).toBe('footnote');
    expect(footnote?.lineIds.length).toBe(2);
  });

  it('does not treat a body line starting with "Table" as a caption', () => {
    const layout = syntheticPage({
      items: [
        { text: 'Table values are read from the left column.', x: 72, y: 100 },
        { text: 'Table values are read from the left column.', x: 72, y: 116 },
        { text: 'Table 2: Caption text', x: 72, y: 160, size: 10 },
      ],
    });
    expect(layout.paragraphs[0]!.role).toBe('body');
    const caption = layout.paragraphs.find((paragraph) => paragraph.text.startsWith('Table 2'));
    expect(caption?.role).toBe('caption');
  });
});

describe('typography', () => {
  it('reads Computer Modern bold/italic conventions out of font names', () => {
    expect(fontNameSignals('CMBX12')).toEqual({ family: 'times', bold: true, italic: false });
    expect(fontNameSignals('ABCDEF+CMTI10')).toEqual({ family: 'times', bold: false, italic: true });
    expect(fontNameSignals('CMSSBX10')).toEqual({ family: 'helvetica', bold: true, italic: false });
    expect(fontNameSignals('CMTT10')).toEqual({ family: 'courier', bold: false, italic: false });
    expect(fontNameSignals('LMRoman10-Bold')).toEqual({ family: 'times', bold: true, italic: false });
    expect(fontNameSignals('DejaVu Sans Mono')).toEqual({
      family: 'courier',
      bold: false,
      italic: false,
    });
  });

  it('normalises Computer Modern families', () => {
    expect(normalizeFontFamily('CMR10').family).toBe('times');
    expect(normalizeFontFamily('CMSSBX10').family).toBe('helvetica');
    expect(normalizeFontFamily('CMTT10').family).toBe('courier');
  });

  it('folds ligatures and soft hyphens when matching text', () => {
    expect(normalizeForMatch('\uFB01nd the \uFB02ow')).toBe('find the flow');
    expect(normalizeForMatch('trans\u00ADlation')).toBe('translation');
    expect(normalizeForMatch('a\u00A0b')).toBe('a b');
  });
});

describe('edit capability honesty', () => {
  function pageWithFont(embedded: boolean, baseName: string): PageTextCapability {
    return {
      pageIndex: 0,
      widthPt: 612,
      heightPt: 792,
      rotation: 0,
      likelyScanned: false,
      textLayer: 'vector',
      textObjects: [
        {
          index: 0,
          text: 'Hello world',
          bounds: { x: 72, y: 700, width: 80, height: 11 },
          fontSize: 11,
          renderMode: 0,
          font: {
            baseName,
            familyName: baseName,
            weight: 400,
            italicAngle: 0,
            flags: 0,
            monospace: false,
            serif: true,
            embedded,
          },
        },
      ],
      fonts: [],
      warnings: [],
    } as unknown as PageTextCapability;
  }

  const edit: TextEdit = {
    id: 'e1',
    pageIndex: 0,
    find: 'Hello world',
    replace: 'Hello there',
  } as TextEdit;

  it('does not claim high fidelity for a non-embedded custom font', () => {
    const capability = analyzeEditCapability(edit, pageWithFont(false, 'FancyHandwriting'));
    expect(capability.fidelity).not.toBe('exact');
    expect(capability.fidelity).not.toBe('high');
  });

  it('keeps exact fidelity for an embedded font', () => {
    const capability = analyzeEditCapability(edit, pageWithFont(true, 'FancyHandwriting'));
    expect(capability.strategy).toBe('native-object');
    expect(capability.fidelity).toBe('exact');
  });
});

describe('images and reflow', () => {
  it('extracts image boxes from the operator list and refuses to reflow into them', async () => {
    const testCase = await buildCase('image', 149);
    const layout = (await extractPageLayouts(testCase.bytes))[0]!;
    expect(layout.images?.length ?? 0).toBeGreaterThan(0);
    const image = layout.images![0]!;
    expect(image.bbox.width).toBeGreaterThan(100);
    expect(image.bbox.y).toBeGreaterThan(0);
    expect(image.bbox.y).toBeLessThan(layout.heightPt);

    const victim = layout.paragraphs[0]!;
    const assessment = assessReflow(
      victim,
      layout,
      {
        text: 'x '.repeat(600).trim(),
        width: victim.bbox.width,
        fontSize: 11,
        lineHeightPt: 16,
      },
      (text) => text.length * 5.4,
    );
    expect(assessment.safe).toBe(false);
  });
});

describe('structure confidence', () => {
  it('is present, bounded, and lower for a doubtful page than a clean one', () => {
    const clean = syntheticPage({
      items: [
        { text: 'First paragraph line one that is reasonably long.', x: 72, y: 100 },
        { text: 'First paragraph line two that is reasonably long.', x: 72, y: 116 },
        // A three-pitch gap is an unambiguous paragraph break.
        { text: 'Second paragraph line one that is also long.', x: 72, y: 164 },
        { text: 'Second paragraph line two that is also long.', x: 72, y: 180 },
      ],
    });
    const doubtful = syntheticPage({
      items: [
        { text: 'Line one with an odd gap below it.', x: 72, y: 100 },
        // 22pt below a 16pt pitch: just under the 1.4x paragraph cut, so the
        // merge is made on a marginal signal and the confidence must say so.
        { text: 'Line two sits one pixel under the merge threshold.', x: 72, y: 154 },
        { text: 'Line three continues normally after it.', x: 72, y: 170 },
      ],
    });
    const cleanConfidence = clean.structureConfidence!;
    const doubtfulConfidence = doubtful.structureConfidence!;
    for (const confidence of [cleanConfidence, doubtfulConfidence]) {
      for (const value of Object.values(confidence).filter(
        (value): value is number => typeof value === 'number',
      )) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(cleanConfidence.grouping).toBeGreaterThan(doubtfulConfidence.grouping);
  });
});

describe('relations', () => {
  it('measures a continuation from geometry instead of guessing', () => {
    const layout = syntheticPage({
      items: [
        { text: 'A line of body text that is long enough to be a column.', x: 72, y: 100 },
        { text: 'The next line of the same paragraph continues here.', x: 72, y: 116 },
      ],
    });
    const [first, second] = layout.lines;
    const relation = relateLines(first!, second!, { linePitch: 16 });
    expect(relation.baselineGap).toBeCloseTo(16, 1);
    expect(relation.gapRatio).toBeCloseTo(1, 1);
    expect(relation.sharedAlignment).toBe('left');
    expect(relation.continuation).toBeGreaterThan(0.6);
  });

  it('reports overlap as a collision only when it is more than a hairline', () => {
    const target = { id: 't', bbox: { x: 0, y: 0, width: 100, height: 20 } };
    expect(collisionRisk({ x: 10, y: 5, width: 50, height: 10 }, [target]).collides).toBe(true);
    expect(collisionRisk({ x: 0, y: 19.8, width: 100, height: 10 }, [target]).collides).toBe(false);
  });
});

describe('incremental extraction', () => {
  beforeAll(async () => {
    await resetPdfCache();
  });

  it('returns identical ids when the same pages are read twice', async () => {
    const testCase = await buildCase('prose', 11);
    const first = await extractPageLayouts(testCase.bytes, { pageIndexes: [0] });
    const second = await extractPageLayouts(testCase.bytes, { pageIndexes: [0] });
    expect(second[0]!.lines.map((line) => line.id)).toEqual(first[0]!.lines.map((line) => line.id));
    expect(second[0]!.paragraphs.map((paragraph) => paragraph.id)).toEqual(
      first[0]!.paragraphs.map((paragraph) => paragraph.id),
    );
  });
});

describe('document-level furniture', () => {
  it('demotes a one-off line in the margin band to body text on multi-page documents', () => {
    const pageOne = syntheticPage({
      items: [
        { text: 'word based only on its context. Unlike left-to-', x: 72, y: 40, size: 10 },
        { text: 'Body content that is clearly in the page body, line one.', x: 72, y: 200 },
        { text: 'Body content that is clearly in the page body, line two.', x: 72, y: 216 },
      ],
    });
    const pageTwo = syntheticPage({
      items: [
        { text: 'Body content that is clearly in the page body, line one.', x: 72, y: 200 },
        { text: 'Body content that is clearly in the page body, line two.', x: 72, y: 216 },
      ],
    });
    pageTwo.index = 1;
    const document = buildDocumentLayout([pageOne, pageTwo]);
    const first = document.pages[0]!;
    const topLine = first.paragraphs.find((paragraph) =>
      paragraph.text.startsWith('word based only'),
    );
    expect(topLine?.role).toBe('body');
  });
});
