import { describe, expect, it } from 'vitest';
import type { EditorObject } from '@pdfshush/pdf-core';
import {
  DRAFT_SCHEMA,
  DRAFT_STORE_KEY,
  draftSignature,
  draftSizeBytes,
  validateDraft,
  validateEditorDoc,
} from './editor-draft';

const textObject: EditorObject = {
  id: 't1',
  kind: 'text',
  role: 'content',
  pageIndex: 0,
  x: 72,
  y: 100,
  width: 120,
  height: 18,
  text: 'Replacement',
  fontSize: 11,
  native: {
    paragraphId: 'p1',
    before: 'Original',
    after: 'Replacement',
    beforeLines: [{ text: 'Original', box: { x: 72, y: 100, width: 80, height: 12 } }],
    reflow: { width: 120, lineHeight: 13, firstBaselineY: 110, x: 72 },
  },
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_STORE_KEY,
    schema: DRAFT_SCHEMA,
    updatedAt: 1_700_000_000_000,
    signature: 'doc.pdf\u00001024\u00001',
    name: 'doc.pdf',
    size: 1024,
    lastModified: 1,
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    doc: {
      objects: [textObject],
      formValues: { name: 'Ada' },
      paragraphRecords: [
        {
          pageIndex: 0,
          paragraphId: 'p1',
          before: 'Original',
          after: 'Replacement',
          objectIds: ['t1', 'w1'],
          plan: textObject.kind === 'text' ? textObject.native : undefined,
          styled: false,
          savedAt: 1,
        },
      ],
    },
    pageOrder: [0],
    currentPage: 0,
    zoom: 1,
    mode: 'edit',
    tool: 'select',
    orderDirty: false,
    ...overrides,
  };
}

describe('draft signature', () => {
  it('changes when any identity field changes', () => {
    const base = draftSignature({ name: 'a.pdf', size: 1, lastModified: 2 });
    expect(draftSignature({ name: 'a.pdf', size: 1, lastModified: 2 })).toBe(base);
    expect(draftSignature({ name: 'b.pdf', size: 1, lastModified: 2 })).not.toBe(base);
    expect(draftSignature({ name: 'a.pdf', size: 2, lastModified: 2 })).not.toBe(base);
    expect(draftSignature({ name: 'a.pdf', size: 1, lastModified: 3 })).not.toBe(base);
  });
});

describe('draft size', () => {
  it('counts source bytes, text and image payloads', () => {
    const image: EditorObject = {
      id: 'i1',
      kind: 'image',
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      data: new Uint8Array(1000),
      mimeType: 'image/png',
    };
    const size = draftSizeBytes(new Uint8Array(2000), {
      objects: [textObject, image],
      formValues: {},
    });
    expect(size).toBeGreaterThanOrEqual(3000);
  });
});

describe('draft validation', () => {
  it('accepts a complete, valid record', () => {
    const value = validateDraft(draft());
    expect(value).not.toBeNull();
    expect(value!.doc.objects).toHaveLength(1);
    expect(value!.doc.paragraphRecords).toHaveLength(1);
  });

  it('rejects an incompatible schema instead of migrating blindly', () => {
    expect(validateDraft(draft({ schema: 999 }))).toBeNull();
  });

  it('rejects an invalid mode or tool', () => {
    expect(validateDraft(draft({ mode: 'admin' }))).toBeNull();
    expect(validateDraft(draft({ tool: 'launch-missiles' }))).toBeNull();
  });

  it('rejects corrupt source bytes and bad page order', () => {
    expect(validateDraft(draft({ bytes: new Uint8Array(0) }))).toBeNull();
    expect(validateDraft(draft({ pageOrder: [0, 'one'] }))).toBeNull();
    expect(validateDraft(draft({ currentPage: -1 }))).toBeNull();
  });

  it('rejects an object whose native plan is malformed', () => {
    const broken = draft({
      doc: {
        objects: [
          {
            ...textObject,
            native: { before: 'x', after: 'y', beforeLines: [{ text: 'x', box: null }], reflow: {} },
          },
        ],
        formValues: {},
      },
    });
    expect(validateDraft(broken)).toBeNull();
  });

  it('rejects an invalid paragraph record', () => {
    const broken = draft({
      doc: {
        objects: [textObject],
        formValues: {},
        paragraphRecords: [{ pageIndex: 0, paragraphId: 'p1', before: 'x' }],
      },
    });
    expect(validateDraft(broken)).toBeNull();
  });

  it('accepts a restored document and preserves form values', () => {
    const document = validateEditorDoc({
      objects: [textObject],
      formValues: { agreed: true, name: 'Ada' },
    });
    expect(document).toEqual({
      objects: [textObject],
      formValues: { agreed: true, name: 'Ada' },
    });
  });

  it('rejects unknown object kinds and negative geometry', () => {
    expect(validateEditorDoc({ objects: [{ ...textObject, kind: 'malware' }], formValues: {} })).toBeNull();
    expect(validateEditorDoc({ objects: [{ ...textObject, width: -5 }], formValues: {} })).toBeNull();
    expect(validateEditorDoc({ objects: [{ ...textObject, pageIndex: -1 }], formValues: {} })).toBeNull();
  });
});
