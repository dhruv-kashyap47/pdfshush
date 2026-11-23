/**
 * Editor capability registry.
 *
 * Every tool that can edit a PDF declares what it needs from the shared
 * workspace here. The shell reads these records instead of hard-coding a
 * toolbar per tool, so text, AI, redaction, annotation and page organisation
 * all run inside one viewport, one selection model and one document session.
 *
 * The engine is untouched: a capability only describes *UI intent* and which
 * export path the workspace should use. The workers remain the authority on
 * validation, redaction and verification.
 */

import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  PenTool,
  Sparkles,
  Square,
  Stamp,
  Strikethrough,
  Type,
  Underline,
  X,
} from 'lucide-react';

/** The workspace a route opens with. */
export type EditorMode = 'edit' | 'sign' | 'ai' | 'redact' | 'organize';

export type EditorTool =
  | 'select'
  | 'text'
  | 'image'
  | 'signature'
  | 'highlight'
  | 'strikeout'
  | 'underline'
  | 'whiteout'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'check'
  | 'cross'
  | 'date'
  | 'stamp'
  | 'redact'
  | 'ai';

export type ToolGroup = 'edit' | 'insert' | 'markup' | 'shape' | 'mode';

/** A read-only proposal overlay reported by the assistant (currently AI). */
export interface EditorProposalMarker {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'mark' | 'text' | 'erase';
}

export interface EditorToolDef {
  id: EditorTool;
  label: string;
  /** Keyboard shortcut, single key, case-insensitive. */
  shortcut?: string;
  group: ToolGroup;
  icon: LucideIcon;
  /** Only show the tool in these workspaces; absent = every workspace. */
  modes?: ReadonlyArray<EditorMode>;
}

export const EDITOR_TOOL_DEFS: EditorToolDef[] = [
  {
    id: 'select',
    label: 'Select and move',
    shortcut: 'v',
    group: 'edit',
    icon: MousePointer2,
  },
  {
    id: 'text',
    label: 'Add or edit text',
    shortcut: 't',
    group: 'edit',
    icon: Type,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'ai',
    label: 'Edit with AI',
    shortcut: 'a',
    group: 'edit',
    icon: Sparkles,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'image',
    label: 'Insert image',
    shortcut: 'i',
    group: 'insert',
    icon: ImagePlus,
    modes: ['edit', 'sign'],
  },
  {
    id: 'signature',
    label: 'Insert signature',
    group: 'insert',
    icon: PenLine,
    modes: ['edit', 'sign'],
  },
  {
    id: 'highlight',
    label: 'Highlight',
    shortcut: 'h',
    group: 'markup',
    icon: Highlighter,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'strikeout',
    label: 'Strike through',
    group: 'markup',
    icon: Strikethrough,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'underline',
    label: 'Underline',
    group: 'markup',
    icon: Underline,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'whiteout',
    label: 'Whiteout, a cosmetic cover',
    group: 'markup',
    icon: Eraser,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'rect',
    label: 'Rectangle',
    group: 'shape',
    icon: Square,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    group: 'shape',
    icon: Circle,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'line',
    label: 'Line',
    group: 'shape',
    icon: Minus,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'arrow',
    label: 'Arrow',
    group: 'shape',
    icon: ArrowRight,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'pen',
    label: 'Pen',
    shortcut: 'p',
    group: 'shape',
    icon: PenTool,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'check',
    label: 'Check mark',
    shortcut: 'k',
    group: 'markup',
    icon: Check,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'cross',
    label: 'Cross mark',
    shortcut: 'x',
    group: 'markup',
    icon: X,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'date',
    label: 'Date stamp',
    shortcut: 'd',
    group: 'insert',
    icon: CalendarDays,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'stamp',
    label: 'Stamp',
    shortcut: 'm',
    group: 'insert',
    icon: Stamp,
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'redact',
    label: 'Redaction mark',
    shortcut: 'r',
    group: 'markup',
    icon: Eraser,
    modes: ['redact'],
  },
];

/** Tools this workspace exposes, in rail order. */
export function toolsForMode(mode: EditorMode): EditorToolDef[] {
  return EDITOR_TOOL_DEFS.filter((tool) => !tool.modes || tool.modes.includes(mode));
}

export function toolDef(id: EditorTool): EditorToolDef {
  return EDITOR_TOOL_DEFS.find((tool) => tool.id === id) ?? EDITOR_TOOL_DEFS[0]!;
}

/** Rail grouping labels; empty groups are never rendered. */
export const TOOL_GROUP_LABELS: Record<ToolGroup, string | null> = {
  edit: null,
  insert: 'Insert',
  markup: 'Mark',
  shape: 'Draw',
  mode: null,
};

export function defaultToolForMode(mode: EditorMode): EditorTool {
  if (mode === 'sign') return 'signature';
  if (mode === 'redact') return 'redact';
  if (mode === 'ai') return 'ai';
  return 'select';
}

/**
 * One-line, honest explanation for every tool. The context bar, the mobile
 * action sheet and the shortcut sheet read this record, so a newly added tool
 * cannot ship without copy.
 */
export const TOOL_HELP: Record<EditorTool, string> = {
  select: 'Select text or an object, then drag to move it. Double-click text to edit.',
  text: 'Click a paragraph to edit it in place, or drag on empty space to add a text box.',
  image: 'Click the page to place an image, then drag or use the corner handles.',
  signature: 'Click where the signature belongs, then draw, type or upload it.',
  highlight: 'Drag across a line to highlight it. The mark stays editable.',
  strikeout: 'Drag across a line to strike it through. The line itself is untouched.',
  underline: 'Drag across a line to underline it.',
  whiteout: 'Covers content with white paint. This is cosmetic, not redaction.',
  rect: 'Drag to draw a rectangle. Hold Shift for a square.',
  ellipse: 'Drag to draw an ellipse. Hold Shift for a circle.',
  line: 'Drag to draw a straight line.',
  arrow: 'Drag to draw an arrow from start to end.',
  pen: 'Draw freehand ink. The stroke is exported as vectors, not an image.',
  check: 'Click to place a check mark, or drag to size it.',
  cross: 'Click to place a cross mark, or drag to size it.',
  date: "Click to stamp today's date. It stays selectable and editable.",
  stamp: 'Choose a preset, then click the page to place a bordered stamp.',
  redact: 'Drag a permanent mark over content. Redaction rebuilds the page without it.',
  ai: 'Describe the change you want. Nothing is written until you review and apply.',
};

/** Tool-specific limitations that deserve more than a one-liner. */
export const TOOL_LIMITS: Partial<Record<EditorTool, string>> = {
  text: 'Native rewriting works for standard fonts and full or partial deletions. Embedded faces and styled extra lines fall back to a declared overlay, and the receipt names the fallback.',
  whiteout: 'Whiteout only paints over content. Use Redact when the underlying text must be removed from the file.',
  pen: 'Ink is capped at 5,000 points per stroke and is exported as vector segments.',
  redact: 'Redaction rasterises every page it touches, so selectable text, links and form fields are lost by design.',
};
