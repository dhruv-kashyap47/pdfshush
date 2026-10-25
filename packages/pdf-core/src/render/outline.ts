/**
 * Document outline (bookmark) reading.
 *
 * Split by bookmarks needs to know *where* each section starts, and a PDF's
 * outline is a linked tree of destinations -- not a list of page numbers. pdf.js
 * already knows how to walk it and how to resolve a named destination through
 * the document's `/Dests` name tree, so this reuses `loadPdfForRender` instead of
 * re-implementing the two destination syntaxes (`[pageRef /XYZ ...]` and
 * `/A << /D ... >>`) on top of pdf-lib.
 *
 * Every node is flattened into document order with its nesting level. Nodes
 * without a resolvable internal page (external URLs, broken destinations) are
 * skipped: a chapter that cannot be located must not silently become page 1.
 */

import type { JobContext } from '../job.js';
import { LIMITS } from '../limits.js';
import { loadPdfForRender } from './pdfjsRuntime.js';

export interface OutlineEntry {
  title: string;
  /** Zero-based page index. */
  pageIndex: number;
  /** 0 for a top-level bookmark, 1 for its children, and so on. */
  level: number;
}

export interface OutlineReadResult {
  entries: OutlineEntry[];
  /** True when the outline tree had nodes but none pointed at a page. */
  hadUnresolvableNodes: boolean;
  /** Total nodes visited, before deduplication of repeated destinations. */
  visited: number;
}

interface OutlineNodeLike {
  title?: unknown;
  dest?: unknown;
  items?: unknown;
}

function titleOf(node: OutlineNodeLike): string {
  const raw = typeof node.title === 'string' ? node.title : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 160);
}

export async function extractOutline(
  data: Uint8Array,
  ctx: JobContext,
  password?: string,
): Promise<OutlineReadResult> {
  const loaded = await loadPdfForRender(data, password !== undefined ? { password } : {});
  const entries: OutlineEntry[] = [];
  let hadUnresolvableNodes = false;
  let visited = 0;

  try {
    const outline = (await loaded.doc.getOutline()) as OutlineNodeLike[] | null;
    if (!outline || outline.length === 0) {
      return { entries: [], hadUnresolvableNodes: false, visited: 0 };
    }

    const resolvePageIndex = async (dest: unknown): Promise<number | undefined> => {
      let resolved = dest;
      if (typeof resolved === 'string') {
        resolved = await loaded.doc.getDestination(resolved);
      }
      if (!Array.isArray(resolved) || resolved.length === 0) return undefined;
      const target = resolved[0];
      if (typeof target === 'number') {
        return Number.isInteger(target) && target >= 0 ? target : undefined;
      }
      if (target && typeof target === 'object') {
        try {
          const index = await loaded.doc.getPageIndex(
            target as Parameters<typeof loaded.doc.getPageIndex>[0],
          );
          return Number.isInteger(index) && index >= 0 ? index : undefined;
        } catch {
          return undefined;
        }
      }
      return undefined;
    };

    const walk = async (nodes: OutlineNodeLike[], level: number): Promise<void> => {
      for (const node of nodes) {
        ctx.throwIfAborted();
        if (visited >= LIMITS.tool.maxOutlineEntries) {
          throw new Error(
            `This outline has more than ${LIMITS.tool.maxOutlineEntries} entries; ` +
              'use Split by pages instead.',
          );
        }
        visited += 1;
        const title = titleOf(node);
        const pageIndex = await resolvePageIndex(node.dest);
        if (pageIndex === undefined) {
          hadUnresolvableNodes = true;
        } else if (title) {
          // No page deduplication here: a "Contents" node and its first
          // section commonly share page 1, and dropping the section at read
          // time would silently shorten the split. The splitting job dedupes
          // within the level it actually cuts on.
          entries.push({ title, pageIndex, level });
        }

        const children = Array.isArray(node.items) ? (node.items as OutlineNodeLike[]) : [];
        if (children.length > 0) await walk(children, level + 1);
      }
    };

    await walk(outline, 0);
    entries.sort((a, b) => a.pageIndex - b.pageIndex);
    return { entries, hadUnresolvableNodes, visited };
  } finally {
    await loaded.destroy();
  }
}

/**
 * The entries a split should use: the shallowest level that actually carries
 * sections.
 *
 * A single top-level "Contents" node with every real section one level below it
 * is common; splitting on that root would produce one part. So while the chosen
 * level holds exactly one entry and a deeper level exists, descend. A flat
 * outline (many entries at level 0) is untouched, and a document with a single
 * real chapter stays a single part.
 */
export function splitLevel(entries: OutlineEntry[]): number {
  if (entries.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const entry of entries) counts.set(entry.level, (counts.get(entry.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  let chosen = levels[0] ?? 0;
  while ((counts.get(chosen) ?? 0) === 1) {
    const deeper = levels.find((level) => level > chosen);
    if (deeper === undefined) break;
    chosen = deeper;
  }
  return chosen;
}
