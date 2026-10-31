/**
 * Structured document layer: serializable page trees, centralized geometry,
 * extraction, hit testing and editing state.
 *
 * Import from here (or from `@pdfshush/pdf-core`) rather than reaching into
 * individual modules; the split between model and editing state is part of the
 * contract.
 */

export type {
  BBox,
  Point,
  Quad,
  TextDirection,
  FontFamily,
  TextTypography,
  BlockKind,
  ParagraphRole,
  TextAlignment,
  RegionKind,
  ListInfo,
  Glyph,
  Word,
  Line,
  ParagraphLineSpan,
  Paragraph,
  BlockStyle,
  TextBlock,
  Region,
  TableCell,
  TableRow,
  TableModel,
  ColumnModel,
  PageStats,
  PageLayout,
  DocumentStats,
  DocumentLayout,
  ParagraphTextEdit,
} from './types.js';

export {
  PageGeometry,
  normalizeAngle,
  normalizeRotation,
  applyMatrix,
  multiplyMatrices,
  matrixRotation,
  normalizeBBox,
  bboxFromPoints,
  quadFromPoints,
  bboxFromQuad,
  unionBBoxes,
  expandBBox,
  bboxArea,
  bboxCenter,
  bboxContainsPoint,
  bboxIntersects,
  intersectBBox,
  bboxDistance,
  pointInQuad,
  projectPoint,
  directionOfRotation,
  clamp,
  SpatialGrid,
} from './geometry.js';
export type {
  Matrix,
  PageBoxes,
  ViewTransform,
  ElementRect,
  SpatialItem,
} from './geometry.js';

export { hashString, quantize, createIdFactory, textSeed } from './ids.js';
export type { IdFactory } from './ids.js';

export {
  charAdvanceWeight,
  normalizeFontFamily,
  typographyFromStyle,
  glyphsFromTextItems,
} from './glyphs.js';
export type {
  RawTextStyle,
  RawTextItem,
  RawTextContent,
  GlyphExtractionOptions,
  ExtractedGlyphs,
} from './glyphs.js';

export {
  buildPageLayout,
  buildOrientationGroups,
  matchListMarker,
  joinWordTexts,
  needsSpace,
  isCjk,
  median,
} from './group.js';
export type {
  LayoutBuildOptions,
  PageLayoutInput,
  LineEntry,
  OrientationGroup,
  OrientationBuildResult,
} from './group.js';

export {
  buildDocumentLayout,
  findRepeatedFurniture,
  normalizeFurnitureText,
} from './document.js';

export {
  PageInteractionModel,
  createInteractionModel,
} from './hitTest.js';
export type {
  LineWordSegment,
  CaretPosition,
  TextSelection,
  MultiParagraphSelection,
  SelectionAnchor,
  HitTargets,
} from './hitTest.js';

export {
  TextEditSession,
  previousCodePointIndex,
  nextCodePointIndex,
  wordRangeAt,
} from './editing.js';
export type {
  EditSelection,
  EditSnapshot,
  TextEditSessionOptions,
} from './editing.js';
