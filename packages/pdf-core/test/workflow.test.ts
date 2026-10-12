import { describe, expect, it } from 'vitest';

import { validateWorkflow, WORKFLOW_OUTPUT_JOBS } from '../src/workflow.js';
import { JOB_SLUGS, isKnownJobSlug } from '../src/jobs/slugs.js';
import { LIMITS } from '../src/limits.js';
import { JOBS } from '../src/jobs/registry.js';

/** A minimal valid one-step recipe, so each test can vary one thing. */
function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'My workflow',
    steps: [{ id: 's1', tool: 'merge' }],
    ...overrides,
  };
}

function issuesOf(result: ReturnType<typeof validateWorkflow>): string[] {
  return result.ok ? [] : result.issues.map((i) => `${i.field}: ${i.message}`);
}

describe('validateWorkflow', () => {
  it('accepts a recipe whose steps name real jobs', () => {
    const result = validateWorkflow(recipe());
    expect(result.ok).toBe(true);
  });

  it('accepts a chain that consumes an earlier step', () => {
    const result = validateWorkflow(
      recipe({
        steps: [
          { id: 'merge', tool: 'merge' },
          { id: 'stamp', tool: 'stamp', input: { kind: 'step', stepId: 'merge' } },
          { id: 'zip', tool: 'split-by-pages', input: { kind: 'step', stepId: 'stamp' } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('lets a recipe end on an analysis tool', () => {
    // `inspect` cannot be chained *from*, but ending on it is the whole point.
    const result = validateWorkflow(
      recipe({ steps: [{ id: 'a', tool: 'merge' }, { id: 'b', tool: 'inspect', input: { kind: 'step', stepId: 'a' } }] }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a tool that is not registered', () => {
    const result = validateWorkflow(recipe({ steps: [{ id: 's1', tool: 'make-me-a-coffee' }] }));
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/Unknown tool/);
  });

  it('rejects duplicate step ids', () => {
    const result = validateWorkflow(
      recipe({ steps: [{ id: 'same', tool: 'merge' }, { id: 'same', tool: 'stamp' }] }),
    );
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/Duplicate step id/);
  });

  it('rejects an empty or whitespace-only step id', () => {
    expect(validateWorkflow(recipe({ steps: [{ id: '', tool: 'merge' }] })).ok).toBe(false);
    expect(validateWorkflow(recipe({ steps: [{ id: '   ', tool: 'merge' }] })).ok).toBe(false);
  });

  it('rejects a reference to a step that does not exist', () => {
    const result = validateWorkflow(
      recipe({ steps: [{ id: 'a', tool: 'merge', input: { kind: 'step', stepId: 'ghost' } }] }),
    );
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/must exist and appear before/);
  });

  it('rejects a forward reference, which is also what makes cycles impossible', () => {
    const result = validateWorkflow(
      recipe({
        steps: [
          { id: 'a', tool: 'merge', input: { kind: 'step', stepId: 'b' } },
          { id: 'b', tool: 'stamp', input: { kind: 'step', stepId: 'a' } },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/appear before/);
  });

  it('rejects a step consuming its own output', () => {
    const result = validateWorkflow(
      recipe({ steps: [{ id: 'a', tool: 'merge', input: { kind: 'step', stepId: 'a' } }] }),
    );
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/cannot consume its own output/);
  });

  it('rejects chaining from a tool that produces no document', () => {
    for (const tool of ['inspect', 'thumbnails', 'text-runs', 'pdf-to-images']) {
      const result = validateWorkflow(
        recipe({
          steps: [
            { id: 'a', tool },
            { id: 'b', tool: 'merge', input: { kind: 'step', stepId: 'a' } },
          ],
        }),
      );
      expect(result.ok, `${tool} should not be chainable`).toBe(false);
      expect(issuesOf(result).join(' ')).toMatch(/does not produce a document/);
    }
  });

  it('only lists registered, document-producing tools as chainable', () => {
    for (const slug of WORKFLOW_OUTPUT_JOBS) {
      expect(Object.prototype.hasOwnProperty.call(JOBS, slug), `${slug} is not a registered job`).toBe(true);
    }
  });

  it('keeps every chainable tool a registered job rather than a guess', () => {
    // Guards the hand-written list against the registry it mirrors.
    expect([...WORKFLOW_OUTPUT_JOBS].every((slug) => isKnownJobSlug(slug))).toBe(true);
  });

  it('derives its slug list from the registry, so the two cannot drift', () => {
    // `slugs.ts` exists only to keep pdf-lib out of the main bundle; this is the
    // check that keeps it honest.
    expect([...JOB_SLUGS].sort()).toEqual(Object.keys(JOBS).sort());
    for (const slug of JOB_SLUGS) expect(isKnownJobSlug(slug)).toBe(true);
    expect(isKnownJobSlug('not-a-real-tool')).toBe(false);
  });

  it('requires at least one step', () => {
    expect(validateWorkflow(recipe({ steps: [] })).ok).toBe(false);
    expect(validateWorkflow(recipe({ steps: 'nope' })).ok).toBe(false);
    expect(validateWorkflow(recipe({ steps: undefined })).ok).toBe(false);
  });

  it('enforces the step cap', () => {
    const steps = Array.from({ length: LIMITS.workflow.maxSteps + 1 }, (_, i) => ({
      id: `s${i}`,
      tool: 'merge',
    }));
    const result = validateWorkflow(recipe({ steps }));
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/at most/);
  });

  it('accepts exactly the step cap', () => {
    const steps = Array.from({ length: LIMITS.workflow.maxSteps }, (_, i) => ({
      id: `s${i}`,
      tool: 'merge',
    }));
    expect(validateWorkflow(recipe({ steps })).ok).toBe(true);
  });

  it('requires a usable name', () => {
    expect(validateWorkflow(recipe({ name: '' })).ok).toBe(false);
    expect(validateWorkflow(recipe({ name: '   ' })).ok).toBe(false);
    expect(validateWorkflow(recipe({ name: undefined })).ok).toBe(false);
    expect(
      validateWorkflow(recipe({ name: 'x'.repeat(LIMITS.workflow.maxNameChars + 1) })).ok,
    ).toBe(false);
  });

  it('rejects a version it does not understand', () => {
    expect(validateWorkflow(recipe({ version: 2 })).ok).toBe(false);
    expect(validateWorkflow(recipe({ version: undefined })).ok).toBe(false);
  });

  it('reports a malformed document instead of throwing', () => {
    // Stored recipes come back as untrusted JSON; validation is the boundary.
    for (const junk of [null, undefined, 42, 'recipe', [], { steps: [null] }, { steps: [42] }]) {
      expect(() => validateWorkflow(junk)).not.toThrow();
      expect(validateWorkflow(junk).ok).toBe(false);
    }
  });

  it('rejects a step with a bad input shape', () => {
    const result = validateWorkflow(recipe({ steps: [{ id: 'a', tool: 'merge', input: { kind: 'elsewhere' } }] }));
    expect(result.ok).toBe(false);
    expect(issuesOf(result).join(' ')).toMatch(/Input must reference/);
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = validateWorkflow({
      version: 9,
      name: '',
      steps: [{ id: 'a', tool: 'nope' }, { id: 'a', tool: 'also-nope' }],
    });
    expect(result.ok).toBe(false);
    expect(issuesOf(result).length).toBeGreaterThanOrEqual(4);
  });
});
