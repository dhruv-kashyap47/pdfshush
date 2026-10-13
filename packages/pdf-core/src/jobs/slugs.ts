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
  'edit',
  'inspect',
  'merge',
  'n-up',
  'organize',
  'pdf-to-images',
  'redact',
  'split-by-pages',
  'split-in-half',
  'stamp',
  'text-runs',
  'thumbnails',
] as const;

export type JobSlugLiteral = (typeof JOB_SLUGS)[number];

const SLUGS: ReadonlySet<string> = new Set(JOB_SLUGS);

export function isKnownJobSlug(slug: string): boolean {
  return SLUGS.has(slug);
}
