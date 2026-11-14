import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

import {
  largestBytes,
  readAsInputFiles,
  readAsInputFilesOrToast,
  shortName,
  totalBytes,
} from './files';

afterEach(() => {
  toastError.mockClear();
});

/** A File stand-in: readAsInputFiles only touches name, type and arrayBuffer. */
function fakeFile(
  init: { name: string; type?: string; bytes?: Uint8Array; fail?: Error },
): File {
  return {
    name: init.name,
    type: init.type ?? 'application/pdf',
    arrayBuffer: init.fail
      ? () => Promise.reject(init.fail)
      : () => Promise.resolve((init.bytes ?? new Uint8Array([1, 2, 3])).buffer),
  } as unknown as File;
}

describe('readAsInputFiles', () => {
  it('maps picked files to job input files with fresh bytes', async () => {
    const input = await readAsInputFiles([fakeFile({ name: 'a.pdf' })]);
    expect(input).toEqual([
      { name: 'a.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
    ]);
  });

  it('rejects when a file read fails (the failure mode callers guard against)', async () => {
    await expect(
      readAsInputFiles([
        fakeFile({ name: 'a.pdf', fail: new Error('NotReadableError') }),
      ]),
    ).rejects.toThrow('NotReadableError');
  });
});

describe('readAsInputFilesOrToast', () => {
  it('returns the input on success and stays silent', async () => {
    const input = await readAsInputFilesOrToast([fakeFile({ name: 'a.pdf' })]);
    expect(input).toEqual([
      { name: 'a.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('returns null and toasts once when a read fails, instead of rejecting', async () => {
    const input = await readAsInputFilesOrToast([
      fakeFile({ name: 'fine.pdf' }),
      // One unreadable file (renamed after picking, locked, volume gone) used
      // to escape as an unhandled rejection and strand the tool.
      fakeFile({ name: 'gone.pdf', fail: new Error('NotReadableError') }),
    ]);
    expect(input).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      'Could not read the selected file. Try picking it again.',
    );
  });
});

describe('file helpers', () => {
  it('totalBytes and largestBytes measure the picked set', () => {
    const a = { size: 30 } as File;
    const b = { size: 50 } as File;
    expect(totalBytes([a, b])).toBe(80);
    expect(largestBytes([a, b])).toBe(50);
  });

  it('shortName keeps the extension and truncates long names', () => {
    expect(shortName('a.pdf')).toBe('a.pdf');
    expect(shortName('x'.repeat(50) + '.pdf')).toMatch(/\.pdf$/);
    expect(shortName('x'.repeat(50) + '.pdf').length).toBeLessThanOrEqual(42);
  });
});
