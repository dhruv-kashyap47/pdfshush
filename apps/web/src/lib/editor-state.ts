/**
 * Editor document state: overlay objects + form values, with snapshot undo.
 *
 * The whole document is small plain data (image buffers aside), so undo/redo
 * keeps full snapshots -- replace-the-past is simpler and safer than patching
 * commands, and one undo always returns the exact previous view.
 *
 * History rules:
 * - `apply`  -- discrete changes (create/delete/style): push a checkpoint.
 * - `live`   -- in-flight gestures (drag, typing): mutate without a checkpoint.
 * - `beginTx`/`endTx` -- wrap a gesture: the pre-gesture snapshot is pushed
 *   once, on release, so a drag is a single undo step.
 */

import { useCallback, useRef, useState } from 'react';
import type { EditorObject } from '@pdfshush/pdf-core';

export interface EditorDoc {
  objects: EditorObject[];
  /** AcroForm values keyed by field name; changed live (not undoable per key). */
  formValues: Record<string, string | boolean>;
}

export const EMPTY_EDITOR_DOC: EditorDoc = { objects: [], formValues: {} };

interface HistoryState {
  doc: EditorDoc;
  past: EditorDoc[];
  future: EditorDoc[];
}

export function useEditorDoc() {
  const [history, setHistory] = useState<HistoryState>({
    doc: EMPTY_EDITOR_DOC,
    past: [],
    future: [],
  });
  const txSnapshot = useRef<EditorDoc | null>(null);

  /** Discrete change: pushes the pre-change doc onto the undo stack. */
  const apply = useCallback((next: EditorDoc | ((doc: EditorDoc) => EditorDoc)) => {
    setHistory((h) => {
      const doc = typeof next === 'function' ? next(h.doc) : next;
      if (doc === h.doc) return h;
      return { doc, past: [...h.past, h.doc], future: [] };
    });
  }, []);

  /** In-flight change (drag/typing): no history entry of its own. */
  const live = useCallback((next: (doc: EditorDoc) => EditorDoc) => {
    setHistory((h) => {
      const doc = next(h.doc);
      return doc === h.doc ? h : { ...h, doc };
    });
  }, []);

  /** Snapshot the doc at gesture start (idempotent until `endTx`). */
  const beginTx = useCallback(() => {
    setHistory((h) => {
      if (txSnapshot.current === null) txSnapshot.current = h.doc;
      return h;
    });
  }, []);

  /** Commit the gesture: one undo step, if anything actually changed. */
  const endTx = useCallback(() => {
    const snapshot = txSnapshot.current;
    txSnapshot.current = null;
    if (!snapshot) return;
    setHistory((h) =>
      h.doc === snapshot ? h : { ...h, past: [...h.past, snapshot], future: [] },
    );
  }, []);

  const undo = useCallback(() => {
    txSnapshot.current = null;
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1]!;
      return { doc: previous, past: h.past.slice(0, -1), future: [h.doc, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    txSnapshot.current = null;
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0]!;
      return { doc: next, past: [...h.past, h.doc], future: h.future.slice(1) };
    });
  }, []);

  return {
    doc: history.doc,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    apply,
    live,
    beginTx,
    endTx,
    undo,
    redo,
  } as const;
}
