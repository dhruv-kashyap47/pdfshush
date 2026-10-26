/**
 * Create Forms job -- add AcroForm text fields and checkboxes to a PDF.
 *
 * The engine work lives in `ops/formFields`; this job owns the cheap
 * pre-flight, the file load/save and the output name. Existing page content is
 * never rewritten -- the widgets are annotations added on top.
 */

import type { JobDefinition } from '../job.js';
import { LIMITS } from '../limits.js';
import { addFormFields, type NewFormField } from '../ops/formFields.js';
import { loadPdfDocument } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type CreateFormsJobOptions = {
  /** Fields to create. Required; an empty form is not a useful output. */
  fields?: NewFormField[];
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface CreateFormsJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: CreateFormsJobOptions;
}

export interface CreateFormsJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fieldCount: number;
  fileName: string;
}

export const createFormsJob: JobDefinition<CreateFormsJobInput, CreateFormsJobOutput> = {
  slug: 'create-forms',
  label: 'Create form fields',

  validate(input) {
    const issues: { field?: string; message: string }[] = [];
    if (input.files.length !== 1) {
      issues.push({ field: 'files', message: 'Add exactly one PDF' });
    }
    const fields = input.options?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      issues.push({ field: 'fields', message: 'Add at least one field' });
    } else if (fields.length > LIMITS.tool.maxFormFields) {
      issues.push({
        field: 'fields',
        message: `At most ${LIMITS.tool.maxFormFields} fields can be added at once`,
      });
    } else {
      fields.forEach((field, index) => {
        if (!field || typeof field !== 'object') {
          issues.push({ field: `fields[${index}]`, message: 'Field must be an object' });
          return;
        }
        if (field.type !== 'text' && field.type !== 'checkbox') {
          issues.push({
            field: `fields[${index}].type`,
            message: 'Field type must be text or checkbox',
          });
        }
        if (typeof field.name !== 'string' || !field.name.trim()) {
          issues.push({ field: `fields[${index}].name`, message: 'Field needs a name' });
        } else if (field.name.trim().length > LIMITS.tool.maxFormFieldNameChars) {
          issues.push({
            field: `fields[${index}].name`,
            message: `Field name is longer than ${LIMITS.tool.maxFormFieldNameChars} characters`,
          });
        }
        if (!Number.isInteger(field.pageIndex) || field.pageIndex < 0) {
          issues.push({
            field: `fields[${index}].pageIndex`,
            message: 'Field needs a page',
          });
        }
      });
    }

    const outputName = input.options?.outputName;
    if (outputName !== undefined && typeof outputName !== 'string') {
      issues.push({ field: 'outputName', message: 'The output name must be text' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Source + loaded document + the rewritten output, plus a small per-widget
    // cost for appearance streams.
    return {
      memoryBytes: totalInputBytes(input) * 2 + (input.options?.fields?.length ?? 0) * 4096,
    };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const options = input.options ?? {};
    const fields = options.fields ?? [];

    const doc = await loadPdfDocument(
      file.data,
      file.password !== undefined ? { password: file.password } : {},
    );
    ctx.throwIfAborted();

    const fieldCount = addFormFields(doc, fields);
    ctx.onProgress({ phase: 'Writing form', ratio: 0.7, message: `${fieldCount} fields` });

    const bytes = await doc.save({ useObjectStreams: false });
    ctx.throwIfAborted();

    return {
      data: toArrayBuffer(bytes),
      pageCount: doc.getPageCount(),
      fieldCount,
      fileName: safeOutputName(options.outputName, `${baseName(file.name)}-fillable`),
    };
  },
};
