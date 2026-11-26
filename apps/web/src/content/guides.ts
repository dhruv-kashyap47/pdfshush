/**
 * The guide catalogue, as the SPA sees it.
 *
 * `import.meta.glob` with `eager` is deliberate: the guides index needs the
 * frontmatter of every article, and the article route needs its body. Both live
 * in a lazy route chunk, so the home page never pays for any of it. Drafts are
 * visible in development (so a writer can preview) and absent from a production
 * build.
 */

import { byNewest, guidePath, parseGuide, type Guide } from './guide-format';
import sources from 'virtual:guides';

const parsed: Guide[] = Object.entries(sources)
  .map(([file, source]) => parseGuide(source, file))
  .sort(byNewest);

/** Everything on disk, drafts included. Development only. */
export const ALL_GUIDES = parsed;

/** What a production build is allowed to serve, list or sitemap. */
export const PUBLISHED_GUIDES = parsed.filter((guide) => !guide.frontmatter.draft);

/** The list the pages render. A draft is previewable in dev, invisible in prod. */
export const GUIDES = import.meta.env.DEV ? ALL_GUIDES : PUBLISHED_GUIDES;

export { guidePath };
export type { Guide };

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.frontmatter.slug === slug);
}

/** Guides that name this tool in `relatedTools`, newest first. */
export function guidesForTool(toolSlug: string): Guide[] {
  return GUIDES.filter((guide) => guide.frontmatter.relatedTools.includes(toolSlug));
}

export interface GuideCategory {
  name: string;
  guides: Guide[];
}

/** Categories in first-seen order, each newest-first. */
export function guideCategories(): GuideCategory[] {
  const map = new Map<string, Guide[]>();
  for (const guide of GUIDES) {
    const list = map.get(guide.frontmatter.category) ?? [];
    list.push(guide);
    map.set(guide.frontmatter.category, list);
  }
  return [...map.entries()].map(([name, guides]) => ({ name, guides }));
}
