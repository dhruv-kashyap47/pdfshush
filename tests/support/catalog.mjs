/**
 * Reads the tool catalog straight out of the web app's registry.
 *
 * The benchmark and sweep harnesses need the same list the product ships, and
 * importing a `.ts` module from a plain Node script would require a loader. The
 * registry is deliberately regular (one `tool(...)` call per line plus a `LIVE`
 * set), so parsing it here keeps the harness honest: add a tool to the product
 * and it appears in the baseline without a second list to forget.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = path.join(ROOT, 'apps/web/src/tools/registry.ts');

/** Categories in registry order, with their tools. */
export function parseRegistry(source) {
  const liveBlock = source.slice(source.indexOf('const LIVE'), source.indexOf('const TOOL_NEXT'));
  const live = new Set([...liveBlock.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]));

  const categories = [];
  const tools = [];
  const categoryPattern = /id:\s*'([^']+)',[^\[]*?label:\s*'([^']+)',[^\[]*?tools:\s*\[([\s\S]*?)\n\s{4}\],/g;

  for (const match of source.matchAll(categoryPattern)) {
    const [, id, label, body] = match;
    const entries = [];
    for (const toolMatch of body.matchAll(
      /tool\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*([A-Za-z0-9_]+),\s*'([a-z]+)'\)/g,
    )) {
      const [, slug, name, description, category, icon, accent] = toolMatch;
      const entry = {
        slug,
        name,
        description,
        category,
        icon,
        accent,
        status: live.has(slug) ? 'live' : 'declined',
      };
      entries.push(entry);
      tools.push(entry);
    }
    categories.push({ id, label, tools: entries });
  }

  return { categories, tools, live: tools.filter((tool) => tool.status === 'live') };
}

export async function readCatalog() {
  return parseRegistry(await readFile(REGISTRY, 'utf8'));
}

/** Categories whose tools are useful to group for a per-class measurement. */
export const TOOL_CLASS = {
  'merge-pdf': 'merge',
  'organize-pdf': 'organize',
  'delete-pages': 'page-ops',
  'extract-pages': 'page-ops',
  'rotate-pdf': 'page-ops',
  'split-by-pages': 'split',
  'split-in-half': 'split',
  'split-by-size': 'split',
  'split-by-text': 'split',
  'split-by-bookmarks': 'split',
  'alternate-mix': 'merge',
  'page-numbers': 'stamp',
  'header-footer': 'stamp',
  stamp: 'stamp',
  'bates-numbering': 'stamp',
  watermark: 'stamp',
  'crop-pdf': 'geometry',
  'n-up': 'geometry',
  'resize-pdf': 'geometry',
  'flip-pdf': 'geometry',
  'edit-pdf': 'editor',
  'fill-sign': 'editor',
  signature: 'editor',
  'create-forms': 'authoring',
  'create-bookmarks': 'authoring',
  'redact-pdf': 'security',
  'protect-pdf': 'security',
  'unlock-pdf': 'security',
  'remove-annotations': 'security',
  'flatten-pdf': 'security',
  'compress-pdf': 'compress',
  'repair-pdf': 'compress',
  'grayscale-pdf': 'raster',
  'dark-mode-pdf': 'raster',
  'extract-images': 'raster',
  'pdf-to-jpg': 'raster',
  'image-editor': 'raster',
  'pdf-to-text': 'extract',
  'edit-metadata': 'metadata',
  'rename-pdf': 'metadata',
  'jpg-to-pdf': 'ingest',
  'combine-pdf': 'ingest',
  'batch-run': 'orchestration',
  workflows: 'orchestration',
  'summarize-pdf': 'ai',
  'chat-with-pdf': 'ai',
  'edit-pdf-with-ai': 'ai',
  api: 'docs',
  mcp: 'docs',
};

export function classOf(slug) {
  return TOOL_CLASS[slug] ?? 'plain';
}

