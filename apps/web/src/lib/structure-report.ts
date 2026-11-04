/**
 * D4 (PLAN.md §31.4): inspectable structure confidence.
 *
 * `computeStructureConfidence` has been returning eight evidence-backed facets
 * and a `basis` list since Phase 3, but the editor never showed any of it. A
 * number nobody can see cannot keep the engine honest, and a low score with no
 * explanation is worse than no score at all.
 *
 * This module translates the engine's own model into three things a reader can
 * act on:
 *
 *  - the eight facets, banded, with the `basis` sentences that moved them;
 *  - a plain count of what was actually extracted (words → lines → paragraphs →
 *    blocks, plus roles, tables and columns);
 *  - a list of what the model deliberately did **not** infer. Refusing to guess
 *    is a feature here, so it is stated in product language rather than left to
 *    an `ambiguous: true` flag.
 *
 * It adds no confidence of its own: `overall` is the mean of the engine's eight
 * facets, and every sentence is derived from the layout, never invented.
 */

import type { PageLayout, ParagraphRole, StructureConfidence } from '@pdfshush/pdf-core';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export const BAND_COPY: Record<ConfidenceBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Bands are thresholds on the engine's 0..1 values, not new measurements. */
export function bandFor(value: number): ConfidenceBand {
  if (!Number.isFinite(value)) return 'low';
  if (value >= 0.85) return 'high';
  if (value >= 0.65) return 'medium';
  return 'low';
}

type FacetKey = Exclude<keyof StructureConfidence, 'basis'>;

export const CONFIDENCE_FACETS: { key: FacetKey; label: string; detail: string }[] = [
  { key: 'grouping', label: 'Grouping', detail: 'Words into lines into paragraphs' },
  {
    key: 'paragraphBoundaries',
    label: 'Paragraph boundaries',
    detail: 'Where one paragraph ends and the next begins',
  },
  { key: 'readingOrder', label: 'Reading order', detail: 'Columns and spanning blocks' },
  { key: 'fontIdentification', label: 'Fonts', detail: 'Families and weights recognised by name' },
  { key: 'tableDetection', label: 'Tables', detail: 'Grid detection and cell alignment' },
  { key: 'regionClassification', label: 'Roles', detail: 'Headings, captions, footnotes, furniture' },
  { key: 'layoutRelationships', label: 'Layout relationships', detail: 'Adjacency and shared edges' },
  { key: 'reflowSafety', label: 'Reflow safety', detail: 'Free space and collision risk' },
];

export interface StructureFacet {
  key: FacetKey;
  label: string;
  detail: string;
  value: number;
  band: ConfidenceBand;
}

export interface RoleCount {
  role: ParagraphRole;
  count: number;
}

export const ROLE_LABELS: Record<ParagraphRole, string> = {
  body: 'body',
  heading: 'heading',
  'list-item': 'list item',
  caption: 'caption',
  footnote: 'footnote',
  'table-cell': 'table cell',
  header: 'page header',
  footer: 'page footer',
  unknown: 'unclassified',
};

export interface ExtractionSummary {
  words: number;
  lines: number;
  paragraphs: number;
  blocks: number;
  columns: number;
  tables: number;
  tableCells: number;
  images: number;
  ambiguous: number;
  roleCounts: RoleCount[];
}

