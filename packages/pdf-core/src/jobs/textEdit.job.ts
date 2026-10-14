/**
 * Edit text in place -- PDFium rewrites the document's own text objects, with a
 * verified pdf-lib overlay for anything it cannot rewrite.
 *
 * This is the honest successor to the overlay-only `edit` job. Where `edit`
 * always painted a white box and drew new text on top, this job first asks
 * PDFium to replace the existing glyphs, and only falls back per edit when that
 * is impossible or does not survive re-extraction. The output reports which
 * edits were genuine (`in-place`) and which were overlays (`fallback`).
 */

import type { JobDefinition } from '../job.js';
import { LIMITS } from '../limits.js';
import type { EditorObject } from '../ops/edit.js';
import { defaultPdfiumEnvironment, editPdfText } from '../textedit/engine.js';
import type { TextEdit, TextEditOutcome, TextEditVerification } from '../textedit/types.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index-signature constraint. */
export type TextEditJobOptions = {
  /** In-place edit intents; array order is not significant. */
  edits?: TextEdit[];
  /** Extra overlay objects (images, shapes, new text) applied in the final pass. */
  objects?: EditorObject[];
  /** AcroForm values keyed by field name. */
  formValues?: Record<string, string | boolean>;
  /** Output filename; defaults to `<stem>-edited.pdf`. */
  outputName?: string;
};

export interface TextEditJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: TextEditJobOptions;
}

export interface TextEditJobReport {
  outcomes: TextEditOutcome[];
  inPlace: number;
  fallback: number;
  usedNativeEngine: boolean;
  verification: TextEditVerification;
  warnings: string[];
}

export interface TextEditJobOutput {
  data: ArrayBuffer;
  name: string;
  pageCount: number;
  /** Always true on success: the exported bytes were reopened and re-extracted. */
  validated: boolean;
  report: TextEditJobReport;
}

export const textEditJob: JobDefinition<TextEditJobInput, TextEditJobOutput> = {
  slug: 'text-edit',
  label: 'Edit text in place',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'In-place text editing takes exactly one PDF' }] };
    }
    const edits = input.options?.edits?.length ?? 0;
    if (edits > LIMITS.tool.maxTextEdits) {
      return {
        ok: false,
        issues: [
          {
            message: `Too many text edits in one document (${edits}, max ${LIMITS.tool.maxTextEdits})`,
          },
        ],
      };
    }
    return { ok: true };
  },

  estimate(input) {
    // The source, the native result and the pdf-lib rewrite can be open at once.
    return { memoryBytes: totalInputBytes(input) * 3 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const stem = baseName(file.name).replace(/\.pdf$/i, '');
    const options = input.options ?? {};
    const name = safeOutputName(options.outputName, `${stem}-edited`);

    const result = await editPdfText(
      file.data,
      {
        edits: options.edits ?? [],
        ...(options.objects ? { objects: options.objects } : {}),
        ...(options.formValues ? { formValues: options.formValues } : {}),
        outputName: name,
      },
      ctx,
      defaultPdfiumEnvironment(),
      file.password,
    );

    ctx.onProgress({ phase: 'Saving', ratio: 1 });

    return {
      data: toArrayBuffer(result.bytes),
      name: result.name,
      pageCount: result.pageCount,
      validated: true,
      report: {
        outcomes: result.outcomes,
        inPlace: result.inPlace,
        fallback: result.fallback,
        usedNativeEngine: result.usedNativeEngine,
        verification: result.verification,
        warnings: result.warnings,
      },
    };
  },
};
