/**
 * The guide catalogue, as the prerenderer sees it.
 *
 * Node has no `import.meta.glob`, so this reads the same directory from disk and
 * runs the same parser. Only published guides are returned: a draft is never
 * prerendered and never reaches the sitemap.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { byNewest, parseGuide, type Guide } from '../src/content/guide-format.ts';

export function loadGuides(rootDir: string, options: { includeDrafts?: boolean } = {}): Guide[] {
  const directory = path.join(rootDir, 'src', 'content', 'guides');
  let files: string[];
  try {
    files = readdirSync(directory).filter((file) => file.endsWith('.md'));
  } catch {
    return [];
  }

  const guides = files
    .map((file) => parseGuide(readFileSync(path.join(directory, file), 'utf8'), file))
    .sort(byNewest);

  return options.includeDrafts ? guides : guides.filter((guide) => !guide.frontmatter.draft);
}
