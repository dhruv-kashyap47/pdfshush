import { describe, expect, it } from 'vitest';
import type { ToolExecution } from '@pdfshush/ai-agent';
import type { TextRun } from '@pdfshush/pdf-core';
import {
  createPdfEditSkill,
  looksLikeEditClaim,
  planPageRefs,
  planTextEdits,
  spliceOccurrences,
  type AiEditPlan,
  type AiEditSkill,
} from './edit-skill';
import type { AiDocument } from './pdf-session';

function run(text: string, overrides: Partial<TextRun> = {}): TextRun {
  return {
    text,
    fontSize: 12,
    x: 40,
    y: 40,
    width: Math.max(24, text.length * 6),
    height: 14,
    horizontal: true,
    ...overrides,
  };
}

function doc(
  runsByPage: TextRun[][],
  options: { pageCount?: number; pageSizes?: { width: number; height: number }[] } = {},
): AiDocument {
  return {
    fileName: 'report.pdf',
    pageCount: options.pageCount ?? runsByPage.length,
    textPageCount: runsByPage.length,
    runs: runsByPage,
    pages: runsByPage.map((runs) => runs.map((entry) => entry.text).join(' ')),
    ...(options.pageSizes ? { pageSizes: options.pageSizes } : {}),
  };
}

const call = (name: string, input: Record<string, unknown>) => ({
  id: `call-${name}`,
  name,
  input,
});

/** The edit skill is synchronous; the AgentSkill signature also allows promises. */
const execute = (
  skill: AiEditSkill,
  agentCall: { id: string; name: string; input: Record<string, unknown> },
): ToolExecution => skill.skill.executeTool(agentCall) as ToolExecution;

const applyTextEdits = (plan: AiEditPlan) => planTextEdits(plan);

describe('spliceOccurrences', () => {
  it('keeps the rest of the run when a fragment is replaced', () => {
    expect(spliceOccurrences('Quarterly Report 2026', 'Report', 'Summary', false)).toEqual({
      text: 'Quarterly Summary 2026',
      count: 1,
    });
  });

  it('is case-insensitive but preserves the untouched casing', () => {
    expect(spliceOccurrences('Quarterly REPORT 2026', 'report', 'Summary', false).text).toBe(
      'Quarterly Summary 2026',
    );
  });

  it('replaces every occurrence only when asked', () => {
    expect(spliceOccurrences('alpha alpha beta', 'alpha', 'X', true)).toEqual({
      text: 'X X beta',
      count: 2,
    });
    expect(spliceOccurrences('alpha alpha beta', 'alpha', 'X', false).text).toBe('X alpha beta');
  });
});

describe('fragment-safe text edits', () => {
  it('replaces only the quoted fragment of a line', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    const result = execute(
      skill,
      call('replace_text', { page: 1, find: 'Report', replace: 'Summary' }),
    );

    expect(result.isError).toBeFalsy();
    const plan = skill.plan();
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.impact).toBe('content');
    expect(plan.intents[0]).toMatchObject({
      pageIndex: 0,
      find: 'Quarterly Report 2026',
      replace: 'Quarterly Summary 2026',
    });
    // The fallback text and its cover are linked to the intent, so the engine
    // paints them only if the in-place rewrite fails.
    const { edits, overlays } = applyTextEdits(plan);
    expect(edits).toHaveLength(1);
    expect(overlays).toHaveLength(0);
  });

  it('replaces every occurrence inside one run with all: true', () => {
    const skill = createPdfEditSkill(doc([[run('alpha alpha beta')]]));
    const result = execute(
      skill,
      call('replace_text', { page: 1, find: 'alpha', replace: 'X', all: true }),
    );

    expect(result.isError).toBeFalsy();
    expect(skill.plan().intents[0]!.replace).toBe('X X beta');
  });

  it('keeps each line intact in a document-wide replacement', () => {
    const skill = createPdfEditSkill(
      doc([[run('Invoice: Quarterly Report 2026')], [run('Draft: Quarterly Report 2027')]]),
    );
    const result = execute(
      skill,
      call('replace_everywhere', { find: 'Quarterly Report', replace: 'Annual Summary' }),
    );

    expect(result.isError).toBeFalsy();
    expect(skill.plan().intents.map((intent) => intent.replace)).toEqual([
      'Invoice: Annual Summary 2026',
      'Draft: Annual Summary 2027',
    ]);
    expect(skill.plan().entries[0]!.pages).toEqual([1, 2]);
  });

  it('erases only the quoted fragment, keeping the rest of the line', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    const result = execute(skill, call('delete_text', { page: 1, text: 'Quarterly ' }));

    expect(result.isError).toBeFalsy();
    expect(skill.plan().intents[0]!.replace).toBe('Report 2026');
  });

  it('does not queue a no-op replacement', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    const result = execute(
      skill,
      call('replace_text', { page: 1, find: 'Report', replace: 'Report' }),
    );

    expect(result.isError).toBe(true);
    expect(skill.plan().entries).toHaveLength(0);
    expect(skill.plan().objects).toHaveLength(0);
  });

  it('reports a missing fragment without queuing anything', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    const result = execute(
      skill,
      call('replace_text', { page: 1, find: 'Annual', replace: 'Yearly' }),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/No text matching/);
    expect(skill.plan().entries).toHaveLength(0);
  });
});

