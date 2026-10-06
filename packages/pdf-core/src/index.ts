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
} from './job.js';
export type {
  JobContext,
  JobCost,
  JobDefinition,
  JobEnvironment,
  JobInputBase,
  JobInputFile,
  JobProgress,
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
export { composePageRefs, refsForSpan } from './ops/compose.js';
export type { PageRef, SourceDocument, ComposeOptions, ComposeResult } from './ops/compose.js';
export { parsePageRanges } from './ops/ranges.js';
export { createZip, dedupeNames, pageFileName, stripExtension } from './ops/zip.js';

// Rendering
export { configurePdfjsRuntime, loadPdfForRender } from './render/pdfjsRuntime.js';
export type { PdfjsRuntimeConfig, LoadedPdf } from './render/pdfjsRuntime.js';
export { defaultCanvasFactory, scaleForWidth } from './render/canvas.js';
export type { CanvasFactory, RenderCanvas } from './render/canvas.js';
export { renderPageToImage, renderPages, renderThumbnails } from './render/renderPage.js';
export type { ImageFormat, RenderedImage, RenderPageOptions } from './render/renderPage.js';

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