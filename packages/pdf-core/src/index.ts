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
export { mirrorPages, planResize, resizePages } from './ops/transform.js';
export type { FlipAxis, ResizePlan, ResizeRequest } from './ops/transform.js';
export { watermarkDocument } from './ops/watermark.js';
export type {
  WatermarkMode,
  WatermarkPlacement,
  WatermarkSpec,
} from './ops/watermark.js';
export { removeAnnotations } from './ops/annotations.js';
export type { AnnotationRemovalResult } from './ops/annotations.js';
export { applyMetadataEdits } from './ops/metadata.js';
export type { MetadataEdits } from './ops/metadata.js';
export { extractImages } from './ops/images.js';
export type { ExtractedImage, ExtractionResult } from './ops/images.js';
export { toGrayscaleRgba } from './gray/gray.js';
export type { GrayscaleOptions, GrayscaleResult } from './gray/gray.js';
export { encodeFlatPng } from './img/png.js';
export { renderPageToCanvas } from './render/renderPage.js';
export type { RenderedCanvas } from './render/renderPage.js';

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
export { suggestBookmarks, BOOKMARK_SUGGESTION_LIMITS } from './render/suggestBookmarks.js';
export type {
  BookmarkSuggestion,
  BookmarkSuggestionMode,
  SuggestBookmarksOptions,
} from './render/suggestBookmarks.js';

// Jobs
export { JOBS, getJob, runJob } from './jobs/registry.js';
export type { JobSlug } from './jobs/registry.js';
export { JOB_SLUGS, isKnownJobSlug } from './jobs/slugs.js';
export type { JobSlugLiteral } from './jobs/slugs.js';export { inspectJob } from './jobs/inspect.job.js';
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
export { redactJob } from './jobs/redact.job.js';
export type { RedactJobInput, RedactJobOutput, RedactJobOptions } from './jobs/redact.job.js';
export { textEditJob } from './jobs/textEdit.job.js';
export type {
  TextEditJobInput,
  TextEditJobOutput,
  TextEditJobOptions,
  TextEditJobReport,
} from './jobs/textEdit.job.js';
export { flipJob } from './jobs/flip.job.js';
export type { FlipJobInput, FlipJobOutput, FlipJobOptions } from './jobs/flip.job.js';
export { watermarkJob } from './jobs/watermark.job.js';
export type { WatermarkJobInput, WatermarkJobOutput, WatermarkJobOptions } from './jobs/watermark.job.js';
export { metadataJob } from './jobs/metadata.job.js';
export type { MetadataJobInput, MetadataJobOutput, MetadataJobOptions } from './jobs/metadata.job.js';
export { annotationsJob } from './jobs/annotations.job.js';
export type { AnnotationsJobInput, AnnotationsJobOutput, AnnotationsJobOptions } from './jobs/annotations.job.js';
export { textJob } from './jobs/text.job.js';
export type { TextJobInput, TextJobOutput, TextJobOptions } from './jobs/text.job.js';
export { grayscaleJob } from './jobs/grayscale.job.js';
export type { GrayscaleJobInput, GrayscaleJobOutput, GrayscaleJobOptions } from './jobs/grayscale.job.js';
export { resizeJob } from './jobs/resize.job.js';
export type { ResizeJobInput, ResizeJobOutput, ResizeJobOptions } from './jobs/resize.job.js';
export { imagesJob } from './jobs/images.job.js';
export type {
  ImagesJobInput,
  ImagesJobOutput,
  ImagesJobFile,
} from './jobs/images.job.js';
export { splitBySizeJob } from './jobs/splitBySize.job.js';
export type {
  SplitBySizeInput,
  SplitBySizeOptions,
  SplitBySizeOutput,
} from './jobs/splitBySize.job.js';
export { flattenJob } from './jobs/flatten.job.js';
export type { FlattenJobInput, FlattenJobOutput, FlattenJobOptions } from './jobs/flatten.job.js';
export { batesJob } from './jobs/bates.job.js';
export type { BatesJobInput, BatesJobOutput, BatesJobOptions } from './jobs/bates.job.js';
export { compressJob } from './jobs/compress.job.js';
export type { CompressJobInput, CompressJobOutput, CompressJobOptions } from './jobs/compress.job.js';
export { jpgToPdfJob } from './jobs/jpgToPdf.job.js';
export type { JpgToPdfJobInput, JpgToPdfJobOutput, JpgToPdfJobOptions } from './jobs/jpgToPdf.job.js';
export { renameJob } from './jobs/rename.job.js';
export type { RenameJobInput, RenameJobOutput, RenameJobOptions } from './jobs/rename.job.js';
export { splitByTextJob } from './jobs/splitByText.job.js';
export type {
  SplitByTextInput,
  SplitByTextOutput,
  SplitByTextOptions,
} from './jobs/splitByText.job.js';
export { unlockJob } from './jobs/unlock.job.js';
export type { UnlockJobInput, UnlockJobOutput, UnlockJobOptions } from './jobs/unlock.job.js';
export { repairJob } from './jobs/repair.job.js';
export type { RepairJobInput, RepairJobOutput, RepairJobOptions } from './jobs/repair.job.js';
export { combineJob } from './jobs/combine.job.js';
export type { CombineJobInput, CombineJobOutput, CombineJobOptions } from './jobs/combine.job.js';
export { splitByBookmarksJob } from './jobs/splitByBookmarks.job.js';
export type {
  SplitByBookmarksInput,
  SplitByBookmarksOutput,
  SplitByBookmarksOptions,
  SplitByBookmarksPart,
} from './jobs/splitByBookmarks.job.js';
export { zipJob } from './jobs/zip.job.js';
export type { ZipJobInput, ZipJobOutput, ZipJobOptions } from './jobs/zip.job.js';
export { createFormsJob } from './jobs/createForms.job.js';
export type {
  CreateFormsJobInput,
  CreateFormsJobOutput,
  CreateFormsJobOptions,
} from './jobs/createForms.job.js';
export { createBookmarksJob } from './jobs/createBookmarks.job.js';
export type {
  CreateBookmarksJobInput,
  CreateBookmarksJobOutput,
  CreateBookmarksJobOptions,
} from './jobs/createBookmarks.job.js';
export { protectJob } from './jobs/protect.job.js';
export type { ProtectJobInput, ProtectJobOutput, ProtectJobOptions } from './jobs/protect.job.js';
export { batesNumberDocument, formatBatesNumber, BATES_LIMITS } from './ops/bates.js';
export type { BatesOptions, BatesResult } from './ops/bates.js';
export {
  detectImageKind,
  imagesToPdf,
  planImagePlacement,
  IMAGE_LIMITS,
} from './ops/imageDocs.js';
export type {
  ImageInput,
  ImageKind,
  ImageOrientation,
  ImagePageSize,
  ImagePlacement,
  ImagesToPdfOptions,
  ImagesToPdfResult,
} from './ops/imageDocs.js';
export {
  expandRenamePattern,
  sanitizeStem,
  RENAME_LIMITS,
  RENAME_TOKENS,
} from './ops/renamePattern.js';
export type { RenameContext } from './ops/renamePattern.js';
export { planSplitByText, SPLIT_BY_TEXT_LIMITS } from './ops/splitByText.js';
export type { PageSpan, SplitByTextPlan } from './ops/splitByText.js';
export { compressDocument, COMPRESS_DEFAULTS, COMPRESS_LIMITS } from './compress/compress.js';
export type { CompressMode, CompressOptions, CompressResult } from './compress/compress.js';
export { unlockDocument } from './ops/unlock.js';
export type { UnlockResult } from './ops/unlock.js';
export { protectDocument, validateProtectOptions, normalizePermissions } from './ops/protect.js';
export type { ProtectOptions, ProtectResult } from './ops/protect.js';
export { PROTECT_DEFAULT_PERMISSIONS, PROTECT_LIMITS } from './ops/protectConfig.js';
export type { ProtectPermissions } from './ops/protectConfig.js';
export { repairPdf } from './ops/repair.js';
export type { RepairOptions, RepairResult } from './ops/repair.js';
export { combineToPdf, isPdfBytes } from './ops/combine.js';
export type { CombineOptions, CombinePart, CombineResult, CombineSource } from './ops/combine.js';
export { extractOutline, splitLevel } from './render/outline.js';
export type { OutlineEntry, OutlineReadResult } from './render/outline.js';
export { addFormFields, FORM_FIELD_LIMITS } from './ops/formFields.js';
export type { NewFormField, NewFormFieldType } from './ops/formFields.js';
export { writeOutline, OUTLINE_WRITE_LIMITS } from './ops/outlineWrite.js';
export type { OutlineWriteEntry, OutlineWriteResult } from './ops/outlineWrite.js';

