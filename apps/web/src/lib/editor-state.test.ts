/**
 * Transaction semantics for the editor history.
 *
 * The real hook needs React state, so this file runs `useEditorDoc` against a
 * tiny synchronous hook runtime. GitHub-style gestures (drag, nudge, typing)
 * call `beginTx()` once and then only `live()`; `endTx()` must add exactly one
 * checkpoint. A gesture that also calls `apply()` inside the transaction pushes
 * the pre-gesture snapshot twice, which makes the first undo appear to do
 * nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let index = 0;
  return {
    begin(): void {
      index = 0;
    },
    reset(): void {
      state.length = 0;
      refs.length = 0;
      index = 0;
    },
    useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
      const cell = index++;
      if (!(cell in state)) {
        state[cell] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const set = (value: T | ((previous: T) => T)): void => {
        state[cell] = typeof value === 'function' ? (value as (previous: T) => T)(state[cell] as T) : value;
      };
      return [state[cell] as T, set];
    },
    useRef<T>(initial: T): { current: T } {
      const cell = index++;
      if (!(cell in refs)) refs[cell] = { current: initial };
      return refs[cell] as { current: T };
    },
    useCallback<T>(fn: T): T {
      return fn;
    },
  };
});

vi.mock('react', () => ({
  useState: runtime.useState,
  useRef: runtime.useRef,
  useCallback: runtime.useCallback,
}));

import { useEditorDoc, type EditorDoc } from './editor-state';

function render(): ReturnType<typeof useEditorDoc> {
  runtime.begin();
  return useEditorDoc();
}

describe('editor history transactions', () => {
  beforeEach(() => runtime.reset());

  it('adds one checkpoint for a beginTx/live/endTx gesture', () => {
    let editor = render();
    const move = (doc: EditorDoc): EditorDoc => ({
      ...doc,
      objects: [
        {
          id: 'o1',
          kind: 'text',
          pageIndex: 0,
          x: 10,
          y: 10,
          width: 40,
          height: 16,
          text: 'x',
          fontSize: 12,
        },
      ],
    });

    // The nudge gesture path: one checkpoint for the whole burst.
    editor.beginTx();
    editor.live(move);
    editor.endTx();

    editor = render();
    expect(editor.doc.objects).toHaveLength(1);
    expect(editor.canUndo).toBe(true);

    editor.undo();
    editor = render();
    expect(editor.doc.objects).toHaveLength(0);
    // One undo is enough; a duplicate checkpoint left canUndo true here.
    expect(editor.canUndo).toBe(false);
  });

  it('undo and redo restore the exact snapshots', () => {
    let editor = render();
    const first: EditorDoc = { objects: [], formValues: { a: '1' } };
    const second: EditorDoc = { objects: [], formValues: { a: '2' } };
    editor.apply(first);
    editor = render();
    editor.apply(second);
    editor = render();

    editor.undo();
    editor = render();
    expect(editor.doc).toBe(first);
    editor.redo();
    editor = render();
    expect(editor.doc).toBe(second);
  });
});
