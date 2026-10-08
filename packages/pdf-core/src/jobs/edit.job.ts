/**
 * Edit PDF -- applies overlay objects (text, images, shapes, markup,
 * whiteouts) and AcroForm values, then validates its own output.
 *
 * Display-space objects arrive exactly as the editor produced them; the save
 * path re-parses the result (`validateExport`) so a corrupt export can never
 * be offered for download.
 */

import type { JobDefinition } from '../job.js';
import { applyEdits, validateExport, type EditorObject } from '../ops/edit.js';
import { applyFormValues } from '../ops/forms.js';
import { loadPdfDocument } from '../ops/pages.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';
import { LIMITS } from '../limits.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type EditJobOptions = {
  /** Overlay objects in display space; array order = z-order (later on top). */
  objects?: EditorObject[];
  /** AcroForm values keyed by field name. */
  formValues?: Record<string, string | boolean>;
  /** Output filename; defaults to `<stem>-edited.pdf`. */
  outputName?: string;
};

export interface EditJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: EditJobOptions;
}

export interface EditJobOutput {
  data: ArrayBuffer;
  name: string;
  pageCount: number;
  /** Always true on success: bytes were re-parsed and page count verified. */
  validated: boolean;
}

export const editJob: JobDefinition<EditJobInput, EditJobOutput> = {
  slug: 'edit',
  label: 'Apply edits',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Editing takes exactly one PDF' }] };
    }
    const objects = input.options?.objects?.length ?? 0;
    if (objects > LIMITS.tool.maxEditObjects) {
      return {
        ok: false,
        issues: [
          {
            message: `Too many objects in one document (${objects}, max ${LIMITS.tool.maxEditObjects})`,
          },
        ],
      };
    }
    return { ok: true };
  },

  estimate(input) {
    // Source plus edited copy stay open simultaneously, and every embedded image
    // is decoded as well as held -- so count the image bytes too.
    const imageBytes = (input.options?.objects ?? []).reduce(
      (total, object) =>
        object.kind === 'image'
          ? total + (object.data instanceof Uint8Array ? object.data.byteLength : (object.data?.byteLength ?? 0))
          : total,
      0,
    );
    return { memoryBytes: totalInputBytes(input) * 2 + imageBytes };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const doc = await loadPdfDocument(file.data, {
      ...(file.password ? { password: file.password } : {}),
    });
    const expectedPages = doc.getPageCount();

    const objects = input.options?.objects ?? [];
    await applyEdits(doc, objects, ctx);
    applyFormValues(doc, input.options?.formValues ?? {});

    ctx.throwIfAborted();
    ctx.onProgress({ phase: 'Saving', ratio: 0.8 });
    const saved = await doc.save({ useObjectStreams: false });

    // Gate: re-parse before the UI is allowed to offer a download.
    await validateExport(saved, expectedPages);

    const stem = baseName(file.name).replace(/\.pdf$/i, '');
    const name = safeOutputName(input.options?.outputName, `${stem}-edited`);

    return { data: toArrayBuffer(saved), name, pageCount: expectedPages, validated: true };
  },
};