// In-place text editing (PDFium primary, pdf-lib overlay fallback)
export {
  applyNativeTextEdits,
  defaultPdfiumEnvironment,
  editPdfText,
} from './textedit/engine.js';
export type {
  NativeTextEditResult,
  PdfiumEnvironment,
  TextEditOptions,
  TextEditRunResult,
} from './textedit/engine.js';
export { PdfiumTextDocument } from './textedit/pdfium.js';
export type { PdfiumTextBounds, PdfiumTextObject } from './textedit/pdfium.js';
export {
  configurePdfiumRuntime,
  isPdfiumConfigured,
  loadPdfiumModule,
  resetPdfiumRuntime,
} from './textedit/runtime.js';
export type { PdfiumRuntimeConfig } from './textedit/runtime.js';
export { TextEditUnsafeError } from './textedit/types.js';
export type {
  TextEdit,
  TextEditBox,
  TextEditCheck,
  TextEditMode,
  TextEditOutcome,
  TextEditReport,
  TextEditResult,
  TextEditUnsafeReason,
  TextEditVerification,
} from './textedit/types.js';
export { verifyTextEdits } from './textedit/verify.js';
export type { TextEditExpectation, TextEditVerificationInput } from './textedit/verify.js';
export {
  encodeWithMap,
  glyphNameToUnicode,
  parseToUnicode,
  readFontCharcodes,
} from './textedit/charcodes.js';
export type { FontCharcodes, FontCharcodesByPage } from './textedit/charcodes.js';

// Redaction
export { redactPdf, defaultRedactEnvironment } from './redact/redact.js';
export type { RedactEnvironment } from './redact/redact.js';
export { createPdfjsRasterizer } from './redact/rasterize.js';
export type { Rasterizer, RasterizedPage } from './redact/rasterize.js';
export { verifyRedaction } from './redact/verify.js';
export type { VerifyOptions } from './redact/verify.js';
export { boxesIntersect, boxContains, boxArea, coverageOf } from './redact/geometry.js';
export type { Box } from './redact/geometry.js';
export { RedactionUnsafeError, RedactionVerificationError } from './redact/types.js';
export type {
  RedactOptions,
  RedactRegion,
  RedactResult,
  RedactionReport,
  PageReport,
  UnsafeReason,
  VerificationCheck,
  VerificationResult,
} from './redact/types.js';

// Workflows
export { validateWorkflow, WORKFLOW_OUTPUT_JOBS } from './workflow.js';
export type { Workflow, WorkflowInput, WorkflowStep } from './workflow.js';