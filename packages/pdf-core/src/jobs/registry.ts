/**
 * Job registry.
 *
 * The browser worker, the API and the Phase 3 BullMQ workers all resolve tools
 * through this map, so there is exactly one definition of what a tool does.
 */

import type { JobContext, JobDefinition, JobInputBase } from '../job.js';
import { inspectJob } from './inspect.job.js';
import { mergeJob } from './merge.job.js';
import { nUpJob } from './nUp.job.js';
import { organizeJob } from './organize.job.js';
import { pdfToImagesJob } from './pdfToImages.job.js';
import { splitByPagesJob } from './splitByPages.job.js';
import { splitHalfJob } from './splitHalf.job.js';
import { stampJob } from './stamp.job.js';
import { thumbnailsJob } from './thumbnails.job.js';

type AnyJob = JobDefinition<JobInputBase, unknown>;

export const JOBS = {
  [inspectJob.slug]: inspectJob as AnyJob,
  [mergeJob.slug]: mergeJob as AnyJob,
  [organizeJob.slug]: organizeJob as AnyJob,
  [pdfToImagesJob.slug]: pdfToImagesJob as AnyJob,
  [thumbnailsJob.slug]: thumbnailsJob as AnyJob,
  [splitByPagesJob.slug]: splitByPagesJob as AnyJob,
  [splitHalfJob.slug]: splitHalfJob as AnyJob,
  [stampJob.slug]: stampJob as AnyJob,
  [nUpJob.slug]: nUpJob as AnyJob,
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