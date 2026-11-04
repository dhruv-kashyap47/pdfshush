/**
 * Real-document regression gate.
 *
 * Every assertion here is about a page that this repository did not draw. The
 * invariants (no text lost, no paragraph duplicated, reading order complete)
 * would be trivially true for a synthetic corpus and are not: a real PDF has
 * overlapping text objects, page-crossing paragraphs, stamps and form grids.
 *
 * The landmark roles are hand annotations of what a reader sees; they are the
 * part a synthetic corpus cannot supply.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { extractDocumentLayout } from '../src/render/textLayout.js';
import { configurePdfjsRuntime } from '../src/render/pdfjsRuntime.js';
import type { DocumentLayout, PageLayout } from '../src/document/types.js';
import { REAL_DOCUMENTS, readRealPdf, type RealDocumentSpec } from './corpus/real.js';

configurePdfjsRuntime({
  workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    .href,
});

const layouts = new Map<string, DocumentLayout>();

beforeAll(async () => {
  for (const spec of REAL_DOCUMENTS) {
    layouts.set(spec.name, await extractDocumentLayout(readRealPdf(spec)));
  }
}, 600_000);

function pageOf(spec: RealDocumentSpec, index: number): PageLayout {
  const layout = layouts.get(spec.name);
  if (!layout) throw new Error(`layout for ${spec.name} was not extracted`);
  const page = layout.pages[index];
  if (!page) throw new Error(`${spec.name} has no page ${index}`);
  return page;
}

function normalize(text: string): string {
  // Case-sensitive on purpose: the annotation says exactly what the page shows,
  // and a case-insensitive match made "Neural machine translation is a recently
  // proposed approach..." satisfy the title landmark "NEURAL MACHINE
  // TRANSLATION".
  return text.replace(/\s+/g, ' ').trim();
}

describe('real corpus: structural invariants', () => {
  it.each(REAL_DOCUMENTS.map((spec) => [spec.name, spec] as const))(
    '%s preserves every line exactly once',
    (_name, spec) => {
      const layout = layouts.get(spec.name)!;
      expect(layout.pages).toHaveLength(spec.pages);

      for (const page of layout.pages) {
        // Every line is inside exactly one paragraph: nothing dropped, nothing
        // claimed twice.
        const owners = new Map<string, number>();
        for (const paragraph of page.paragraphs) {
          expect(paragraph.lineIds.length).toBeGreaterThan(0);
          for (const lineId of paragraph.lineIds) {
            owners.set(lineId, (owners.get(lineId) ?? 0) + 1);
          }
        }
        for (const line of page.lines) {
          expect(line.text.length).toBeGreaterThan(0);
          expect(owners.get(line.id)).toBe(1);
        }
        expect(owners.size).toBe(page.lines.length);

        // Reading order is a permutation of the paragraph list.
        expect(new Set(page.readingOrder).size).toBe(page.readingOrder.length);
        expect(page.readingOrder.length).toBe(page.paragraphs.length);
        expect(new Set(page.readingOrder)).toEqual(new Set(page.paragraphs.map((p) => p.id)));

        // Line spans line up with the line ids they describe.
        for (const paragraph of page.paragraphs) {
          expect(paragraph.lineSpans.map((span) => span.lineId)).toEqual(paragraph.lineIds);
          expect(paragraph.text.trim().length).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each(REAL_DOCUMENTS.map((spec) => [spec.name, spec] as const))(
    '%s reports structure confidence that is present and bounded',
    (_name, spec) => {
      for (const page of layouts.get(spec.name)!.pages) {
        const confidence = page.structureConfidence;
        expect(confidence).toBeDefined();
        if (!confidence) return;
        const fields = [
          'grouping',
          'paragraphBoundaries',
          'readingOrder',
          'fontIdentification',
          'tableDetection',
          'regionClassification',
          'layoutRelationships',
          'reflowSafety',
        ] as const;
        for (const field of fields) {
          expect(confidence[field]).toBeGreaterThanOrEqual(0);
          expect(confidence[field]).toBeLessThanOrEqual(1);
        }
        // These documents are set in standard Latin faces whose names pdf.js
        // reports; font identification should be near-certain, and if it is not
        // the confidence report is lying.
        expect(confidence.fontIdentification).toBeGreaterThan(0.9);
      }
    },
  );
});

describe('real corpus: landmarks', () => {
  for (const spec of REAL_DOCUMENTS) {
    it(`${spec.name} classifies its hand-annotated landmarks`, () => {
      for (const group of spec.landmarks) {
        const page = pageOf(spec, group.page);
        for (const landmark of group.entries) {
          const needle = normalize(landmark.text);
          const matches = page.paragraphs.filter((paragraph) =>
            normalize(paragraph.text).includes(needle),
          );
          expect(
            matches.length,
            `${spec.name} page ${group.page}: no paragraph contains "${landmark.text}"`,
          ).toBeGreaterThan(0);
          expect(
            matches.some((paragraph) => landmark.roles.includes(paragraph.role)),
            `${spec.name} page ${group.page}: "${landmark.text}" was ${matches
              .map((paragraph) => paragraph.role)
              .join('/')}, expected one of ${landmark.roles.join('/')}`,
          ).toBe(true);
        }
      }
    });
  }

  for (const spec of REAL_DOCUMENTS) {
    for (const expectation of spec.columns ?? []) {
      it(`${spec.name} page ${expectation.page} has ${expectation.count} column(s)`, () => {
        expect(pageOf(spec, expectation.page).columns).toHaveLength(expectation.count);
      });
    }
  }

  it('refuses column inference on the IRS form page', () => {
    const spec = REAL_DOCUMENTS.find((entry) => entry.name === 'irs-1040');
    if (!spec) throw new Error('the IRS fixture is missing');
    const page = pageOf(spec, 0);
    // The form's field boxes look exactly like a four-column gutter grid, and
    // reading them that way shredded labels into cells ("than four", "(3)",
    // "dependents,"). The page is now read as one column (PLAN §31.6, D4).
    expect(page.columns).toHaveLength(1);
    expect(page.warnings.join(' ')).toMatch(/Form-like page/);
    expect(page.structureConfidence?.basis.join(' ')).toMatch(/Form-like page/);
    // One real grid survives (the filing-status block); the dot-leader rows are
    // form guides, not cells, and a two-row field group is not a table.
    expect(page.tables).toHaveLength(1);
    expect(
      page.paragraphs.some((paragraph) =>
        paragraph.text.includes('Your first name and middle initial'),
      ),
    ).toBe(true);
  });

  for (const spec of REAL_DOCUMENTS.filter((entry) => entry.expectTables)) {
    it(`${spec.name} detects its grid as at least one table`, () => {
      const layout = layouts.get(spec.name)!;
      const tables = layout.pages.reduce((sum, page) => sum + page.tables.length, 0);
      const cells = layout.pages.reduce(
        (sum, page) =>
          sum + page.tables.reduce((inner, table) => inner + table.rows.length * table.columnCount, 0),
        0,
      );
      expect(tables).toBeGreaterThan(0);
      expect(cells).toBeGreaterThan(0);
    });
  }
});

describe('real corpus: image geometry', () => {
  it('extracts no phantom images on these text-only documents', () => {
    for (const spec of REAL_DOCUMENTS) {
      for (const page of layouts.get(spec.name)!.pages) {
        for (const image of page.images ?? []) {
          expect(image.bbox.width).toBeGreaterThan(0);
          expect(image.bbox.height).toBeGreaterThan(0);
          expect(image.bbox.x).toBeGreaterThanOrEqual(-1);
          expect(image.bbox.y).toBeGreaterThanOrEqual(-1);
        }
      }
    }
  });
});

describe('real corpus: verbatim content', () => {
  it('keeps known sentences intact and in order', () => {
    for (const spec of REAL_DOCUMENTS) {
      for (const probe of spec.probes ?? []) {
        const page = pageOf(spec, probe.page);
        const byId = new Map(page.paragraphs.map((paragraph) => [paragraph.id, paragraph]));
        const text = normalize(
          page.readingOrder.map((id) => byId.get(id)?.text ?? '').join(' '),
        );
        expect(
          text.includes(normalize(probe.text)),
          `${spec.name} page ${probe.page} lost or reordered: "${probe.text}"`,
        ).toBe(true);
      }
    }
  });
});