export interface StructureReport {
  /** False when the page model came from a source that does not compute it. */
  available: boolean;
  /** Mean of the eight facets, or null when unavailable. Never guessed. */
  overall: number | null;
  band: ConfidenceBand | null;
  facets: StructureFacet[];
  /** The engine's own explanation of what moved the numbers. */
  basis: string[];
  extraction: ExtractionSummary;
  /** What was extracted, in plain sentences. */
  explanation: string[];
  /** What the model refused to infer, or could not classify. */
  limitations: string[];
  warnings: string[];
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

function summarizeExtraction(layout: PageLayout): ExtractionSummary {
  const tableCells = layout.tables.reduce(
    (sum, table) => sum + table.rows.reduce((inner, row) => inner + row.cells.length, 0),
    0,
  );
  const counts = new Map<ParagraphRole, number>();
  for (const paragraph of layout.paragraphs) {
    counts.set(paragraph.role, (counts.get(paragraph.role) ?? 0) + 1);
  }
  const roleCounts = [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    // Most common first, then a stable alphabetical tiebreak: a table of roles
    // should not shuffle between two identical pages.
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  return {
    words: layout.words.length,
    lines: layout.lines.length,
    paragraphs: layout.paragraphs.length,
    blocks: layout.blocks.length,
    columns: layout.columns.length,
    tables: layout.tables.length,
    tableCells,
    images: layout.images?.length ?? 0,
    ambiguous: layout.paragraphs.filter((paragraph) => paragraph.ambiguous).length,
    roleCounts,
  };
}

function explainExtraction(extraction: ExtractionSummary): string[] {
  if (extraction.words === 0) {
    return ['This page has no extractable text. It may be a scan or an image-only page.'];
  }

  const sentences = [
    `Extracted ${plural(extraction.words, 'word')} into ${plural(extraction.lines, 'line')}, `
      + `${plural(extraction.paragraphs, 'paragraph')} and ${plural(extraction.blocks, 'block')}.`,
  ];

  sentences.push(
    extraction.columns > 1
      ? `Read across ${plural(extraction.columns, 'column')}, left to right within each column.`
      : 'Read as a single column.',
  );

  if (extraction.tables > 0) {
    sentences.push(
      `Detected ${plural(extraction.tables, 'table')} with ${plural(extraction.tableCells, 'cell')}.`,
    );
  } else {
    sentences.push('No table was detected on this page.');
  }

  if (extraction.roleCounts.length > 0) {
    const roles = extraction.roleCounts
      .map(({ role, count }) => `${count} ${ROLE_LABELS[role]}`)
      .join(', ');
    sentences.push(`Roles: ${roles}.`);
  }

  return sentences;
}

function explainLimitations(layout: PageLayout, extraction: ExtractionSummary): string[] {
  const limitations: string[] = [];

  if (extraction.words === 0) {
    limitations.push(
      'There is no text layer to inspect. Text editing and text-based extraction cannot help;'
        + ' Redact still works on the page image.',
    );
    return limitations;
  }

  if (extraction.ambiguous > 0) {
    limitations.push(
      `${plural(extraction.ambiguous, 'paragraph boundary was', 'paragraph boundaries were')}`
        + ' ambiguous. The grouping was kept and flagged rather than silently guessed.',
    );
  }

  const unclassified = extraction.roleCounts.find((entry) => entry.role === 'unknown')?.count ?? 0;
  if (unclassified > 0) {
    limitations.push(
      `${plural(unclassified, 'paragraph has', 'paragraphs have')} no confident role.`
        + ' The text is extracted; it is not claimed to be a heading, caption or footnote.',
    );
  }

  // The engine refuses a grid that does not repeat (PLAN §29.6, §31.16). Say so
  // where a reader is already asking "why is this not a table?".
  if (extraction.tables === 0 && extraction.lines > 0) {
    limitations.push(
      'A table is only reported when the grid repeats across rows: a two-row group whose cells align'
        + ' on different edges stays text, and on a form-like page so does a two-row field group.'
        + ' Merged cells are not reconstructed.',
    );
  }

  if (extraction.tables > 0 && layout.warnings.some((warning) => /ambiguous/i.test(warning))) {
    limitations.push(
      'Tables and columns share alignment on this page, so a detected table boundary may be'
        + ' approximate.',
    );
  }

  return limitations;
}

export function buildStructureReport(layout: PageLayout): StructureReport {
  const extraction = summarizeExtraction(layout);
  const confidence = layout.structureConfidence;

  if (!confidence) {
    return {
      available: false,
      overall: null,
      band: null,
      facets: [],
      basis: [],
      extraction,
      explanation: explainExtraction(extraction),
      limitations: explainLimitations(layout, extraction),
      warnings: [...layout.warnings],
    };
  }

  const facets: StructureFacet[] = CONFIDENCE_FACETS.map((facet) => {
    const value = confidence[facet.key];
    return { ...facet, value, band: bandFor(value) };
  });
  const overall = facets.reduce((sum, facet) => sum + facet.value, 0) / facets.length;

  return {
    available: true,
    overall,
    band: bandFor(overall),
    facets,
    basis: [...confidence.basis],
    extraction,
    explanation: explainExtraction(extraction),
    limitations: explainLimitations(layout, extraction),
    warnings: [...layout.warnings],
  };
}

/** 0.62 → "62%". Kept here so the panel and the receipt format identically. */
export function formatConfidence(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 100)}%`;
}
