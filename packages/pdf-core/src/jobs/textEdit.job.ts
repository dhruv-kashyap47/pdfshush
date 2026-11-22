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
import { defaultPdfiumEnvironment, editPdfText, TEXT_ENGINE_STRATEGIES, type TextEngineStrategy } from '../textedit/engine.js';
import type { EditStats, TextEdit, TextEditOutcome, TextEditVerification } from '../textedit/types.js';
import { collectWarnings, type JobWarning } from '../warnings.js';
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
  /** Render edited pages and compare unchanged pixels. Default true. */
  verifyVisual?: boolean;
  /** Engine strategy; defaults to `auto`. Unknown values are rejected. */
  strategy?: import('../textedit/engine.js').TextEngineStrategy;
  /** X-03: accept a verified untouched-page text mismatch after user confirmation. */
  acceptUntouchedPageChanges?: boolean;
  /**
   * X-02: pages already carrying an OCR layer in the source bytes. The editor
   * knows this; the engine cannot infer it from the text operators alone.
   */
  ocrPages?: number;
};

export interface TextEditJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: TextEditJobOptions;
}

export interface TextEditJobReport {
  outcomes: TextEditOutcome[];
  inPlace: number;
  contentStream: number;
  fallback: number;
  manualReview: number;
  covers: number;
  rasterised: number;
  usedNativeEngine: boolean;
  strategy: TextEngineStrategy;
  verification: TextEditVerification;
  warnings: JobWarning[];
  /** X-02: pages, characters, objects, fonts and strategy, from the engine. */
  stats: EditStats;
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
    const strategy = input.options?.strategy;
    if (strategy !== undefined && !TEXT_ENGINE_STRATEGIES.includes(strategy)) {
      return {
        ok: false,
        issues: [{ message: `Unknown text engine strategy "${String(strategy)}"` }],
      };
    }
    if (
      input.options?.acceptUntouchedPageChanges !== undefined &&
      typeof input.options.acceptUntouchedPageChanges !== 'boolean'
    ) {
      return {
        ok: false,
        issues: [{ message: 'acceptUntouchedPageChanges must be a boolean' }],
      };
    }
    const ocrPages = input.options?.ocrPages;
    if (ocrPages !== undefined && (!Number.isInteger(ocrPages) || ocrPages < 0)) {
      return { ok: false, issues: [{ message: 'OCR page count must be a non-negative integer' }] };
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
        ...(options.verifyVisual !== undefined ? { verifyVisual: options.verifyVisual } : {}),
        ...(options.strategy ? { strategy: options.strategy } : {}),
        ...(options.acceptUntouchedPageChanges
          ? { acceptUntouchedPageChanges: true }
          : {}),
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
        contentStream: result.contentStream,
        fallback: result.fallback,
        manualReview: result.manualReview,
        covers: result.covers,
        rasterised: result.rasterised,
        usedNativeEngine: result.usedNativeEngine,
        strategy: result.strategy,
        verification: result.verification,
        warnings: collectWarnings(result.warnings),
        stats:
          options.ocrPages !== undefined
            ? { ...result.stats, ocrPages: options.ocrPages }
            : result.stats,
      },
    };
  },
};
