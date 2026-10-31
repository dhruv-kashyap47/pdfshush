/**
 * Read page text -- display-space text runs for the editor's click-to-edit.
 *
 * Runs as its own (read-only) job so the editor can fetch the active page's
 * text without touching the source document's bytes again.
 */

import type { JobDefinition } from '../job.js';
import { extractTextRuns, type TextRun } from '../render/textRuns.js';
import { extractTextRunsAndLayouts } from '../render/textLayout.js';
import type { LayoutBuildOptions } from '../document/group.js';
import type { PageLayout } from '../document/types.js';
import { inspectDocumentCapabilities } from '../textedit/capabilities.js';
import { loadPdfiumModule } from '../textedit/runtime.js';
import type { PageTextCapability } from '../textedit/types.js';
import { totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type TextRunsOptions = {
  /** Zero-based page indexes. Empty or missing means every page. */
  pageIndexes?: number[];
  /**
   * Also return the structured page layouts (words/lines/paragraphs/blocks).
   * One pdf.js load produces both, so opting in does not re-parse the file.
   */
  includeLayout?: boolean;
  /** Also inspect PDFium text objects/fonts/render modes for editing capability. */
  includeCapabilities?: boolean;
  /** Overrides for the layout heuristics; mainly for diagnostics and tests. */
  layout?: LayoutBuildOptions;
};

export interface TextRunsInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: TextRunsOptions;
}

export interface TextRunsOutput {
  /** One run list per requested page, in request order. */
  runs: TextRun[][];
  /** Present when `options.includeLayout` was true, aligned with `runs`. */
  layouts?: PageLayout[];
  /** Present when `options.includeCapabilities` was true, aligned with `runs`. */
  capabilities?: PageTextCapability[];
  /** Set when capability inspection was requested but PDFium was unavailable/failed. */
  capabilityWarning?: string;
}

export const textRunsJob: JobDefinition<TextRunsInput, TextRunsOutput> = {
  slug: 'text-runs',
  label: 'Read page text',

  validate(input) {
    if (input.files.length !== 1) {
      return { ok: false, issues: [{ message: 'Choose exactly one PDF' }] };
    }
    return { ok: true };
  },

  estimate(input) {
    return { memoryBytes: totalInputBytes(input) };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const pageIndexes = input.options?.pageIndexes ?? [];
    let runs: TextRun[][];
    let layouts: PageLayout[] | undefined;
    if (input.options?.includeLayout) {
      const result = await extractTextRunsAndLayouts(
        file.data,
        pageIndexes,
        ctx,
        file.password,
        input.options.layout,
      );
      runs = result.runs;
      layouts = result.layouts;
    } else {
      runs = await extractTextRuns(file.data, pageIndexes, ctx, file.password);
    }

    let capabilities: PageTextCapability[] | undefined;
    let capabilityWarning: string | undefined;
    if (input.options?.includeCapabilities) {
      try {
        const module = await loadPdfiumModule();
        const inspected = inspectDocumentCapabilities(file.data, {
          module,
          pageIndexes: pageIndexes.length > 0 ? pageIndexes : undefined,
          ...(file.password ? { password: file.password } : {}),
        });
        capabilities = inspected.pages;
        if (inspected.warnings.length > 0) capabilityWarning = inspected.warnings.join(' ');
      } catch (error) {
        capabilityWarning = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      runs,
      ...(layouts ? { layouts } : {}),
      ...(capabilities ? { capabilities } : {}),
      ...(capabilityWarning ? { capabilityWarning } : {}),
    };
  },
};
