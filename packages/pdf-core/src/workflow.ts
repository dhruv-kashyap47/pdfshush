/**
 * Workflow recipes.
 *
 * A workflow is a saved, ordered list of tool runs. It is a *description*, never
 * an executor: the browser pool runs it locally and the server queue can run it
 * remotely, because both already consume the same `JobDefinition` contract.
 *
 * Validation lives here, in the engine, on purpose. A recipe that one runtime
 * accepts and the other rejects is a bug that only shows up after a user has
 * saved it, so the rules have exactly one owner and one test suite.
 *
 * Recipes are persisted (IndexedDB while anonymous, account storage later) and
 * therefore come back as untrusted JSON. `validateWorkflow` is written to report
 * a malformed document rather than throw on it.
 */

import type { ValidationIssue, ValidationResult } from './job.js';
import { isKnownJobSlug } from './jobs/slugs.js';
import { LIMITS } from './limits.js';

/** Input for a step: the files the user supplied, or an earlier step's output. */
export type WorkflowInput = { kind: 'source' } | { kind: 'step'; stepId: string };

export interface WorkflowStep {
  /** Referenced by later steps; unique within the recipe. */
  id: string;
  /**
   * A registered job slug. A plain `string` rather than `JobSlug` because the
   * registry's keys derive from `JobDefinition.slug: string`, so `JobSlug`
   * widens to `string | number` and would not catch a typo anyway —
   * `validateWorkflow` checks membership in `JOB_SLUGS` instead.
   */
  tool: string;
  /** Defaults to the workflow's own source files. */
  input?: WorkflowInput;
  /** Forwarded to the job verbatim; the job validates its own shape at run time. */
  options?: Record<string, unknown>;
}

export interface Workflow {
  /** Bumped when the stored shape changes, so an old recipe can be migrated. */
  version: 1;
  name: string;
  steps: WorkflowStep[];
}

/**
 * Jobs whose output can feed another step.
 *
 * A later step may only consume an earlier one's *document* output. `inspect`,
 * `text-runs` and `thumbnails` answer questions about a document; `pdf-to-images`
 * produces pictures. None of them can be handed to a PDF tool as though it were
 * a PDF, so chaining from one is rejected up front instead of failing mid-run.
 *
 * The final step of a recipe may be any job — analysis and conversion are
 * perfectly good things to *end* on, they just cannot be built upon.
 */
export const WORKFLOW_OUTPUT_JOBS: ReadonlySet<string> = new Set([
  'edit',
  'merge',
  'organize',
  'split-by-pages',
  'split-in-half',
  'stamp',
  'n-up',
  // Client-side document jobs shipped with the plain-tools batch (PLAN.md
  // changelog, 2026-10-20). All produce a document a later step may consume.
  'flip',
  'watermark',
  'edit-metadata',
  'remove-annotations',
  'resize',
  'grayscale',
  'flatten',
  // Next-tools batch (2026-10-21): document-in, document-out.
  'bates-numbering',
  'compress',
  'rename',
  'unlock',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(field: string, message: string): ValidationIssue {
  return { field, message };
}

/**
 * Structural and graph checks for a stored recipe. It cannot validate a step's
 * `options` — those are checked by the job itself once real input exists.
 */
export function validateWorkflow(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('workflow', 'A workflow must be an object')] };
  }

  const issues: ValidationIssue[] = [];
  const { maxSteps, maxNameChars, maxStepIdChars } = LIMITS.workflow;

  if (input.version !== 1) {
    issues.push(issue('version', 'Unsupported workflow version; expected 1'));
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length === 0) {
    issues.push(issue('name', 'Give the workflow a name'));
  } else if (name.length > maxNameChars) {
    issues.push(issue('name', `Name is longer than ${maxNameChars} characters`));
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return { ok: false, issues: [...issues, issue('steps', 'Add at least one step')] };
  }
  const steps: unknown[] = input.steps;
  if (steps.length > maxSteps) {
    issues.push(issue('steps', `A workflow can have at most ${maxSteps} steps`));
  }

  // Walk in order so "must appear earlier" needs no separate cycle search: a
  // reference to a later step is simply not in `seenTools` yet.
  const seenTools = new Map<string, string>();
  steps.forEach((rawStep: unknown, index: number) => {
    const at = `steps[${index}]`;

    if (!isRecord(rawStep)) {
      issues.push(issue(at, 'A step must be an object'));
      return;
    }

    const id = typeof rawStep.id === 'string' ? rawStep.id.trim() : '';
    if (id.length === 0) {
      issues.push(issue(`${at}.id`, 'Every step needs an id'));
    } else if (id.length > maxStepIdChars) {
      issues.push(issue(`${at}.id`, `Step id is longer than ${maxStepIdChars} characters`));
    } else if (seenTools.has(id)) {
      issues.push(issue(`${at}.id`, `Duplicate step id "${id}"`));
    }

    const tool = typeof rawStep.tool === 'string' ? rawStep.tool : '';
    if (tool.length === 0) {
      issues.push(issue(`${at}.tool`, 'Every step needs a tool'));
    } else if (!isKnownJobSlug(tool)) {
      issues.push(issue(`${at}.tool`, `Unknown tool "${tool}"`));
    }

    const stepInput = rawStep.input;
    if (stepInput !== undefined) {
      if (!isRecord(stepInput) || (stepInput.kind !== 'source' && stepInput.kind !== 'step')) {
        issues.push(issue(`${at}.input`, 'Input must reference "source" or an earlier step'));
      } else if (stepInput.kind === 'step') {
        const ref = typeof stepInput.stepId === 'string' ? stepInput.stepId.trim() : '';
        if (ref.length === 0) {
          issues.push(issue(`${at}.input.stepId`, 'A step reference needs a step id'));
        } else if (ref === id) {
          issues.push(issue(`${at}.input.stepId`, `Step "${id}" cannot consume its own output`));
        } else if (!seenTools.has(ref)) {
          // Either it does not exist, or it comes later. Both are unrepresentable
          // at run time, and refusing a forward edge here is also what makes a
          // cycle impossible.
          issues.push(
            issue(`${at}.input.stepId`, `Step "${ref}" must exist and appear before this step`),
          );
        } else if (!WORKFLOW_OUTPUT_JOBS.has(seenTools.get(ref) ?? '')) {
          issues.push(
            issue(
              `${at}.input.stepId`,
              `Step "${ref}" does not produce a document another step can use`,
            ),
          );
        }
      }
    }

    if (id.length > 0) seenTools.set(id, tool);
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
