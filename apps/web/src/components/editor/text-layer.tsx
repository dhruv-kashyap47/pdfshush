/**
 * Structured text overlay: hover, block/paragraph selection, drag selection and
 * the inline paragraph editor.
 *
 * This layer sits above the raster and below form widgets / editable objects.
 * It never scans glyphs on pointer moves -- `PageInteractionModel` owns the
 * spatial indexes -- and it keeps its own transient hover state so moving the
 * pointer over one page does not re-render the rest of a long document.
 *
 * Editing is deliberately a native `<textarea>`: the browser already gives us a
 * caret, word/character selection, drag selection, clipboard and native undo.
 * The structured model remains the immutable source of truth; only the commit
 * turns the typed text into whiteout + text objects.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { BBox, PageInteractionModel, PageLayout } from '@pdfshush/pdf-core';
import type { EditorTool } from '@/components/editor/editor-toolbar';
import {
  cssFontStack,
  paragraphLineHeightRatio,
  paragraphSelectionState,
  resolveClickCount,
  selectionFromAnchors,
  wordSelectionAt,
  type ClickTracker,
  type ParagraphEditState,
  type TextSelectionState,
} from '@/lib/text-editing';

export interface TextLayerProps {
  layout: PageLayout;
  model: PageInteractionModel;
  zoom: number;
  tool: EditorTool;
  readOnly: boolean;
  /** Selection owned by the editor, or null when it belongs to another page. */
  selection: TextSelectionState | null;
  selectedBlockId: string | null;
  /** Non-null only while this page's paragraph is being edited. */
  editing: ParagraphEditState | null;
  /**
   * Text objects already placed on this page. In the text tool their overlay is
   * not interactive, so the layer must let the click through instead of editing
   * the original paragraph underneath.
   */
  claimedTextBoxes?: readonly BBox[];

  onBlockSelect: (blockId: string | null) => void;
  onParagraphEdit: (
    paragraphId: string,
    selection: { start: number; end: number } | null,
  ) => void;
  onSelectionChange: (selection: TextSelectionState | null) => void;
  onTextInput: (text: string, paragraphId: string, token: number) => void;
  onCommitEdit: (text: string, paragraphId: string, token: number) => void;
  onCancelEdit: (paragraphId: string, token: number) => void;
}

interface HoverState {
  blockId: string | null;
  paragraphId: string | null;
}

interface DragState {
  anchor: { paragraphId: string; offset: number };
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

const DRAG_SLOP_PX = 3;
/**
 * A double click opens the editor, but a triple click must select the
 * paragraph. The browser fires `dblclick` after the second click, before the
 * third arrives, so the edit is deferred briefly; a third pointerdown cancels
 * it. 220 ms is below the usual double-click-to-edit expectation while still
 * catching a deliberate triple click.
 */
const DOUBLE_CLICK_EDIT_DELAY_MS = 220;

export const TextLayer = memo(function TextLayer(props: TextLayerProps) {
  const { layout, zoom, tool, readOnly, selection, selectedBlockId, editing } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const claimedRef = useRef(props.claimedTextBoxes);
  claimedRef.current = props.claimedTextBoxes;

  const active = !readOnly && tool === 'select';
  const overlayRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clickRef = useRef<ClickTracker | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragFrame = useRef<number | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const pendingHover = useRef<{ clientX: number; clientY: number } | null>(null);
  const focusedWhileEditing = useRef(false);
  const cancelled = useRef(false);
  const doubleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDoubleClick = useRef<{
    paragraphId: string;
    range: { start: number; end: number } | null;
  } | null>(null);
  // Stable identity: the listener is added from one render and may be removed
  // by an effect or timer created in another.
  const outsideCancel = useRef((event: PointerEvent) => {
    const overlay = overlayRef.current;
    if (overlay && event.target instanceof Node && overlay.contains(event.target)) return;
    if (doubleClickTimer.current !== null) {
      clearTimeout(doubleClickTimer.current);
      doubleClickTimer.current = null;
    }
    pendingDoubleClick.current = null;
    window.removeEventListener('pointerdown', outsideCancel.current, true);
  });

  const [hover, setHover] = useState<HoverState>({ blockId: null, paragraphId: null });

  const blockById = useMemo(
    () => new Map(layout.blocks.map((block) => [block.id, block])),
    [layout.blocks],
  );
  const paragraphById = useMemo(
    () => new Map(layout.paragraphs.map((paragraph) => [paragraph.id, paragraph])),
    [layout.paragraphs],
  );
  const paragraphToBlock = useMemo(() => {
    const map = new Map<string, string>();
    for (const block of layout.blocks) {
      for (const paragraphId of block.paragraphIds) map.set(paragraphId, block.id);
    }
    return map;
  }, [layout.blocks]);

  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const page = overlayRef.current?.parentElement;
    if (!page) return { x: 0, y: 0 };
    const rect = page.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }, [zoom]);

