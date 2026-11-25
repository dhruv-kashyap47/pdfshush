/**
 * The FAQ coverage gate.
 *
 * A new live tool must arrive with its own answers, and a declined page must
 * never inherit a FAQ about a workflow that does not exist. Keeping the count
 * between five and eight stops the section from becoming either an SEO stub or
 * a second documentation page.
 */

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, liveTools } from './registry';
import { TOOL_FAQS, faqsFor } from './tool-faqs';

describe('tool FAQs', () => {
  it('covers every live tool and only live tools', () => {
    expect(Object.keys(TOOL_FAQS).sort()).toEqual(liveTools().map((tool) => tool.slug).sort());
  });

  it('keeps each set compact and genuinely answered', () => {
    for (const tool of liveTools()) {
      const items = faqsFor(tool.slug);
      expect(items.length, tool.slug).toBeGreaterThanOrEqual(5);
      expect(items.length, tool.slug).toBeLessThanOrEqual(8);

      const questions = new Set<string>();
      for (const item of items) {
        expect(questions.has(item.question), `${tool.slug}: ${item.question}`).toBe(false);
        questions.add(item.question);
        expect(item.question.endsWith('?'), `${tool.slug}: ${item.question}`).toBe(true);
        expect(item.answer.length, `${tool.slug}: ${item.question}`).toBeGreaterThan(60);
      }
    }
  });

  it('leaves coming-soon pages without a FAQ', () => {
    for (const tool of ALL_TOOLS.filter((entry) => entry.status !== 'live')) {
      expect(faqsFor(tool.slug), tool.slug).toEqual([]);
    }
  });
});
