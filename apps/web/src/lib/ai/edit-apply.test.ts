import { describe, expect, it, vi } from 'vitest';

/**
 * The apply pipeline's post-condition. The engine jobs already re-parse their
 * own output; this is the additional invariant the AI layer owns: the page
 * count the engine reports must match the plan's expectation at every step,
 * so a truncated organize step can never be downloaded as a success.
 */
const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/job-pool', () => ({ jobPool: { run } }));

import { applyEditPlan, emptyEditPlan } from './edit-skill';

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'report.pdf', {
  type: 'application/pdf',
});

describe('applyEditPlan page-count guard', () => {
  it('refuses an organize step that produced fewer pages than requested', async () => {
    const plan = emptyEditPlan();
    plan.order = [1, 2, 3];
    run.mockResolvedValueOnce({
      data: new ArrayBuffer(4),
      fileName: 'report-edited.pdf',
      pageCount: 2,
    });

    await expect(applyEditPlan(file, plan, { pageCount: 5 })).rejects.toThrow(
      /produced 2 pages where 3 were expected/i,
    );
  });

  it('refuses a text-edit step that changed the page count', async () => {
    const plan = emptyEditPlan();
    plan.intents.push({
      id: 'ai-1',
      pageIndex: 0,
      find: 'Quarterly Report 2026',
      replace: 'Quarterly Summary 2026',
      box: { x: 10, y: 10, width: 200, height: 12 },
      fallbackIds: [],
    });
    run.mockResolvedValueOnce({
      data: new ArrayBuffer(4),
      fileName: 'report-edited.pdf',
      pageCount: 4,
    });

    await expect(applyEditPlan(file, plan, { pageCount: 5 })).rejects.toThrow(
      /produced 4 pages where 5 were expected/i,
    );
  });

  it('returns the engine-reported page count on a clean run', async () => {
    const plan = emptyEditPlan();
    plan.order = [1, 2, 3];
    run.mockResolvedValueOnce({
      data: new ArrayBuffer(4),
      fileName: 'report-edited.pdf',
      pageCount: 3,
    });

    const result = await applyEditPlan(file, plan, { pageCount: 5 });
    expect(result.pageCount).toBe(3);
    expect(result.name).toBe('report-edited.pdf');
  });
});
