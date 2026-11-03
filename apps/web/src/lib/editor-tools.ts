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
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  Sparkles,
  Square,
  Strikethrough,
  Type,
  Underline,
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
  | 'redact'
  | 'ai';

export type ToolGroup = 'edit' | 'insert' | 'markup' | 'shape' | 'mode';

export type SelectionKind = 'object' | 'text' | 'region' | 'page' | 'none';

/** A read-only proposal overlay reported by a capability (currently AI). */
export interface EditorProposalMarker {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  tone: 'mark' | 'text' | 'erase';
}

export interface ToolCapability {
  /** What a successful gesture produces. */
  produces: SelectionKind;
  /** Which contextual controls the shell may show. */
  controls: ReadonlyArray<'type' | 'mark' | 'shape' | 'pages' | 'ai' | 'redact'>;
  /** Whether changes made by this tool enter the object undo history. */
  history: boolean;
  /** Export pipeline selected when the user saves with this tool active. */
  export: 'edit' | 'redact' | 'organize' | 'ai';
}

export interface EditorToolDef {
  id: EditorTool;
  label: string;
  /** Keyboard shortcut, single key, case-insensitive. */
  shortcut?: string;
  group: ToolGroup;
  icon: LucideIcon;
  capability: ToolCapability;
  /** Only show the tool in these workspaces; absent = every workspace. */
  modes?: ReadonlyArray<EditorMode>;
}

const CONTROLS = {
  type: ['type'],
  mark: ['mark'],
  shape: ['shape'],
  pages: ['pages'],
  ai: ['ai'],
  redact: ['redact'],
} as const;

export const EDITOR_TOOL_DEFS: EditorToolDef[] = [
  {
    id: 'select',
    label: 'Select and move',
    shortcut: 'v',
    group: 'edit',
    icon: MousePointer2,
    capability: { produces: 'object', controls: [], history: true, export: 'edit' },
  },
  {
    id: 'text',
    label: 'Add or edit text',
    shortcut: 't',
    group: 'edit',
    icon: Type,
    capability: { produces: 'text', controls: CONTROLS.type, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'ai',
    label: 'Edit with AI',
    shortcut: 'a',
    group: 'edit',
    icon: Sparkles,
    capability: { produces: 'none', controls: CONTROLS.ai, history: true, export: 'ai' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'image',
    label: 'Insert image',
    shortcut: 'i',
    group: 'insert',
    icon: ImagePlus,
    capability: { produces: 'object', controls: [], history: true, export: 'edit' },
    modes: ['edit', 'sign'],
  },
  {
    id: 'signature',
    label: 'Insert signature',
    group: 'insert',
    icon: PenLine,
    capability: { produces: 'object', controls: [], history: true, export: 'edit' },
    modes: ['edit', 'sign'],
  },
  {
    id: 'highlight',
    label: 'Highlight',
    shortcut: 'h',
    group: 'markup',
    icon: Highlighter,
    capability: { produces: 'region', controls: CONTROLS.mark, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'strikeout',
    label: 'Strike through',
    group: 'markup',
    icon: Strikethrough,
    capability: { produces: 'region', controls: CONTROLS.mark, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'underline',
    label: 'Underline',
    group: 'markup',
    icon: Underline,
    capability: { produces: 'region', controls: CONTROLS.mark, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'whiteout',
    label: 'Whiteout, a cosmetic cover',
    group: 'markup',
    icon: Eraser,
    capability: { produces: 'region', controls: CONTROLS.mark, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'rect',
    label: 'Rectangle',
    group: 'shape',
    icon: Square,
    capability: { produces: 'region', controls: CONTROLS.shape, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    group: 'shape',
    icon: Circle,
    capability: { produces: 'region', controls: CONTROLS.shape, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'line',
    label: 'Line',
    group: 'shape',
    icon: Minus,
    capability: { produces: 'region', controls: CONTROLS.shape, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'arrow',
    label: 'Arrow',
    group: 'shape',
    icon: ArrowRight,
    capability: { produces: 'region', controls: CONTROLS.shape, history: true, export: 'edit' },
    modes: ['edit', 'sign', 'ai'],
  },
  {
    id: 'redact',
    label: 'Redaction mark',
    shortcut: 'r',
    group: 'markup',
    icon: Eraser,
    capability: {
      produces: 'region',
      controls: CONTROLS.redact,
      history: true,
      export: 'redact',
    },
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

/** Short, honest label for the active tool used in the status bar. */
export function toolStatusLabel(id: EditorTool): string {
  switch (id) {
    case 'select':
      return 'Select';
    case 'text':
      return 'Text';
    case 'image':
      return 'Image';
    case 'signature':
      return 'Signature';
    case 'highlight':
      return 'Highlight';
    case 'strikeout':
      return 'Strike through';
    case 'underline':
      return 'Underline';
    case 'whiteout':
      return 'Whiteout';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'line':
      return 'Line';
    case 'arrow':
      return 'Arrow';
    case 'redact':
      return 'Redact';
    case 'ai':
      return 'Edit with AI';
  }
}