describe('page structure uses the true page count', () => {
  it('rotates every page in a document longer than the text cap', () => {
    const skill = createPdfEditSkill(
      doc([[run('page one')], [run('page two')]], { pageCount: 5 }),
    );
    const result = execute(skill, call('rotate_pages', { degrees: 90 }));

    expect(result.isError).toBeFalsy();
    const plan = skill.plan();
    expect([...plan.rotations.keys()]).toEqual([1, 2, 3, 4, 5]);
    expect(plan.entries[0]!.pages).toEqual([1, 2, 3, 4, 5]);
    expect(plan.entries[0]!.impact).toBe('layout');
    // The organize step must keep every page, not only the extracted ones.
    expect(planPageRefs(plan, 5)).toHaveLength(5);
  });

  it('shows every pending deletion after a second delete call', () => {
    const skill = createPdfEditSkill(
      doc([[run('page one')], [run('page two')]], { pageCount: 5 }),
    );
    execute(skill, call('delete_pages', { pages: [2] }));
    execute(skill, call('delete_pages', { pages: [3] }));

    const entry = skill.plan().entries[0]!;
    expect(entry.kind).toBe('delete-pages');
    expect(entry.pages).toEqual([2, 3]);
    expect(skill.plan().order).toEqual([1, 4, 5]);
  });

  it('refuses a text edit on a page whose text was not extracted', () => {
    const skill = createPdfEditSkill(
      doc([[run('page one')], [run('page two')]], { pageCount: 5 }),
    );
    const result = execute(
      skill,
      call('replace_text', { page: 5, find: 'anything', replace: 'else' }),
    );

    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/text-extraction limit/);
  });
});

describe('set_page_order is a permutation, not a way to drop pages', () => {
  const fivePages = () =>
    createPdfEditSkill(doc([[run('one')], [run('two')]], { pageCount: 5 }));

  it('accepts every page exactly once', () => {
    const skill = fivePages();
    const result = execute(skill, call('set_page_order', { order: [5, 4, 3, 2, 1] }));

    expect(result.isError).toBeFalsy();
    expect(skill.plan().order).toEqual([5, 4, 3, 2, 1]);
    expect(skill.plan().entries[0]!.impact).toBe('layout');
  });

  it('refuses a short list instead of silently deleting pages', () => {
    const skill = fivePages();
    const result = execute(skill, call('set_page_order', { order: [1, 2, 3, 4] }));

    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/every page exactly once/);
    expect(skill.plan().order).toBeNull();
  });

  it('refuses duplicates', () => {
    const skill = fivePages();
    const result = execute(skill, call('set_page_order', { order: [1, 1, 2, 3, 5] }));

    expect(result.isError).toBe(true);
    expect(skill.plan().order).toBeNull();
  });
});

describe('claimed-action guard', () => {
  it('recognizes first-person, bare-past and done claims', () => {
    expect(looksLikeEditClaim('I highlighted the date on page 1.')).toBe(true);
    expect(looksLikeEditClaim('Replaced “A” with “B”.')).toBe(true);
    expect(looksLikeEditClaim('Done — the page numbers are added.')).toBe(true);
  });

  it('does not treat honest failures or questions as claims', () => {
    expect(looksLikeEditClaim("I couldn't find that text on page 1.")).toBe(false);
    expect(looksLikeEditClaim('I did not change anything.')).toBe(false);
    expect(looksLikeEditClaim('I can highlight it if you want.')).toBe(false);
    expect(looksLikeEditClaim('The document has three pages.')).toBe(false);
    expect(looksLikeEditClaim('Done reading the document. It has three pages.')).toBe(false);
  });

  it('forces a corrective turn when a claim has no queued change', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    skill.skill.buildContext?.();

    const correction = skill.skill.verifyResponse?.(
      'I highlighted “Quarterly Report” on page 1.',
      [],
    );
    expect(correction).toBeTruthy();
    expect(correction).toMatch(/no edit tool succeeded/i);
  });

  it('accepts a claim after a successful edit tool', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    skill.skill.buildContext?.();
    execute(skill, call('markup_text', { page: 1, text: 'Quarterly Report' }));

    const correction = skill.skill.verifyResponse?.('Highlighted “Quarterly Report”.', [
      { name: 'markup_text', ok: true },
    ]);
    expect(correction).toBeNull();
  });
});

describe('layout-sensitive changes are labelled', () => {
  it('marks insertion, rotation and numbering as layout', () => {
    const skill = createPdfEditSkill(doc([[run('Quarterly Report 2026')]]));
    execute(skill, call('insert_text', { page: 1, text: 'Draft' }));
    execute(skill, call('rotate_pages', { degrees: 90, pages: [1] }));
    execute(skill, call('add_page_numbers', {}));

    const impacts = skill.plan().entries.map((entry) => [entry.kind, entry.impact]);
    expect(impacts).toEqual([
      ['insert', 'layout'],
      ['rotate', 'layout'],
      ['stamp', 'layout'],
    ]);
  });
});
