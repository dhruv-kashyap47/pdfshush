/**
 * Registered job slugs, without the jobs themselves.
 *
 * The registry is the source of truth for what a slug *does*, but importing it
 * pulls in every job implementation and therefore pdf-lib. Anything that runs on
 * the main thread — the workflow builder validating a recipe as the user edits
 * it — would then drag pdf-lib into the main chunk, which is the invariant in
 * PLAN.md §3 ("the main bundle contains neither pdf.js nor pdf-lib").
 *
 * So this module answers "is this slug real?" and nothing else, and a unit test
 * pins it to `Object.keys(JOBS)` so it cannot drift out of step.
 *
 * Same reason `ops/ranges.ts` and `ops/textMetrics.ts` exist.
 */

export const JOB_SLUGS = [
  'bates-numbering',
  'compress',
  'edit',
  'extract-images',
  'flatten',
  'flip',
  'grayscale',
  'inspect',
  'jpg-to-pdf',
  'merge',
  'n-up',
  'organize',
  'pdf-to-images',
  'pdf-to-text',
  'redact',
  'remove-annotations',
  'rename',
  'resize',
  'split-by-pages',
  'split-by-size',
  'split-by-text',
  'split-in-half',
  'stamp',
  'text-edit',
  'text-runs',
  'thumbnails',
  'unlock',
  'watermark',
  'edit-metadata',
  // Bookmark batch (2026-10-25).
  'repair',
  'combine',
  'split-by-bookmarks',
  'zip',
] as const;

export type JobSlugLiteral = (typeof JOB_SLUGS)[number];

const SLUGS: ReadonlySet<string> = new Set(JOB_SLUGS);

export function isKnownJobSlug(slug: string): boolean {
  return SLUGS.has(slug);
}
