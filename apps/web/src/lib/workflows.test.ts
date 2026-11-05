import { describe, expect, it } from 'vitest';
import {
  hasNonFinalTerminalStep,
  relinkWorkflowSteps,
  type WorkflowStep,
} from './workflows';

const step = (id: string, tool = 'merge'): WorkflowStep => ({ id, tool });

describe('workflow step linking', () => {
  it('drops the first step input and points every later step at its predecessor', () => {
    const linked = relinkWorkflowSteps([
      { ...step('a'), input: { kind: 'source' } },
      { ...step('b'), input: { kind: 'source' } },
      step('c'),
    ]);

    expect(linked[0]?.input).toBeUndefined();
    expect(linked[1]?.input).toEqual({ kind: 'step', stepId: 'a' });
    expect(linked[2]?.input).toEqual({ kind: 'step', stepId: 'b' });
  });

  it('repairs references after a middle step is removed', () => {
    const original = relinkWorkflowSteps([step('a'), step('b'), step('c')]);
    const withoutMiddle = relinkWorkflowSteps(original.filter((entry) => entry.id !== 'b'));

    expect(withoutMiddle.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(withoutMiddle[1]?.input).toEqual({ kind: 'step', stepId: 'a' });
  });

  it('keeps the same references after a move', () => {
    const moved = relinkWorkflowSteps([step('a'), step('b'), step('c')]);
    const reordered = relinkWorkflowSteps([moved[1]!, moved[0]!, moved[2]!]);

    expect(reordered.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    expect(reordered[0]?.input).toBeUndefined();
    expect(reordered[1]?.input).toEqual({ kind: 'step', stepId: 'b' });
    expect(reordered[2]?.input).toEqual({ kind: 'step', stepId: 'a' });
  });
});

describe('terminal workflow jobs', () => {
  it('allows inspect or split-by-pages as the final step only', () => {
    expect(hasNonFinalTerminalStep([step('a', 'merge'), step('b', 'inspect')])).toBe(false);
    expect(hasNonFinalTerminalStep([step('a', 'inspect'), step('b', 'merge')])).toBe(true);
    expect(hasNonFinalTerminalStep([step('a', 'split-by-pages')])).toBe(false);
    expect(hasNonFinalTerminalStep([step('a', 'split-by-pages'), step('b', 'stamp')])).toBe(true);
  });
});
