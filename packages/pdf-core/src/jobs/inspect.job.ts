import { createProgressReporter, type JobDefinition } from '../job.js';
import { inspectPdf, type PageInfo } from '../ops/pages.js';
import type { FormWidgetInfo } from '../ops/forms.js';
import { totalInputBytes } from './helpers.js';

export interface InspectInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
}

export interface InspectOutput {
  documents: {
    name: string;
    pageCount: number;
    encrypted: boolean;
    version: string;
    pages: PageInfo[];
    /** AcroForm widgets with display-space rects (editor form filling). */
    fields: FormWidgetInfo[];
    metadata: { title?: string; author?: string; creator?: string };
  }[];
}

/**
 * Read-only document probe: page counts, geometry and metadata. Every tool
 * runs this first so it can validate ranges, label inputs and pick a timeout
 * before a single byte is rewritten.
 */
export const inspectJob: JobDefinition<InspectInput, InspectOutput> = {
  slug: 'inspect',
  label: 'Inspect documents',

  validate(input) {
    if (input.files.length === 0) return { ok: false, issues: [{ message: 'Add at least one PDF' }] };
    return { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) };
  },

  async run(input, ctx) {
    const documents: InspectOutput['documents'] = [];
    const progress = createProgressReporter(ctx);
    for (const [index, file] of input.files.entries()) {
      ctx.throwIfAborted();
      progress.step(index, input.files.length, 'Reading documents');
      const info = await inspectPdf(file.data, {
        ...(file.password ? { password: file.password } : {}),
      });
      documents.push({
        name: file.name,
        pageCount: info.pageCount,
        encrypted: info.encrypted,
        version: info.version,
        pages: info.pages,
        fields: info.fields,
        metadata: {
          ...(info.metadata.title !== undefined ? { title: info.metadata.title } : {}),
          ...(info.metadata.author !== undefined ? { author: info.metadata.author } : {}),
          ...(info.metadata.creator !== undefined ? { creator: info.metadata.creator } : {}),
        },
      });
    }
    return { documents };
  },
};
