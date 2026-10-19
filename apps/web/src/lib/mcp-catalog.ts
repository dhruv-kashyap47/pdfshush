/**
 * The deployed MCP + v1 surface, read from the public OpenAPI document
 * (PLAN.md §25.3: the docs must only promise what this deployment actually
 * runs). One reader for two pages: the landing MCP dialog and `/tools/mcp`.
 *
 * The document is public by design (no key material in it), so the honest
 * failure states are explicit: `loading`, `ready`, `failed`. Callers decide
 * what to show when the deployment cannot be reached, and the tool list never
 * gets invented client side.
 */

import { useCallback, useEffect, useState } from 'react';

const SPEC_URL = '/api/v1/openapi.json';

export interface McpCatalogLimits {
  tasksPerMinute?: number;
  tasksPerDay?: number;
  bytesPerDay?: number;
  readsPerMinute?: number;
  maxInlineFileBytes?: number;
  resultRetentionMs?: number;
}

export interface McpCatalog {
  /** slug -> human label, straight from the engine's own job registry. */
  labels: Record<string, string>;
  limits: McpCatalogLimits;
  /** The slugs this deployment runs, in the catalog's own order. */
  slugs: string[];
}

interface Spec {
  components?: {
    schemas?: {
      Catalog?: {
        properties?: {
          limits?: {
            properties?: Record<string, { const?: number } | undefined>;
          };
        };
      };
    };
  };
  'x-tool-labels'?: Record<string, string>;
}

/**
 * `merge-pdf` style slugs become `pdfshush_merge_pdf` tool names. Idempotent
 * on purpose: if a caller ever hands over an already-converted name, the
 * answer is that name and not `pdfshush_pdfshush_merge`, because a
 * mis-addressed tool is a silent failure an agent cannot recover from.
 */
export function mcpToolName(slug: string): string {
  if (slug.startsWith('pdfshush_')) return slug;
  return `pdfshush_${slug.replaceAll('-', '_')}`;
}

export type McpCatalogStatus = 'loading' | 'ready' | 'failed';

export function useMcpCatalog(): {
  status: McpCatalogStatus;
  catalog: McpCatalog | undefined;
  reload: () => void;
} {
  const [status, setStatus] = useState<McpCatalogStatus>('loading');
  const [catalog, setCatalog] = useState<McpCatalog | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(SPEC_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const spec = (await response.json()) as Spec;
        const labels = spec['x-tool-labels'] ?? {};
        const limits: McpCatalogLimits = {};
        const props = spec.components?.schemas?.Catalog?.properties?.limits?.properties ?? {};
        for (const key of [
          'tasksPerMinute',
          'tasksPerDay',
          'bytesPerDay',
          'readsPerMinute',
          'maxInlineFileBytes',
          'resultRetentionMs',
        ] as const) {
          const value = props[key]?.const;
          if (typeof value === 'number') limits[key] = value;
        }
        if (cancelled) return;
        setCatalog({ labels, limits, slugs: Object.keys(labels) });
        setStatus('ready');
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nonce]);

  return { status, catalog, reload };
}
