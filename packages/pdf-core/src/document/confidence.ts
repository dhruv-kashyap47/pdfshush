/**
 * Structure confidence: how much the inferred structure can be trusted.
 *
 * Confidence used to be a near-constant carried down from the glyph estimator,
 * which meant it could not separate a clean page from a doubtful one. These
 * numbers are computed from evidence the engine actually collected -- paragraph
 * merge margins, column agreement, typography agreement, table cell alignment,
 * obstacle coverage -- and `basis` names the drivers so a low score is
 * explainable rather than mysterious.
 *
 * Kept separate from `EditCapability`: "we understood this page" and "this
 * specific edit is safe" are different questions and must not share a number.
 */

import { analyzePageRelations } from './relations.js';
import type { PageLayout, StructureConfidence } from './types.js';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function computeStructureConfidence(layout: PageLayout): StructureConfidence {
  const basis: string[] = [];
  const relations = analyzePageRelations(layout);
  const paragraphs = layout.paragraphs;
  const lines = layout.lines;

  const lineCoverage =
    lines.length === 0
      ? 1
      : paragraphs.reduce((sum, paragraph) => sum + paragraph.lineIds.length, 0) / lines.length;
  const meanConfidence = paragraphs.length > 0 ? average(paragraphs.map((p) => p.confidence)) : 1;
  const ambiguousShare =
    paragraphs.length > 0 ? paragraphs.filter((paragraph) => paragraph.ambiguous).length / paragraphs.length : 0;

  if (ambiguousShare > 0) {
    basis.push(`${percent(ambiguousShare)} of paragraphs sit on an ambiguous merge boundary`);
  }
  if (lineCoverage < 0.999) {
    basis.push(`${percent(1 - lineCoverage)} of lines are not inside any paragraph`);
  }

  const grouping = clamp01(0.55 * meanConfidence + 0.25 * lineCoverage + 0.2 * (1 - ambiguousShare));
  const paragraphBoundaries = clamp01(0.85 * meanConfidence + 0.15 * (1 - ambiguousShare));

  const columnConfidence =
    layout.columns.length > 1 ? average(layout.columns.map((column) => column.confidence)) : 0.95;
  const readingOrder = clamp01(0.7 * columnConfidence + 0.3 * relations.columnAgreement);
  if (relations.multiColumn) {
    basis.push(
      `${layout.columns.length} columns detected; ${percent(relations.columnAgreement)} of line joins stay in one column`,
    );
  }
  if (layout.warnings.some((warning) => warning.startsWith('Form-like page'))) {
    basis.push('Form-like page: column inference was refused so field labels stay whole');
  }

  const knownFamily = lines.filter((line) => line.typography.fontFamily !== 'other').length;
  const familyShare = lines.length > 0 ? knownFamily / lines.length : 1;
  // Identification is about the font resource, not about whether neighbouring
  // lines happen to be set the same. The old formula blended in
  // `typographyAgreement`, so a page of form fields in many sizes scored as if
  // its fonts were unrecognised. A synthetic model has no font resource name,
  // so it is judged on the family alone.
  const namedShare =
    lines.length === 0
      ? 1
      : lines.filter((line) => line.typography.fontName.length > 0).length / lines.length;
  const fontIdentification =
    namedShare > 0 ? clamp01(0.6 * familyShare + 0.4 * namedShare) : clamp01(familyShare);
  if (familyShare < 0.8) {
    basis.push(
      `${percent(1 - familyShare)} of lines use a font family that is not recognised by name`,
    );
  }

  const tableDetection =
    layout.tables.length > 0 ? average(layout.tables.map((table) => table.confidence)) : 0.9;
  if (layout.tables.length > 0) {
    const cells = layout.tables.reduce(
      (sum, table) => sum + table.rows.reduce((inner, row) => inner + row.cells.length, 0),
      0,
    );
    basis.push(`${layout.tables.length} table(s), ${cells} cells, grid confidence ${percent(tableDetection)}`);
  }

  const specificRoles = paragraphs.filter((paragraph) => paragraph.role !== 'unknown').length;
  const roleShare = paragraphs.length > 0 ? specificRoles / paragraphs.length : 1;
  const regionClassification = clamp01(0.6 * roleShare + 0.4 * meanConfidence);

  const layoutRelationships = clamp01(
    0.4 * relations.typographyAgreement +
      0.35 * relations.alignmentAgreement +
      0.25 * relations.columnAgreement,
  );
  if (relations.alignmentAgreement < 0.7 && relations.pairs.length > 0) {
    basis.push(
      `only ${percent(relations.alignmentAgreement)} of adjacent lines share an edge`,
    );
  }

  const reflowSafety = clamp01(
    0.7 * (1 - relations.obstacleCoverage) + 0.3 * (1 - ambiguousShare),
  );
  const imageCount = layout.images?.length ?? 0;
  if (imageCount > 0 || layout.tables.length > 0) {
    basis.push(
      `${imageCount} image(s) and ${layout.tables.length} table(s) cover ${percent(
        relations.obstacleCoverage,
      )} of the page`,
    );
  }

  return {
    grouping,
    paragraphBoundaries,
    readingOrder,
    fontIdentification,
    tableDetection,
    regionClassification,
    layoutRelationships,
    reflowSafety,
    basis,
  };
}
