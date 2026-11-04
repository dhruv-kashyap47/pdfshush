/**
 * The measurement sections (PLAN.md 29.6 / 30.10) list nine limitations. A
 * disclosure that quietly drops one is worse than none, because it reads as a
 * complete list. This pins the mapping from each measured limitation to the
 * sentence shown in the editor, so deleting a limitation from the UI fails the
 * suite instead of silently narrowing the claim.
 */

import { describe, expect, it } from 'vitest';
import { TEXT_MODEL_LIMITS, type TextModelLimitId } from './text-model-limits';

/** Every limitation named in 29.6 / 30.10 that affects what a user sees. */
const REQUIRED: TextModelLimitId[] = [
  'cross-page-paragraphs', // 29.6: cross-page paragraphs are not joined
  'footnote-tails', // 29.6: a footnote tail can split from its paragraph
  'drop-caps', // 29.6: a drop cap can detach its first letter
  'vector-figures', // 29.6: vector figures are not regions
  'forms-as-columns', // 29.6: the IRS 1040 reads as four columns
  'tables', // 29.6: mixed-alignment refusal + rowSpan/colSpan stay 1
  'scanned-pages', // 29.6/30.10: scanned pages are not OCR'd
];

describe('text-model limitations disclosure', () => {
  it('covers every measured limitation that reaches the editing UI', () => {
    const ids = new Set(TEXT_MODEL_LIMITS.map((limit) => limit.id));
    expect([...REQUIRED].filter((id) => !ids.has(id))).toEqual([]);
  });

  it('has no entry that is not a real limitation', () => {
    const known = new Set<TextModelLimitId>(REQUIRED);
    expect(TEXT_MODEL_LIMITS.filter((limit) => !known.has(limit.id)).map((limit) => limit.id)).toEqual(
      [],
    );
  });

  it('writes a full sentence for each limitation, not a placeholder', () => {
    for (const limit of TEXT_MODEL_LIMITS) {
      expect(limit.text.length, limit.id).toBeGreaterThan(40);
      expect(limit.text.trim().endsWith('.'), limit.id).toBe(true);
      expect(limit.text.toLowerCase(), limit.id).not.toContain('todo');
    }
  });

  it('states the OCR boundary plainly, since that is the boundary users hit first', () => {
    const scanned = TEXT_MODEL_LIMITS.find((limit) => limit.id === 'scanned-pages');
    expect(scanned?.text).toMatch(/no text layer/i);
    expect(scanned?.text).toMatch(/no ocr|until ocr/i);
  });
});
