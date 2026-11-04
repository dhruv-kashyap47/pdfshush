/**
 * The shared trust card is a claim, and a claim that is not per-tool is either
 * vague ("no limits") or false (a 500-page cap on a tool that stops at 150).
 * These tests pin coverage: every live tool has its own sentence, and none of
 * them repeats the old absolute.
 */

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '@/tools/registry';
import { TOOL_LIMIT_NOTES, limitNoteFor } from './tool-limits';

describe('per-tool limit copy', () => {
  const live = ALL_TOOLS.filter((tool) => tool.status === 'live');

  it('has a specific sentence for every live tool', () => {
    const missing = live.filter((tool) => !TOOL_LIMIT_NOTES[tool.slug]).map((tool) => tool.slug);
    expect(missing).toEqual([]);
  });

  it('does not carry copy for a slug that is not live', () => {
    const liveSlugs = new Set(live.map((tool) => tool.slug));
    const orphaned = Object.keys(TOOL_LIMIT_NOTES).filter((slug) => !liveSlugs.has(slug));
    expect(orphaned).toEqual([]);
  });

  it('never claims "no limits"', () => {
    for (const [slug, note] of Object.entries(TOOL_LIMIT_NOTES)) {
      expect(note.toLowerCase(), slug).not.toContain('no limit');
    }
  });

  it('states a number, or says explicitly that no file is involved', () => {
    for (const [slug, note] of Object.entries(TOOL_LIMIT_NOTES)) {
      expect(/\d/.test(note) || /no (?:file|account)/i.test(note), `${slug}: ${note}`).toBe(true);
    }
  });

  it('falls back to the client ceiling for an unknown slug', () => {
    const note = limitNoteFor('not-a-real-tool');
    expect(note).toContain('500');
    expect(note).toContain('250 MB');
  });
});
