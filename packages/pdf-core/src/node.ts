/**
 * Node entry point for `pdf-core`.
 *
 * The default barrel also exposes the render layer, which is browser-only
 * (`OffscreenCanvas`, `HTMLCanvasElement`). A server importing it would have to
 * pretend it has a DOM just to satisfy the type checker, and would ship
 * rendering code it can never run. This entry exposes what is genuinely
 * isomorphic -- the job contract, limits, page/transform ops, forms -- plus the
 * jobs that need nothing but pdf-lib.
 *
 * Deliberately excluded (browser-only): the render layer with its
 * `thumbnails` / `pdf-to-images` jobs, and `text-runs`, which needs pdf.js
 * worker configuration the server has not set up.
 *
 * The server *bundles* this module (the package export points at TypeScript
 * source, which only a bundler can consume), so nothing here may reach for the
 * DOM.
 */

export { LIMITS, MB, estimateWorkingSetBytes, formatBytes, timeoutForPageCount } from './limits.js';

export {
  JobAbortedError,
  JobTimeoutError,
  JobValidationError,
  createProgressReporter,
  isAbortError,
  withJobLimits,
  type JobContext,
  type JobCost,
  type JobDefinition,
  type JobEnvironment,
  type JobInputBase,
  type JobInputFile,
  type JobProgress,
  type ValidationIssue,
  type ValidationResult,
} from './job.js';

// Geometry + the editor write path.
export {
  applyEdits,
  imagePixelSize,
  parseHexColor,
  validateEditObjects,
  validateExport,
  wrapTextToWidth,
  TEXT_ASCENT,
  TEXT_LINE_HEIGHT,
  type EditorObject,
  type EditImageObject,
  type EditLineObject,
  type EditMarkObject,
  type EditObjectBase,
  type EditRectObject,
  type EditTextObject,
} from './ops/edit.js';
export {
  displaySize,
  geomFromBoxes,
  pageGeom,
  pdfRectToView,
  pdfToView,
  viewRectToPdf,
  viewToPdf,
  type DisplayRect,
  type PageGeom,
} from './ops/geometry.js';
export { applyFormValues, extractFormWidgets, type FormFieldType, type FormWidgetInfo } from './ops/forms.js';
export { inspectPdf, loadPdfDocument, type PageInfo, type PdfInfo } from './ops/pages.js';

// Node-safe jobs, imported directly rather than through the registry so the
// renderer-dependent jobs never enter this module graph.
import { inspectJob } from './jobs/inspect.job.js';
import { mergeJob } from './jobs/merge.job.js';
import { organizeJob } from './jobs/organize.job.js';
import { stampJob } from './jobs/stamp.job.js';
import { splitByPagesJob } from './jobs/splitByPages.job.js';
import { splitHalfJob } from './jobs/splitHalf.job.js';
import { nUpJob } from './jobs/nUp.job.js';
import { editJob } from './jobs/edit.job.js';
import type { JobDefinition } from './job.js';

/** Every job that can run in Node, keyed by slug. */
export const NODE_JOBS: Record<string, JobDefinition> = {
  [inspectJob.slug]: inspectJob,
  [mergeJob.slug]: mergeJob,
  [organizeJob.slug]: organizeJob,
  [stampJob.slug]: stampJob,
  [splitByPagesJob.slug]: splitByPagesJob,
  [splitHalfJob.slug]: splitHalfJob,
  [nUpJob.slug]: nUpJob,
  [editJob.slug]: editJob,
};

export function getNodeJob(slug: string): JobDefinition | undefined {
  return NODE_JOBS[slug];
}

export type { InspectOutput } from './jobs/inspect.job.js';
export type { EditJobInput, EditJobOptions, EditJobOutput } from './jobs/edit.job.js';