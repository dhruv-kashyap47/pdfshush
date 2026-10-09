/**
 * `@pdfshush/pdf-core` -- the single PDF engine used by the browser worker, the
 * API and the server workers. Nothing in here touches the DOM directly, so the
 * same code path runs in a Web Worker and in Node.
 */

// Contracts
export {
  withJobLimits,
  createProgressReporter,
  JobAbortedError,
  JobTimeoutError,
  JobValidationError,
  isAbortError,
  serializeJobError,
} from './job.js';
export type {
  JobContext,
  JobCost,
  JobDefinition,
  JobEnvironment,
  JobInputBase,
  JobInputFile,
  JobProgress,
  SerializedJobError,
  ValidationIssue,
  ValidationResult,
} from './job.js';

// Limits
export {
  LIMITS,
  MB,
  estimateWorkingSetBytes,
  formatBytes,
  timeoutForPageCount,
} from './limits.js';

// Operations
export {
  inspectPdf,
  probePageCount,
  loadPdfDocument,
  EncryptedDocumentError,
} from './ops/pages.js';
export type { PdfInfo, PageInfo, LoadOptions } from './ops/pages.js';
export { mergePdfs, mergeIfNeeded } from './ops/merge.js';
export type { MergeResult } from './ops/merge.js';
export { composePageRefs, composeDocument, refsForSpan, identityRefs } from './ops/compose.js';
export type {
  PageRef,
  SourceDocument,
  ComposeOptions,
  ComposeResult,
  CropRect,
} from './ops/compose.js';
export { parsePageRanges } from './ops/ranges.js';
export { createZip, dedupeNames, pageFileName, stripExtension } from './ops/zip.js';
export {
  pageGeom,
  geomFromBoxes,
  displaySize,
  viewToPdf,
  pdfToView,
  viewRectToPdf,
  pdfRectToView,
} from './ops/geometry.js';
export type { PageGeom, DisplayRect } from './ops/geometry.js';
export {
  applyEdits,
  imagePixelSize,
  validateEditObjects,
  validateExport,
  wrapTextToWidth,
  parseHexColor,
} from './ops/edit.js';
// Dependency-free so the editor can style its textarea without pulling pdf-lib
// into the main browser bundle.
export { TEXT_ASCENT, TEXT_LINE_HEIGHT } from './ops/textMetrics.js';
export type {
  EditorObject,
  EditObjectBase,
  EditTextObject,
  EditImageObject,
  EditRectObject,
  EditLineObject,
  EditMarkObject,
} from './ops/edit.js';
export { extractFormWidgets, applyFormValues } from './ops/forms.js';
export type { FormWidgetInfo, FormFieldType } from './ops/forms.js';
export { stampDocument, renderStampTemplate } from './ops/stamp.js';
export type {
  StampContent,
  StampPosition,
  StampRegion,
  StampStyle,
} from './ops/stamp.js';
export { splitPagesInHalf } from './ops/split.js';
export type { SplitHalfResult, SplitOrientation } from './ops/split.js';
export { imposePages } from './ops/nup.js';
export type { NupCount, NupOptions, NupResult, NupSheet } from './ops/nup.js';

// Rendering
export { configurePdfjsRuntime, loadPdfForRender } from './render/pdfjsRuntime.js';
export type { PdfjsRuntimeConfig, LoadedPdf } from './render/pdfjsRuntime.js';
export {
  defaultCanvasFactory,
  hasOffscreenCanvas,
  PdfjsCanvasFactory,
  rasterWidthWithinBudget,
  scaleForWidth,
} from './render/canvas.js';
export type { CanvasFactory, PdfjsCanvasEntry, RenderCanvas } from './render/canvas.js';
export { renderPageToImage, renderPages, renderThumbnails } from './render/renderPage.js';
export type { ImageFormat, RenderedImage, RenderPageOptions } from './render/renderPage.js';
export { extractTextRuns, clusterTextRuns } from './render/textRuns.js';
export type { TextRun, RunItem } from './render/textRuns.js';

// Jobs
export { JOBS, getJob, runJob } from './jobs/registry.js';
export type { JobSlug } from './jobs/registry.js';
export { inspectJob } from './jobs/inspect.job.js';
export type { InspectInput, InspectOutput } from './jobs/inspect.job.js';
export { mergeJob } from './jobs/merge.job.js';
export type { MergeJobInput, MergeJobOutput } from './jobs/merge.job.js';
export { organizeJob } from './jobs/organize.job.js';
export type { OrganizeJobInput, OrganizeJobOutput } from './jobs/organize.job.js';
export { pdfToImagesJob } from './jobs/pdfToImages.job.js';
export type {
  PdfToImagesInput,
  PdfToImagesOutput,
  PdfToImagesOptions,
} from './jobs/pdfToImages.job.js';
export { thumbnailsJob } from './jobs/thumbnails.job.js';
export type { ThumbnailsInput, ThumbnailsOutput } from './jobs/thumbnails.job.js';
export { splitByPagesJob } from './jobs/splitByPages.job.js';
export type {
  SplitByPagesInput,
  SplitByPagesOutput,
  SplitByPagesOptions,
} from './jobs/splitByPages.job.js';
export { splitHalfJob } from './jobs/splitHalf.job.js';
export type {
  SplitHalfInput,
  SplitHalfOutput,
  SplitHalfOptions,
} from './jobs/splitHalf.job.js';
export { stampJob } from './jobs/stamp.job.js';
export type { StampJobInput, StampJobOutput, StampJobOptions } from './jobs/stamp.job.js';
export { nUpJob } from './jobs/nUp.job.js';
export type { NUpJobInput, NUpJobOutput, NUpJobOptions } from './jobs/nUp.job.js';
export { editJob } from './jobs/edit.job.js';
export type { EditJobInput, EditJobOutput, EditJobOptions } from './jobs/edit.job.js';
export { textRunsJob } from './jobs/textRuns.job.js';
export type { TextRunsInput, TextRunsOutput, TextRunsOptions } from './jobs/textRuns.job.js';