  const tolerance = Math.max(1, 2.5 / Math.max(0.25, zoom));

  function pointIsClaimed(point: { x: number; y: number }): boolean {
    const boxes = claimedRef.current;
    if (!boxes || boxes.length === 0) return false;
    for (const box of boxes) {
      if (
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height
      ) {
        return true;
      }
    }
    return false;
  }

  // Window listeners outlive a render, so the handlers themselves must keep
  // their identity across renders. Everything mutable is read through a ref.
  const pointRef = useRef(pointFromClient);
  pointRef.current = pointFromClient;
  const toleranceRef = useRef(tolerance);
  toleranceRef.current = tolerance;
  const dragHandlers = useRef({
    move(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const p = propsRef.current;
      if (
        !drag.moved &&
        Math.abs(event.clientX - drag.startClientX) <= DRAG_SLOP_PX &&
        Math.abs(event.clientY - drag.startClientY) <= DRAG_SLOP_PX
      ) {
        return;
      }
      drag.moved = true;
      // Selection updates are cheap on this page but not free; coalesce pointer
      // moves to one update per frame, like the hover pass.
      const framePoint = { clientX: event.clientX, clientY: event.clientY };
      if (dragFrame.current !== null) return;
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null;
        const point = pointRef.current(framePoint.clientX, framePoint.clientY);
        const caret = p.model.caretAt(point, toleranceRef.current * 2);
        if (!caret) return;
        const next = selectionFromAnchors(
          p.model,
          p.layout.index,
          drag.anchor,
          { paragraphId: caret.paragraphId, offset: caret.paragraphOffset },
        );
        propsRef.current.onSelectionChange(next);
      });
    },
    end() {
      const drag = dragRef.current;
      dragRef.current = null;
      if (dragFrame.current !== null) {
        cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
      }
      window.removeEventListener('pointermove', dragHandlers.current.move);
      window.removeEventListener('pointerup', dragHandlers.current.end);
      window.removeEventListener('pointercancel', dragHandlers.current.end);
      if (!drag || drag.moved) return;
      // A press without movement is a block click; the block was selected on
      // pointerdown and there is no text range to show.
      const p = propsRef.current;
      if (p.selection) p.onSelectionChange(null);
    },
  });

  /** Clears transient hover when the layer stops being interactive. */
  useEffect(() => {
    if (!active) {
      setHover({ blockId: null, paragraphId: null });
      cancelPendingDoubleClick();
    }
  }, [active]);

  useEffect(
    () => () => {
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
      if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
      cancelPendingDoubleClick();
      window.removeEventListener('pointermove', dragHandlers.current.move);
      window.removeEventListener('pointerup', dragHandlers.current.end);
      window.removeEventListener('pointercancel', dragHandlers.current.end);
    },
    [],
  );

  function cancelPendingDoubleClick() {
    if (doubleClickTimer.current !== null) {
      clearTimeout(doubleClickTimer.current);
      doubleClickTimer.current = null;
    }
    pendingDoubleClick.current = null;
    window.removeEventListener('pointerdown', outsideCancel.current, true);
  }

  /* -------------------------------------------------------------- drag select */

  function stopDrag() {
    if (dragFrame.current !== null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    dragRef.current = null;
    window.removeEventListener('pointermove', dragHandlers.current.move);
    window.removeEventListener('pointerup', dragHandlers.current.end);
    window.removeEventListener('pointercancel', dragHandlers.current.end);
  }

  function beginDrag(point: { x: number; y: number }, paragraphId: string, clientX: number, clientY: number) {
    const p = propsRef.current;
    const caret = p.model.caretAt(point, tolerance);
    dragRef.current = {
      anchor: caret
        ? { paragraphId: caret.paragraphId, offset: caret.paragraphOffset }
        : { paragraphId, offset: 0 },
      startClientX: clientX,
      startClientY: clientY,
      moved: false,
    };
    window.addEventListener('pointermove', dragHandlers.current.move);
    window.addEventListener('pointerup', dragHandlers.current.end);
    window.addEventListener('pointercancel', dragHandlers.current.end);
  }

  /* ------------------------------------------------------------------ hover */

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || dragRef.current) return;
    pendingHover.current = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrame.current !== null) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null;
      const pending = pendingHover.current;
      if (!pending) return;
      const p = propsRef.current;
      const point = pointFromClient(pending.clientX, pending.clientY);
      if (pointIsClaimed(point)) {
        setHover((previous) =>
          previous.blockId === null && previous.paragraphId === null
            ? previous
            : { blockId: null, paragraphId: null },
        );
        return;
      }
      const hit = p.model.hitTest(point, tolerance);
      const paragraphId = hit.paragraph?.id ?? null;
      const blockId = hit.block?.id ?? (paragraphId ? paragraphToBlock.get(paragraphId) ?? null : null);
      setHover((previous) =>
        previous.blockId === blockId && previous.paragraphId === paragraphId
          ? previous
          : { blockId, paragraphId },
      );
    });
  }

  function onPointerLeave() {
    if (dragRef.current) return;
    setHover((previous) =>
      previous.blockId === null && previous.paragraphId === null
        ? previous
        : { blockId: null, paragraphId: null },
    );
  }

  /* -------------------------------------------------------------- pointerdown */

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || event.button !== 0) return;
    const p = propsRef.current;
    const point = pointFromClient(event.clientX, event.clientY);
    if (pointIsClaimed(point)) return;
    const hit = p.model.hitTest(point, tolerance);
    const paragraph = hit.paragraph;
    if (!paragraph) {
      // Empty page: let the page's own handler clear selection or start an
      // Add Text draw. Hover is cleared so a stale outline does not linger.
      cancelPendingDoubleClick();
      setHover({ blockId: null, paragraphId: null });
      clickRef.current = null;
      return;
    }

    const blockId = hit.block?.id ?? paragraphToBlock.get(paragraph.id) ?? null;
    const tracker = resolveClickCount(clickRef.current, {
      time: event.timeStamp || Date.now(),
      x: event.clientX,
      y: event.clientY,
      key: paragraph.id,
    });
    clickRef.current = tracker;

    event.stopPropagation();

    if (p.tool === 'text') {
      cancelPendingDoubleClick();
      // Add-or-edit text: a click on existing text opens the paragraph editor
      // at the caret. Empty space still falls through to the create gesture.
      event.preventDefault();
      const caret = p.model.caretAt(point, tolerance);
      p.onBlockSelect(blockId);
      p.onSelectionChange(null);
      if (caret) {
        p.onParagraphEdit(caret.paragraphId, {
          start: caret.paragraphOffset,
          end: caret.paragraphOffset,
        });
      } else {
        p.onParagraphEdit(paragraph.id, null);
      }
      clickRef.current = null;
      return;
    }

    // Select tool: single click selects the block and seeds a potential drag,
    // double click opens the inline editor (below, in onDoubleClick), triple
    // click selects the whole paragraph.
    if (tracker.count >= 3) {
      cancelPendingDoubleClick();
      stopDrag();
      p.onBlockSelect(blockId);
      p.onSelectionChange(
        paragraphSelectionState(p.model, p.layout.index, paragraph.id),
      );
      return;
    }

    if (tracker.count === 2) {
      stopDrag();
      const word = wordSelectionAt(p.model, p.layout.index, point, tolerance);
      p.onBlockSelect(blockId);
      if (word) p.onSelectionChange(word.selection);
      return;
    }

    cancelPendingDoubleClick();
    p.onBlockSelect(blockId);
    p.onSelectionChange(null);
    beginDrag(point, paragraph.id, event.clientX, event.clientY);
  }

  /**
   * Runs after the browser's own double-click detection. Opening the editor
   * here (rather than on the second pointerdown) keeps a triple click able to
   * select the paragraph without briefly mounting a textarea.
   */
  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!active || propsRef.current.tool !== 'select') return;
    const p = propsRef.current;
    const point = pointFromClient(event.clientX, event.clientY);
    if (pointIsClaimed(point)) return;
    const hit = p.model.hitTest(point, tolerance);
    const paragraph = hit.paragraph;
    if (!paragraph) return;
    event.preventDefault();
    event.stopPropagation();
    const blockId = hit.block?.id ?? paragraphToBlock.get(paragraph.id) ?? null;
    const word = wordSelectionAt(p.model, p.layout.index, point, tolerance);
    p.onBlockSelect(blockId);
    if (word) p.onSelectionChange(word.selection);

    // Defer the edit so the browser can deliver a third click first. The
    // outside-pointerdown listener cancels the timer if focus moves elsewhere.
    cancelPendingDoubleClick();
    pendingDoubleClick.current = {
      paragraphId: paragraph.id,
      range: word?.range ?? null,
    };
    doubleClickTimer.current = setTimeout(() => {
      doubleClickTimer.current = null;
      const pending = pendingDoubleClick.current;
      pendingDoubleClick.current = null;
      window.removeEventListener('pointerdown', outsideCancel.current, true);
      if (!pending) return;
      const latest = propsRef.current;
      if (latest.readOnly) return;
      if (latest.tool !== 'select' && latest.tool !== 'text') return;
      latest.onParagraphEdit(pending.paragraphId, pending.range);
    }, DOUBLE_CLICK_EDIT_DELAY_MS);
    window.addEventListener('pointerdown', outsideCancel.current, true);
  }

  /* -------------------------------------------------------------- text editor */

  const editingParagraph = editing ? paragraphById.get(editing.paragraphId) ?? null : null;
  const editingRatio = editingParagraph
    ? paragraphLineHeightRatio(editingParagraph, layout)
    : 1.2;

  useEffect(() => {
    // Reset the guard when the session ends. Like the object textarea, clearing
    // it while `editing` is still true would swallow the real blur.
    if (!editing) {
      focusedWhileEditing.current = false;
      cancelled.current = false;
    }
  }, [editing]);

  useEffect(() => {
    if (!editing || !editingParagraph) return;
    const element = textareaRef.current;
    if (!element) return;
    cancelled.current = false;
    autoSize(element);
    element.focus();
    const max = element.value.length;
    element.setSelectionRange(
      Math.min(max, editing.initialSelection.start),
      Math.min(max, editing.initialSelection.end),
    );
    // Keyed on the edit token: reopening the same paragraph must re-apply the
    // new initial selection even though the element is reused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.token, editingParagraph?.id]);

  function autoSize(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    const min = editingParagraph
      ? Math.max(
          editingParagraph.bbox.height,
          editingParagraph.typography.fontSize * editingRatio,
        ) * zoom
      : 0;
    element.style.height = `${Math.max(min, element.scrollHeight)}px`;
  }

  const editorStyle: CSSProperties | null = editingParagraph
    ? {
        left: editingParagraph.bbox.x * zoom,
        top: editingParagraph.bbox.y * zoom,
        width:
          Math.max(
            editingParagraph.bbox.width + editingParagraph.typography.fontSize * 0.6,
            40,
          ) * zoom,
        minHeight:
          Math.max(
            editingParagraph.bbox.height,
            editingParagraph.typography.fontSize * editingRatio,
          ) * zoom,
        fontSize: editingParagraph.typography.fontSize * zoom,
        fontFamily: cssFontStack(editingParagraph.typography),
        fontStyle: editingParagraph.typography.italic ? 'italic' : 'normal',
        fontWeight: editingParagraph.typography.bold ? 700 : 400,
        lineHeight: editingRatio,
        textAlign:
          editingParagraph.alignment === 'center' || editingParagraph.alignment === 'right'
            ? editingParagraph.alignment
            : 'left',
      }
    : null;

  const hoverBlock = hover.blockId ? blockById.get(hover.blockId) ?? null : null;
  const hoverParagraph = hover.paragraphId ? paragraphById.get(hover.paragraphId) ?? null : null;
  const selectedBlock = selectedBlockId ? blockById.get(selectedBlockId) ?? null : null;
  const selectionForPage =
    selection && selection.pageIndex === layout.index ? selection : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ pointerEvents: active ? 'auto' : 'none' }}
      data-testid="editor-text-layer"
      data-page-index={layout.index}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
    >
      {/* Hover: a soft block outline plus a stronger paragraph tint. */}
      {hoverBlock && hoverBlock.id !== selectedBlockId ? (
        <div
          className="pointer-events-none absolute rounded-[2px] border border-dashed border-blue-500/35"
          style={{
            left: hoverBlock.bbox.x * zoom,
            top: hoverBlock.bbox.y * zoom,
            width: hoverBlock.bbox.width * zoom,
            height: hoverBlock.bbox.height * zoom,
          }}
          data-testid="editor-text-hover-block"
        />
      ) : null}
      {hoverParagraph && hoverParagraph.id !== editingParagraph?.id ? (
        <div
          className="pointer-events-none absolute rounded-[2px] bg-blue-500/[0.06] ring-1 ring-blue-500/20 ring-inset"
          style={{
            left: hoverParagraph.bbox.x * zoom,
            top: hoverParagraph.bbox.y * zoom,
            width: hoverParagraph.bbox.width * zoom,
            height: hoverParagraph.bbox.height * zoom,
          }}
          data-testid="editor-text-hover-paragraph"
        />
      ) : null}

      {selectedBlock ? (
        <div
          className="pointer-events-none absolute rounded-[3px] outline-2 outline-blue-600/70 outline-offset-[3px]"
          style={{
            left: selectedBlock.bbox.x * zoom,
            top: selectedBlock.bbox.y * zoom,
            width: selectedBlock.bbox.width * zoom,
            height: selectedBlock.bbox.height * zoom,
          }}
          data-testid="editor-text-block-selection"
        />
      ) : null}

      {selectionForPage?.ranges.map((range) =>
        range.rects.map((rect, index) => (
          <div
            key={`${range.paragraphId}-${index}`}
            className="pointer-events-none absolute rounded-[1px] bg-blue-500/25 mix-blend-multiply"
            style={{
              left: rect.x * zoom,
              top: rect.y * zoom,
              width: Math.max(1, rect.width) * zoom,
              height: Math.max(1, rect.height) * zoom,
            }}
            data-testid="editor-text-selection"
          />
        )),
      )}

      {editingParagraph && editing && editorStyle ? (
        <textarea
          key={`${editing.paragraphId}:${editing.token}`}
          ref={textareaRef}
          defaultValue={editing.initialText}
          spellCheck={false}
          autoFocus
          aria-label="Edit paragraph text"
          data-testid="editor-paragraph-input"
          data-paragraph-id={editing.paragraphId}
          className="absolute resize-none overflow-hidden rounded-[2px] border border-blue-500/70 bg-white/95 text-left text-neutral-900 outline-none transition-shadow focus:border-blue-600 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.18)]"
          style={{ ...editorStyle, boxSizing: 'border-box', padding: 0, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          onFocus={(event) => {
            focusedWhileEditing.current = true;
            const max = event.target.value.length;
            event.target.setSelectionRange(
              Math.min(max, editing.initialSelection.start),
              Math.min(max, editing.initialSelection.end),
            );
          }}
          onInput={(event) => {
            autoSize(event.currentTarget);
            propsRef.current.onTextInput(
              event.currentTarget.value,
              editing.paragraphId,
              editing.token,
            );
          }}
          onBlur={(event) => {
            if (!focusedWhileEditing.current || cancelled.current) return;
            focusedWhileEditing.current = false;
            propsRef.current.onCommitEdit(
              event.currentTarget.value,
              editing.paragraphId,
              editing.token,
            );
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            cancelled.current = true;
            propsRef.current.onCancelEdit(editing.paragraphId, editing.token);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      ) : null}
    </div>
  );
});
