import { describe, expect, it } from 'vitest';
import type { EditorObject } from '@pdfshush/pdf-core';
import { cloneObjectForPaste, detachEditIntent } from './object-copy';

const plan = {
  before: 'original',
  after: 'replacement',
  beforeLines: [{ text: 'original', box: { x: 10, y: 20, width: 100, height: 12 } }],
  reflow: { width: 100, lineHeight: 12, firstBaselineY: 30, x: 10 },
};

function textObject(): EditorObject {
  return {
    kind: 'text',
    id: 't1',
    pageIndex: 0,
    x: 10,
    y: 20,
    width: 120,
    height: 18,
    text: 'replacement',
    fontSize: 12,
    native: plan,
    inPlace: { find: 'original', box: { x: 10, y: 20, width: 100, height: 12 }, coverId: 'w1' },
  };
}

describe('detachEditIntent', () => {
  it('drops both paragraph and in-place intents from a copied text object', () => {
    const copy = detachEditIntent(textObject());
    expect(copy.kind).toBe('text');
    expect(copy).not.toHaveProperty('native');
    expect(copy).not.toHaveProperty('inPlace');
    // Everything that makes it a visible object survives.
    if (copy.kind === 'text') {
      expect(copy.text).toBe('replacement');
      expect(copy.fontSize).toBe(12);
      expect(copy.x).toBe(10);
    }
  });

  it('drops a paragraph-deletion intent from a copied whiteout', () => {
    const whiteout: EditorObject = {
      kind: 'whiteout',
      id: 'w1',
      pageIndex: 0,
      x: 10,
      y: 20,
      width: 100,
      height: 12,
      native: plan,
    };
    expect(detachEditIntent(whiteout)).not.toHaveProperty('native');
  });

  it('returns already-independent objects by identity', () => {
    const ink: EditorObject = {
      kind: 'ink',
      id: 'i1',
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [{ x: 0, y: 0 }],
    };
    expect(detachEditIntent(ink)).toBe(ink);
    const plainText = { ...textObject(), native: undefined, inPlace: undefined } as EditorObject;
    expect(detachEditIntent(plainText)).toBe(plainText);
  });
});

describe('cloneObjectForPaste', () => {
  it('deep-copies image bytes instead of sharing them', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const image: EditorObject = {
      kind: 'image',
      id: 'img',
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      data,
      mimeType: 'image/png',
    };
    const copy = cloneObjectForPaste(image);
    expect(copy.kind).toBe('image');
    if (copy.kind === 'image') {
      expect(copy.data).not.toBe(data);
      expect(Array.from(copy.data as Uint8Array)).toEqual([1, 2, 3, 4]);
    }
  });

  it('copies a paragraph edit without its rewrite intent', () => {
    const copy = cloneObjectForPaste(textObject());
    expect(copy).not.toHaveProperty('native');
    expect(copy).not.toHaveProperty('inPlace');
  });
});
