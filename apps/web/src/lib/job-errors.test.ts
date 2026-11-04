/**
 * The error vocabulary is the only place the product decides what a failure
 * means. If it regresses, every tool's toast regresses at once, so the mapping
 * is pinned here rather than left to the browser suites (which cannot easily
 * make a worker throw a specific class).
 */

import { describe, expect, it } from 'vitest';
import { describeJobError } from './job-errors';

/** Mirrors what `job-pool` rebuilds after a worker hop: name + message + issues. */
function reconstructed(
  name: string,
  message: string,
  issues?: { field?: string; message: string }[],
): Error {
  const error = new Error(message);
  error.name = name;
  if (issues) (error as Error & { issues?: unknown }).issues = issues;
  return error;
}

describe('describeJobError', () => {
  it('treats a cancelled run as cancelled, not as a failure', () => {
    const info = describeJobError(reconstructed('JobAbortedError', 'Operation cancelled'));
    expect(info.code).toBe('cancelled');
    expect(info.retryable).toBe(false);
    expect(info.message).toContain('Nothing was changed');
  });

  it('uses the validation issues instead of the useless "Invalid input" label', () => {
    const info = describeJobError(
      reconstructed('JobValidationError', 'Invalid input', [
        { message: 'Choose an open password' },
        { message: 'Use at least 8 characters for the open password' },
      ]),
    );
    expect(info.code).toBe('validation');
    expect(info.message).toContain(
      'Choose an open password Use at least 8 characters for the open password',
    );
    expect(info.message).not.toContain('Invalid input');
    expect(info.message).toContain('Adjust the highlighted settings');
    expect(info.issues).toHaveLength(2);
  });

  it('keeps the engine sentence for an encrypted file without repeating it', () => {
    const info = describeJobError(
      reconstructed('EncryptedDocumentError', 'This PDF is password protected'),
    );
    expect(info.code).toBe('encrypted');
    expect(info.retryable).toBe(false);
    expect(info.message).toContain('This PDF is password protected');
    expect(info.message).not.toContain('This PDF is password protected This PDF');
    expect(info.action).toContain('Unlock');
    // The action is part of the toast text, not just structured metadata, and
    // it is joined with a sentence break rather than a run-on.
    expect(info.message).toContain(info.action!);
    expect(info.message).toContain('protected. Unlock');
  });

  it('names a wrong password as a retryable-by-the-user action', () => {
    const info = describeJobError(
      reconstructed('EncryptedDocumentError', 'Incorrect password for this PDF'),
    );
    expect(info.code).toBe('encrypted');
    expect(info.action).toContain('Re-enter the password');
  });

  it('preserves a refusal message because it names the failed safety checks', () => {
    const detail =
      'Refusing to export: the document could not be rebuilt safely.\n  - canvas-unavailable: no rasterizer';
    const info = describeJobError(reconstructed('RedactionUnsafeError', detail));
    expect(info.code).toBe('refused');
    expect(info.message).toContain(detail);
    expect(info.message).toContain('Nothing was exported');
    expect(info.action).toContain('Nothing was exported');
  });

  it('classifies a limit breach and keeps the number the engine named', () => {
    const info = describeJobError(new Error('At most 50 files fit in one run'));
    expect(info.code).toBe('too-large');
    expect(info.retryable).toBe(true);
    expect(info.message).toContain('At most 50 files fit in one run');
    expect(info.message).toContain('in-browser limit');
  });

  it('classifies an unreadable file as damaged', () => {
    const info = describeJobError(new Error('Invalid PDF structure'));
    expect(info.code).toBe('damaged');
    expect(info.retryable).toBe(false);
    expect(info.message).toContain('Invalid PDF structure');
  });

  it('classifies a failed fetch as a network problem', () => {
    const info = describeJobError(new TypeError('Failed to fetch'));
    expect(info.code).toBe('network');
    expect(info.retryable).toBe(true);
  });

  it('uses the AI code for a generic AI-tool failure', () => {
    const info = describeJobError(new Error('the model returned no content'), {
      slug: 'summarize-pdf',
    });
    expect(info.code).toBe('ai');
    expect(info.retryable).toBe(true);
  });

  it('does not let the AI context swallow a damaged-file failure', () => {
    const info = describeJobError(new Error('Invalid PDF structure'), {
      slug: 'summarize-pdf',
    });
    expect(info.code).toBe('damaged');
  });

  it('falls back to internal for an unclassified engine error', () => {
    const info = describeJobError(new Error('Unexpected token in object 42'));
    expect(info.code).toBe('internal');
    expect(info.retryable).toBe(true);
    expect(info.message).toContain('Unexpected token in object 42');
  });

  it('survives a thrown non-Error value', () => {
    const info = describeJobError('boom');
    expect(info.code).toBe('internal');
    expect(info.message).toContain('boom');
    expect(info.detail).toBe('boom');
  });
});
