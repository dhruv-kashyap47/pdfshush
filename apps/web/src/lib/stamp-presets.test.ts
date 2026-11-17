import { describe, expect, it } from 'vitest';
import { DEFAULT_STAMP_PRESET, STAMP_PRESETS, stampPreset } from './stamp-presets';

describe('stamp presets', () => {
  it('covers the agreed verdicts', () => {
    expect(STAMP_PRESETS.map((preset) => preset.label)).toEqual([
      'APPROVED',
      'PAID',
      'DRAFT',
      'FINAL',
      'CONFIDENTIAL',
      'REJECTED',
      'VOID',
    ]);
  });

  it('has a unique id and a hex colour per preset', () => {
    expect(new Set(STAMP_PRESETS.map((preset) => preset.id)).size).toBe(STAMP_PRESETS.length);
    for (const preset of STAMP_PRESETS) {
      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('resolves an unknown id to the default instead of throwing', () => {
    expect(stampPreset('approved')).toBe(DEFAULT_STAMP_PRESET);
    expect(stampPreset('not-a-preset')).toBe(DEFAULT_STAMP_PRESET);
  });
});
