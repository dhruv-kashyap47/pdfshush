/**
 * Parity gate (§24.4): the MCP tool list is pinned to the server-runnable
 * slug set, and every tool's schema accepts exactly what the API contract
 * accepts. Drift -- a schema loosened, a field dropped -- fails here before
 * it can fail an agent.
 */

import { describe, expect, it } from 'vitest';
import { SERVER_SLUGS, apiCreateJobSchema } from '@pdfshush/api-contracts';
import { INLINE_FILE_NOTE, slugForToolName, toolDescriptor, toolName, toolDescriptors } from '../src/tools.js';

const PDF_B64 = Buffer.from('%PDF-1.4 trivial bytes').toString('base64');

/** Whether a tool-shape record accepts `args` the way the SDK would. */
function shapeAccepts(shape: Record<string, import('zod').ZodTypeAny>, args: Record<string, unknown>): boolean {
  return Object.entries(shape).every(([key, schema]) =>
    key in args ? schema.safeParse(args[key]).success : schema.isOptional(),
  );
}

describe('tool/schema parity', () => {
  it('the generated tool-name list is exactly SERVER_SLUGS, order preserved', () => {
    const descriptors = toolDescriptors({});
    expect(descriptors.map((t) => t.name)).toEqual(SERVER_SLUGS.map(toolName));
    expect(descriptors.map((t) => t.slug)).toEqual([...SERVER_SLUGS]);
  });

  it('every shape carries exactly the inline-job fields, minus the slug', () => {
    for (const slug of SERVER_SLUGS) {
      expect(Object.keys(toolDescriptor(slug, {}).shape).sort()).toEqual(['files', 'options', 'password']);
    }
  });

  it('shapes accept exactly what the contract accepts, for both valid and invalid bodies', () => {
    const valid = { files: [{ name: 'a.pdf', data: PDF_B64 }] };
    const cases: Record<string, unknown>[] = [
      valid,
      { ...valid, password: 'hushhush' },
      { ...valid, options: { chunkSize: 2 } },
      {}, // files missing
      { files: [] }, // files empty
      { files: [{ name: 'a.pdf', data: 'not base64!!' }] }, // not base64
      { files: [{ name: '', data: PDF_B64 }] }, // empty name
      {
        files: Array.from({ length: 51 }, (_, i) => ({ name: `f${i}.pdf`, data: PDF_B64 })),
      }, // over the file count
      { files: valid.files, password: 'x'.repeat(257) }, // password over the cap
    ];
    for (const slug of SERVER_SLUGS) {
      const shape = toolDescriptor(slug, {}).shape;
      const translated = (args: Record<string, unknown>) => shapeAccepts(shape, args);
      for (const body of cases) {
        expect(translated(body)).toBe(apiCreateJobSchema.safeParse({ ...body, slug }).success);
      }
    }
  });

  it('maps tool names back to their slug, and never invents one', () => {
    expect(slugForToolName('pdfshush_split_by_pages')).toBe('split-by-pages');
    expect(slugForToolName('pdfshush_split-by-pages')).toBeUndefined();
    expect(slugForToolName('inspect')).toBeUndefined();
  });

  it('documents the inline cap where agents read it', () => {
    expect(INLINE_FILE_NOTE).toContain('10 MB');
  });
});
