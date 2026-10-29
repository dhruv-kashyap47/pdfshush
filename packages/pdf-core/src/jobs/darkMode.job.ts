/**
 * Dark-mode job -- browser-only rebuild of every page as a dark-mode JPEG.
 * See `src/darkmode/dark.ts` for the rasterize-and-rebuild contract; the job is
 * the thin envelope (caps, validation, names).
 */

import type { JobDefinition } from '../job.js';
import { darkModeDocument } from '../darkmode/dark.js';
import { isDarkModeThemeId, type DarkModeKind, type DarkModeThemeId } from '../darkmode/darkModes.js';
import { baseName, safeOutputName, toArrayBuffer, totalInputBytes } from './helpers.js';

/** Type alias (not interface) for the implicit index signature constraint. */
export type DarkModeJobOptions = {
  /** Transform kind: `theme` remap, `smart` hue-preserving, `invert` negative. */
  kind?: DarkModeKind;
  /** Background theme id, used only when `kind` is `theme`. */
  themeId?: DarkModeThemeId;
  /** Render width in pixels, 320..4000. */
  targetWidthPx?: number;
  /** JPEG quality, 0.3..1. */
  quality?: number;
  /** Override the output file name (extension optional). */
  outputName?: string;
};

export interface DarkModeJobInput {
  files: { name: string; type?: string; data: Uint8Array; password?: string }[];
  options?: DarkModeJobOptions;
}

export interface DarkModeJobOutput {
  data: ArrayBuffer;
  pageCount: number;
  fileName: string;
}

const KINDS: ReadonlySet<string> = new Set<DarkModeKind>(['theme', 'smart', 'invert']);

export const darkModeJob: JobDefinition<DarkModeJobInput, DarkModeJobOutput> = {
  slug: 'dark-mode',
  label: 'Convert pages to dark mode',

  validate(input) {
    const issues = [];
    if (input.files.length !== 1) issues.push({ message: 'Choose exactly one PDF' });
    const kind = input.options?.kind;
    if (kind !== undefined && !KINDS.has(kind)) {
      issues.push({ message: 'Kind must be one of theme, smart, invert' });
    }
    const themeId = input.options?.themeId;
    if (themeId !== undefined && !isDarkModeThemeId(themeId)) {
      issues.push({ message: 'Unknown theme id' });
    }
    const width = input.options?.targetWidthPx;
    if (width !== undefined && (!Number.isFinite(width) || width < 320 || width > 4000)) {
      issues.push({ message: 'Render width must be between 320 and 4000 px' });
    }
    const quality = input.options?.quality;
    if (quality !== undefined && (!Number.isFinite(quality) || quality < 0.3 || quality > 1)) {
      issues.push({ message: 'Quality must be between 0.3 and 1' });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true };
  },

  estimate(input) {
    // Every page becomes a full bitmap before it is re-embedded.
    const bytes = totalInputBytes(input);
    return { memoryBytes: bytes * 8 };
  },

  async run(input, ctx) {
    const file = input.files[0]!;
    const result = await darkModeDocument(
      file.data,
      {
        ...(input.options?.kind !== undefined ? { kind: input.options.kind } : {}),
        ...(input.options?.themeId !== undefined ? { themeId: input.options.themeId } : {}),
        ...(input.options?.targetWidthPx !== undefined ? { targetWidthPx: input.options.targetWidthPx } : {}),
        ...(input.options?.quality !== undefined ? { quality: input.options.quality } : {}),
      },
      ctx,
      file.password,
    );
    return {
      data: toArrayBuffer(result.data),
      pageCount: result.pageCount,
      fileName: safeOutputName(input.options?.outputName, `${baseName(file.name)}-dark`),
    };
  },
};
