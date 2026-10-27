/**
 * Job registry.
 *
 * The browser worker, the API and the Phase 3 BullMQ workers all resolve tools
 * through this map, so there is exactly one definition of what a tool does.
 */

import type { JobContext, JobDefinition, JobInputBase } from '../job.js';
import { annotationsJob } from './annotations.job.js';
import { batesJob } from './bates.job.js';
import { combineJob } from './combine.job.js';
import { compressJob } from './compress.job.js';
import { createBookmarksJob } from './createBookmarks.job.js';
import { createFormsJob } from './createForms.job.js';
import { editJob } from './edit.job.js';
import { flattenJob } from './flatten.job.js';
import { flipJob } from './flip.job.js';
import { grayscaleJob } from './grayscale.job.js';
import { imagesJob } from './images.job.js';
import { inspectJob } from './inspect.job.js';
import { jpgToPdfJob } from './jpgToPdf.job.js';
import { mergeJob } from './merge.job.js';
import { metadataJob } from './metadata.job.js';
import { nUpJob } from './nUp.job.js';
import { organizeJob } from './organize.job.js';
import { pdfToImagesJob } from './pdfToImages.job.js';
import { protectJob } from './protect.job.js';
import { redactJob } from './redact.job.js';
import { renameJob } from './rename.job.js';
import { repairJob } from './repair.job.js';
import { resizeJob } from './resize.job.js';
import { splitByBookmarksJob } from './splitByBookmarks.job.js';
import { splitByPagesJob } from './splitByPages.job.js';
import { splitBySizeJob } from './splitBySize.job.js';
import { splitByTextJob } from './splitByText.job.js';
import { splitHalfJob } from './splitHalf.job.js';
import { stampJob } from './stamp.job.js';
import { textEditJob } from './textEdit.job.js';
import { textJob } from './text.job.js';
import { textRunsJob } from './textRuns.job.js';
import { thumbnailsJob } from './thumbnails.job.js';
import { unlockJob } from './unlock.job.js';
import { watermarkJob } from './watermark.job.js';
import { zipJob } from './zip.job.js';

type AnyJob = JobDefinition<JobInputBase, unknown>;

export const JOBS = {
  [editJob.slug]: editJob as AnyJob,
  [inspectJob.slug]: inspectJob as AnyJob,
  [mergeJob.slug]: mergeJob as AnyJob,
  [organizeJob.slug]: organizeJob as AnyJob,
  [pdfToImagesJob.slug]: pdfToImagesJob as AnyJob,
  [redactJob.slug]: redactJob as AnyJob,
  [thumbnailsJob.slug]: thumbnailsJob as AnyJob,
  [splitByPagesJob.slug]: splitByPagesJob as AnyJob,
  [splitHalfJob.slug]: splitHalfJob as AnyJob,
  [stampJob.slug]: stampJob as AnyJob,
  [textEditJob.slug]: textEditJob as AnyJob,
  [nUpJob.slug]: nUpJob as AnyJob,
  [textRunsJob.slug]: textRunsJob as AnyJob,
  [flipJob.slug]: flipJob as AnyJob,
  [watermarkJob.slug]: watermarkJob as AnyJob,
  [metadataJob.slug]: metadataJob as AnyJob,
  [annotationsJob.slug]: annotationsJob as AnyJob,
  [textJob.slug]: textJob as AnyJob,
  [grayscaleJob.slug]: grayscaleJob as AnyJob,
  [resizeJob.slug]: resizeJob as AnyJob,
  [imagesJob.slug]: imagesJob as AnyJob,
  [splitBySizeJob.slug]: splitBySizeJob as AnyJob,
  [flattenJob.slug]: flattenJob as AnyJob,
  [batesJob.slug]: batesJob as AnyJob,
  [compressJob.slug]: compressJob as AnyJob,
  [jpgToPdfJob.slug]: jpgToPdfJob as AnyJob,
  [renameJob.slug]: renameJob as AnyJob,
  [splitByTextJob.slug]: splitByTextJob as AnyJob,
  [unlockJob.slug]: unlockJob as AnyJob,
  // Bookmark batch (2026-10-25). All client-side; `zip` is the batch helper.
  [repairJob.slug]: repairJob as AnyJob,
  [combineJob.slug]: combineJob as AnyJob,
  [splitByBookmarksJob.slug]: splitByBookmarksJob as AnyJob,
  [zipJob.slug]: zipJob as AnyJob,
  // Authoring batch (2026-10-26): build form fields and an outline.
  [createFormsJob.slug]: createFormsJob as AnyJob,
  [createBookmarksJob.slug]: createBookmarksJob as AnyJob,
  // Security batch (2026-10-27): real AES-256 encryption, browser-only.
  [protectJob.slug]: protectJob as AnyJob,
} satisfies Record<string, AnyJob>;

export type JobSlug = keyof typeof JOBS;

export function getJob(slug: string): AnyJob {
  const job = JOBS[slug as JobSlug];
  if (!job) throw new Error(`Unknown job "${slug}"`);
  return job;
}

/** Runs a job with the given context. The pool owns timeout enforcement. */
export async function runJob(slug: string, input: JobInputBase, ctx: JobContext): Promise<unknown> {
  return getJob(slug).run(input, ctx);
}
