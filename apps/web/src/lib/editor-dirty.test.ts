import { describe, expect, it } from 'vitest';
import { editorIsDirty } from './editor-dirty';
import type { EditorDoc } from './editor-state';

const EMPTY: EditorDoc = { objects: [], formValues: {} };
const base = {
  doc: EMPTY,
  saved: null,
  paragraphEditActive: false,
  pageOrderDirty: false,
  redactMarkCount: 0,
} as const;

describe('editor dirty state', () => {
  it('is clean for a freshly opened document', () => {
    expect(editorIsDirty(base)).toBe(false);
  });

  it('is dirty while an inline paragraph edit has not been committed', () => {
    // The paragraph lives only in the textarea until commit; Back used to close
    // the document without warning because the overlay document was unchanged.
    expect(editorIsDirty({ ...base, paragraphEditActive: true })).toBe(true);
  });

  it('stays dirty until the snapshot that was actually saved', () => {
    const edited: EditorDoc = {
      objects: [
        { id: 't', kind: 'text', pageIndex: 0, x: 10, y: 10, width: 50, height: 20, text: 'x', fontSize: 12 },
      ],
      formValues: {},
    };
    expect(editorIsDirty({ ...base, doc: edited })).toBe(true);
    expect(editorIsDirty({ ...base, doc: edited, saved: edited })).toBe(false);
  });

  it('returns to clean after saving form values (they used to pin it dirty)', () => {
    const filled: EditorDoc = { objects: [], formValues: { 'person.name': 'Grace Hopper' } };
    expect(editorIsDirty({ ...base, doc: filled })).toBe(true);
    expect(editorIsDirty({ ...base, doc: filled, saved: filled })).toBe(false);
  });

  it('reports page-order and redaction work', () => {
    expect(editorIsDirty({ ...base, pageOrderDirty: true })).toBe(true);
    expect(editorIsDirty({ ...base, redactMarkCount: 2 })).toBe(true);
  });
});
