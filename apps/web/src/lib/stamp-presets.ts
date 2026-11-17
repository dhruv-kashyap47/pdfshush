/**
 * Stamp preset catalogue.
 *
 * Shared by the editor's stamp tool and the standalone stamp surface so one
 * vocabulary (and one colour per verdict) is used everywhere. Each preset
 * becomes a single `stamp` object: a bordered box plus a bold label, exported
 * as vectors and real text.
 *
 * `invented` in the parity report: the reference stamps are raster images.
 */

export interface StampPreset {
  id: string;
  label: string;
  /** `#rrggbb`, the box and the label. */
  color: string;
}

export const STAMP_PRESETS: readonly StampPreset[] = [
  { id: 'approved', label: 'APPROVED', color: '#15803d' },
  { id: 'paid', label: 'PAID', color: '#15803d' },
  { id: 'draft', label: 'DRAFT', color: '#6b7280' },
  { id: 'final', label: 'FINAL', color: '#1d4ed8' },
  { id: 'confidential', label: 'CONFIDENTIAL', color: '#b91c1c' },
  { id: 'rejected', label: 'REJECTED', color: '#b91c1c' },
  { id: 'void', label: 'VOID', color: '#b91c1c' },
] as const;

export function stampPreset(id: string): StampPreset {
  return STAMP_PRESETS.find((preset) => preset.id === id) ?? STAMP_PRESETS[0]!;
}

/** The first preset, used when the stamp tool is armed without a choice. */
export const DEFAULT_STAMP_PRESET = STAMP_PRESETS[0]!;
