/**
 * The panel's claims are pinned here: the overall score is the mean of the
 * engine's own facets (not a second opinion), a refused table is explained
 * rather than hidden, and a page with no text does not pretend to have been
 * understood.
 */

import { describe, expect, it } from 'vitest';
import type { PageLayout, Paragraph, StructureConfidence } from '@pdfshush/pdf-core';
import {
  buildStructureReport,
  bandFor,
  formatConfidence,
  CONFIDENCE_FACETS,
  ROLE_LABELS,
} from './structure-report';

function confidence(overrides: Partial<StructureConfidence> = {}): StructureConfidence {
  return {
    grouping: 0.9,
    paragraphBoundaries: 0.9,
    readingOrder: 0.9,
    fontIdentification: 0.9,
    tableDetection: 0.9,
    regionClassification: 0.9,
    layoutRelationships: 0.9,
    reflowSafety: 0.9,
    basis: [],
    ...overrides,
  };
}

function paragraph(role: Paragraph['role'], ambiguous = false): Paragraph {
  return { role, ambiguous } as Paragraph;
}

function layout(overrides: Partial<Record<keyof PageLayout, unknown>> = {}): PageLayout {
  return {
    words: [{}, {}, {}, {}],
    lines: [{}, {}],
    paragraphs: [paragraph('body'), paragraph('heading')],
    blocks: [{}],
    columns: [],
    tables: [],
    images: [],
    warnings: [],
    structureConfidence: confidence(),
    ...overrides,
  } as unknown as PageLayout;
}

describe('bandFor', () => {
  it('bands at the documented thresholds', () => {
    expect(bandFor(1)).toBe('high');
    expect(bandFor(0.85)).toBe('high');
    expect(bandFor(0.849)).toBe('medium');
    expect(bandFor(0.65)).toBe('medium');
    expect(bandFor(0.649)).toBe('low');
    expect(bandFor(0)).toBe('low');
  });

  it('treats a non-finite value as low, never as high', () => {
    expect(bandFor(Number.NaN)).toBe('low');
    expect(bandFor(Number.POSITIVE_INFINITY)).toBe('low');
  });
});

describe('buildStructureReport', () => {
  it('uses the mean of the engine facets, not a new measurement', () => {
    const report = buildStructureReport(
      layout({
        structureConfidence: confidence({
          grouping: 1,
          paragraphBoundaries: 0.8,
          readingOrder: 0.8,
          fontIdentification: 0.8,
          tableDetection: 0.8,
          regionClassification: 0.8,
          layoutRelationships: 0.8,
          reflowSafety: 0.4,
        }),
      }),
    );
    expect(report.available).toBe(true);
    expect(report.facets).toHaveLength(CONFIDENCE_FACETS.length);
    expect(report.overall).toBeCloseTo(0.775, 5);
    expect(report.band).toBe('medium');
  });

  it('carries the engine basis through unchanged', () => {
    const basis = ['40% of paragraphs sit on an ambiguous merge boundary', '2 columns detected'];
    const report = buildStructureReport(layout({ structureConfidence: confidence({ basis }) }));
    expect(report.basis).toEqual(basis);
  });

  it('reports honestly when a layout has no confidence model', () => {
    const report = buildStructureReport(layout({ structureConfidence: undefined }));
    expect(report.available).toBe(false);
    expect(report.overall).toBeNull();
    expect(report.band).toBeNull();
    expect(report.facets).toEqual([]);
    // Counts still come from the layout itself.
    expect(report.extraction.words).toBe(4);
  });

  it('counts extraction without rounding up', () => {
    const report = buildStructureReport(
      layout({
        words: [{}, {}, {}],
        lines: [{}, {}],
        paragraphs: [paragraph('body'), paragraph('body'), paragraph('unknown', true)],
        blocks: [{}, {}],
        columns: [{}, {}],
        images: [{}],
        tables: [
          {
            rows: [{ cells: [{}, {}] }, { cells: [{}, {}, {}] }],
          },
        ],
      }),
    );
    expect(report.extraction).toMatchObject({
      words: 3,
      lines: 2,
      paragraphs: 3,
      blocks: 2,
      columns: 2,
      tables: 1,
      tableCells: 5,
      images: 1,
      ambiguous: 1,
    });
    expect(report.extraction.roleCounts).toEqual([
      { role: 'body', count: 2 },
      { role: 'unknown', count: 1 },
    ]);
  });

  it('orders tied role counts deterministically', () => {
    const report = buildStructureReport(
      layout({ paragraphs: [paragraph('heading'), paragraph('caption')] }),
    );
    expect(report.extraction.roleCounts.map((entry) => entry.role)).toEqual(['caption', 'heading']);
  });

  it('explains what was extracted in plain sentences', () => {
    const report = buildStructureReport(
      layout({ paragraphs: [paragraph('body'), paragraph('heading')] }),
    );
    expect(report.explanation[0]).toContain('4 words');
    expect(report.explanation[1]).toBe('Read as a single column.');
    expect(report.explanation[2]).toBe('No table was detected on this page.');
    expect(report.explanation[3]).toBe('Roles: 1 body, 1 heading.');
  });

  it('says there is nothing to extract on an image-only page', () => {
    const report = buildStructureReport(
      layout({ words: [], lines: [], paragraphs: [], blocks: [], structureConfidence: undefined }),
    );
    expect(report.explanation).toEqual([
      'This page has no extractable text. It may be a scan or an image-only page.',
    ]);
    expect(report.limitations[0]).toMatch(/no text layer/i);
  });

  it('states that a non-repeating grid was refused, not that none exists', () => {
    const report = buildStructureReport(layout({ lines: [{}, {}], tables: [] }));
    expect(report.limitations).toContainEqual(expect.stringMatching(/grid repeats across rows/i));
    expect(report.limitations).toContainEqual(expect.stringMatching(/stays text/i));
  });

  it('flags ambiguous boundaries as kept-and-flagged, not guessed', () => {
    const report = buildStructureReport(
      layout({ paragraphs: [paragraph('body', true), paragraph('body')] }),
    );
    expect(report.limitations[0]).toContain('1 paragraph boundary was ambiguous');
    expect(report.limitations[0]).toContain('rather than silently guessed');
  });

  it('does not claim a role the engine did not assign', () => {
    const report = buildStructureReport(layout({ paragraphs: [paragraph('unknown')] }));
    expect(report.limitations).toContainEqual(expect.stringMatching(/no confident role/i));
  });

  it('surfaces the engine warning when table and column alignment compete', () => {
    const report = buildStructureReport(
      layout({
        tables: [{ rows: [{ cells: [{}] }] }],
        warnings: ['Tables and columns share alignment; table boundaries may be ambiguous'],
      }),
    );
    expect(report.warnings).toEqual([
      'Tables and columns share alignment; table boundaries may be ambiguous',
    ]);
    expect(report.limitations).toContainEqual(expect.stringMatching(/boundary may be approximate/i));
  });

  it('has a label for every role the engine can emit', () => {
    for (const role of Object.keys(ROLE_LABELS)) {
      expect(ROLE_LABELS[role as keyof typeof ROLE_LABELS].length).toBeGreaterThan(0);
    }
    expect(Object.keys(ROLE_LABELS)).toHaveLength(9);
  });
});

describe('formatConfidence', () => {
  it('formats 0..1 as a whole percent', () => {
    expect(formatConfidence(0.623)).toBe('62%');
    expect(formatConfidence(1)).toBe('100%');
    expect(formatConfidence(-1)).toBe('0%');
    expect(formatConfidence(Number.NaN)).toBe('0%');
  });
});
