/**
 * One editor session for every PDF tool.
 *
 * The session is the single source of truth for the open document view and the
 * overlay document: page, zoom, active tool, selection, page order, changes,
 * undo/redo and save state. Tools integrate by reading this session and by
 * declaring capabilities in `editor-tools.ts`; none of them own a second
 * viewport, history stack or save path.
 *
 * The PDF engine and its worker contract are deliberately untouched. This
 * module holds UI state only, so the proven text/redaction pipeline keeps
 * receiving exactly the document it received before.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { type EditorDoc, useEditorDoc } from '@/lib/editor-state';
import {
  defaultToolForMode,
  toolDef,
  type EditorMode,
  type EditorTool,
  type EditorToolDef,
} from '@/lib/editor-tools';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EditorSession {
  readonly mode: EditorMode;
  readonly tool: EditorTool;
  readonly toolCapability: EditorToolDef;
  setTool(tool: EditorTool): void;

  readonly zoom: number;
  setZoom(zoom: number): void;
  readonly currentPage: number;
  setCurrentPage(page: number): void;
  readonly railOpen: boolean;
  toggleRail(open?: boolean): void;

  readonly selectedId: string | null;
  setSelectedId(id: string | null): void;
  readonly editingId: string | null;
  setEditingId(id: string | null): void;

  /** Original page indices in display order. Identity when nothing moved. */
  readonly pageOrder: number[];
  setPageOrder(order: number[]): void;
  resetPageOrder(pageCount: number): void;
  readonly pageOrderDirty: boolean;

  readonly doc: EditorDoc;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  apply: ReturnType<typeof useEditorDoc>['apply'];
  live: ReturnType<typeof useEditorDoc>['live'];
  beginTx: ReturnType<typeof useEditorDoc>['beginTx'];
  endTx: ReturnType<typeof useEditorDoc>['endTx'];
  undo: ReturnType<typeof useEditorDoc>['undo'];
  redo: ReturnType<typeof useEditorDoc>['redo'];
  reset: ReturnType<typeof useEditorDoc>['reset'];

  readonly saveStatus: SaveStatus;
  setSaveStatus(status: SaveStatus): void;
  readonly dirty: boolean;
  setDirty(dirty: boolean): void;
}

/**
 * Creates the session. The overlay document keeps its existing snapshot
 * history (`useEditorDoc`); this hook adds the view, selection and page-order
 * state that used to live privately inside the Edit PDF tool.
 */
export function useEditorSession(mode: EditorMode, pageCount = 0): EditorSession {
  const editor = useEditorDoc();
  const [tool, setToolState] = useState<EditorTool>(() => defaultToolForMode(mode));
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pageOrder, setPageOrderState] = useState<number[]>(() =>
    Array.from({ length: pageCount }, (_, index) => index),
  );
  const [pageOrderDirty, setPageOrderDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dirty, setDirty] = useState(false);
  const baselineOrder = useRef<number[]>(Array.from({ length: pageCount }, (_, i) => i));

  const setTool = useCallback((next: EditorTool) => {
    setToolState(next);
    // Selecting a tool retires object text editing; a tool must not inherit a
    // textarea that belongs to the previous interaction.
    setEditingId(null);
  }, []);

  const setPageOrder = useCallback((order: number[]) => {
    setPageOrderState(order);
    const base = baselineOrder.current;
    setPageOrderDirty(
      order.length !== base.length || order.some((page, index) => page !== base[index]),
    );
  }, []);

  const resetPageOrder = useCallback((count: number) => {
    const identity = Array.from({ length: count }, (_, index) => index);
    baselineOrder.current = identity;
    setPageOrderState(identity);
    setPageOrderDirty(false);
  }, []);

  const toggleRail = useCallback((open?: boolean) => {
    setRailOpen((previous) => open ?? !previous);
  }, []);

  const toolCapability = useMemo(() => toolDef(tool), [tool]);

  return {
    mode,
    tool,
    toolCapability,
    setTool,
    zoom,
    setZoom,
    currentPage,
    setCurrentPage,
    railOpen,
    toggleRail,
    selectedId,
    setSelectedId,
    editingId,
    setEditingId,
    pageOrder,
    setPageOrder,
    resetPageOrder,
    pageOrderDirty,
    doc: editor.doc,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    apply: editor.apply,
    live: editor.live,
    beginTx: editor.beginTx,
    endTx: editor.endTx,
    undo: editor.undo,
    redo: editor.redo,
    reset: editor.reset,
    saveStatus,
    setSaveStatus,
    dirty,
    setDirty,
  };
}
