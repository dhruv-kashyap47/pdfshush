/**
 * MCP tool shapes, generated from `@pdfshush/api-contracts` (§25.4): one tool
 * per server-runnable slug, each carrying exactly the inline-job schema the
 * API validates -- with the slug folded out of the arguments and into the
 * tool identity, so an agent cannot call a slug the deployment cannot run.
 *
 * The parity gate pins the generated tool-name list to `SERVER_SLUGS`.
 */

import { SERVER_SLUGS, apiCreateJobSchema } from '@pdfshush/api-contracts';
import type { ZodTypeAny, z } from 'zod';

/** MCP tool name for a slug: the catalog slug, dashes flattened. */
export function toolName(slug: string): string {
  return `pdfshush_${slug.replaceAll('-', '_')}`;
}

const SLUG_BY_TOOL = new Map(SERVER_SLUGS.map((slug) => [toolName(slug), slug] as const));

export function slugForToolName(name: string): string | undefined {
  return SLUG_BY_TOOL.get(name);
}

/** The inline cap the API enforces per base64 file (D7), as we document it. */
export const INLINE_FILE_NOTE = 'PDF bytes, base64-encoded; the API refuses entries larger than 10 MB decoded per file.';

/** Field-level notes layered onto the contract shape (validators stay untouched). */
function describe(contract: z.ZodObject): Record<string, ZodTypeAny> {
  const files = contract.shape.files.describe(
    `1-50 entries of {name, data}; ${INLINE_FILE_NOTE} Order matters (merge concatenates in order).`,
  );
  const password = contract.shape.password.describe(
    'Document password when a file is encrypted; one password applies to all files.',
  );
  const options = contract.shape.options.describe(
    'Tool-specific JSON; read the matching pdfshush://guide/<slug> resource for the vocabulary. Unknown keys are rejected with validation_failed.',
  );
  return { files, password, options };
}

export interface ToolDescriptor {
  name: string;
  slug: string;
  title: string;
  readonly: boolean;
  /** Returned as MCP `inputSchema` (a record of zod types). */
  shape: Record<string, ZodTypeAny>;
}

export function toolDescriptor(
  slug: string,
  labels: Record<string, string>,
): ToolDescriptor {
  const label = labels[slug] ?? slug;
  return {
    name: toolName(slug),
    slug,
    title: label,
    readonly: slug === 'inspect',
    shape: describe(apiCreateJobSchema.omit({ slug: true })),
  };
}

/** The full list, in catalog order -- exactly what the parity gate pins. */
export function toolDescriptors(labels: Record<string, string>): ToolDescriptor[] {
  return SERVER_SLUGS.map((slug) => toolDescriptor(slug, labels));
}
