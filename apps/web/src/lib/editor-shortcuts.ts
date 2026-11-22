/**
 * One keyboard registry for the whole editor.
 *
 * The shortcut sheet, the tool rail hints, the inspector's keyboard list and the
 * window-level handler all read this file. A binding that exists here is the
 * only place it is declared, so the sheet cannot advertise a key the handler
 * never sees (the old `s` select alias was the proof: it worked but was absent
 * from every list).
 *
 * Matching is intentionally explicit rather than a global key map: a shortcut
 * knows whether it needs a selected object, a text selection or the clipboard,
 * and the handler asks for a match after its typing/guard branches have run.
 */

import { EDITOR_TOOL_DEFS, type EditorTool } from '@/lib/editor-tools';

export type ShortcutGroup = 'Tools' | 'Document' | 'Edit' | 'View' | 'Navigate' | 'Help';

export interface ShortcutContext {
  /** Focus is in an input, textarea or contenteditable. */
  typing: boolean;
  hasObject: boolean;
  hasTextSelection: boolean;
  hasObjectClipboard: boolean;
  findOpen: boolean;
  saving: boolean;
  canEdit: boolean;
}

export interface EditorShortcutDef {
  id: string;
  group: ShortcutGroup;
  label: string;
  /** Human keycaps, in order (e.g. ['Ctrl', 'Shift', 'Z']). */
  keys: string[];
  /** Tool armed by this binding, when it is a tool shortcut. */
  tool?: EditorTool;
  /** Not listed in the shortcut sheet (an alias handled for compatibility). */
  hidden?: boolean;
  /** Extra hint shown under a group in the sheet. */
  note?: string;
  match: (event: KeyboardEvent, context: ShortcutContext) => boolean;
}

const mod = (event: KeyboardEvent) => event.ctrlKey || event.metaKey;
const key = (event: KeyboardEvent) => event.key.toLowerCase();
const plain = (event: KeyboardEvent) =>
  !mod(event) && !event.altKey && !event.ctrlKey && !event.metaKey;

function toolMatch(shortcut: string) {
  return (event: KeyboardEvent, context: ShortcutContext) =>
    !context.typing && plain(event) && key(event) === shortcut.toLowerCase();
}

function chord(matchKey: string, options: { shift?: boolean; alt?: boolean } = {}) {
  return (event: KeyboardEvent) => {
    if (!mod(event)) return false;
    if (options.shift === true && !event.shiftKey) return false;
    if (options.shift !== true && event.shiftKey) return false;
    if (Boolean(options.alt) !== event.altKey) return false;
    // `=` and `+` share a physical key; accept both spellings for zoom.
    if (matchKey === '=' && (key(event) === '=' || key(event) === '+')) return true;
    return key(event) === matchKey;
  };
}

const toolShortcuts: EditorShortcutDef[] = EDITOR_TOOL_DEFS.filter(
  (definition) => Boolean(definition.shortcut),
).map((definition) => ({
  id: `tool-${definition.id}`,
  group: 'Tools',
  label: definition.label,
  keys: [definition.shortcut!.toUpperCase()],
  tool: definition.id,
  match: toolMatch(definition.shortcut!),
}));

export const EDITOR_SHORTCUTS: ReadonlyArray<EditorShortcutDef> = [
  ...toolShortcuts,
  // `s` selected the Select tool for a long time without appearing in any list.
  // Keep it working, but secret: V is the documented binding.
  {
    id: 'tool-select-alias',
    group: 'Tools',
    label: 'Select and move (legacy alias)',
    keys: ['S'],
    tool: 'select',
    hidden: true,
    match: toolMatch('s'),
  },
  {
    id: 'find',
    group: 'Document',
    label: 'Find and replace',
    keys: ['Ctrl', 'F'],
    match: (event) => mod(event) && key(event) === 'f',
  },
  {
    id: 'save',
    group: 'Document',
    label: 'Save a verified copy',
    keys: ['Ctrl', 'S'],
    match: (event) => mod(event) && key(event) === 's',
  },
  {
    id: 'undo',
    group: 'Edit',
    label: 'Undo',
    keys: ['Ctrl', 'Z'],
    match: (event) => mod(event) && key(event) === 'z' && !event.shiftKey,
  },
  {
    id: 'redo',
    group: 'Edit',
    label: 'Redo',
    keys: ['Ctrl', 'Shift', 'Z'],
    match: (event) => mod(event) && key(event) === 'z' && event.shiftKey,
  },
  {
    id: 'redo-alt',
    group: 'Edit',
    label: 'Redo (Windows)',
    keys: ['Ctrl', 'Y'],
    hidden: true,
    match: (event) => mod(event) && key(event) === 'y',
  },
  {
    id: 'duplicate',
    group: 'Edit',
    label: 'Duplicate selected object',
    keys: ['Ctrl', 'D'],
    match: (event, context) => mod(event) && key(event) === 'd' && context.hasObject,
  },
  {
    id: 'copy',
    group: 'Edit',
    label: 'Copy selection',
    keys: ['Ctrl', 'C'],
    match: (event, context) =>
      mod(event) && key(event) === 'c' && (context.hasTextSelection || context.hasObject),
  },
  {
    id: 'cut',
    group: 'Edit',
    label: 'Cut selection',
    keys: ['Ctrl', 'X'],
    match: (event, context) =>
      mod(event) && key(event) === 'x' && (context.hasTextSelection || context.hasObject),
  },
  {
    id: 'paste',
    group: 'Edit',
    label: 'Paste',
    keys: ['Ctrl', 'V'],
    match: (event, context) =>
      mod(event) && key(event) === 'v' && context.hasObjectClipboard,
  },
  {
    id: 'delete',
    group: 'Edit',
    label: 'Delete selection',
    keys: ['Delete'],
    match: (event, context) =>
      !context.typing &&
      (event.key === 'Delete' || event.key === 'Backspace') &&
      (context.hasObject || context.hasTextSelection),
  },
  {
    id: 'zoom-in',
    group: 'View',
    label: 'Zoom in',
    keys: ['Ctrl', '+'],
    // Ctrl++ is Ctrl+Shift+= on most layouts, so this one ignores Shift.
    match: (event) => mod(event) && !event.altKey && (key(event) === '=' || key(event) === '+'),
  },
  {
    id: 'zoom-out',
    group: 'View',
    label: 'Zoom out',
    keys: ['Ctrl', '−'],
    match: chord('-'),
  },
  {
    id: 'fit-width',
    group: 'View',
    label: 'Fit page width',
    keys: ['Ctrl', '0'],
    match: chord('0'),
  },
  {
    id: 'fit-page',
    group: 'View',
    label: 'Fit whole page',
    keys: ['Ctrl', 'Shift', '0'],
    match: chord('0', { shift: true }),
  },
  {
    id: 'prev-page',
    group: 'Navigate',
    label: 'Previous page',
    keys: ['Page Up'],
    match: (event, context) => !context.typing && event.key === 'PageUp',
  },
  {
    id: 'next-page',
    group: 'Navigate',
    label: 'Next page',
    keys: ['Page Down'],
    match: (event, context) => !context.typing && event.key === 'PageDown',
  },
  {
    id: 'help',
    group: 'Help',
    label: 'Keyboard shortcuts',
    keys: ['?'],
    match: (event, context) =>
      !context.typing &&
      !mod(event) &&
      (event.key === '?' || (event.key === '/' && event.shiftKey)),
  },
];

/** Extra gestures that are modifiers, not dispatchable commands. */
export const EDITOR_SHORTCUT_NOTES: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '↑ ↓ ← →', label: 'Nudge the selected object (Shift for 10 pt)' },
  { keys: 'Alt', label: 'Hold while moving to bypass snap guides' },
  { keys: 'Esc', label: 'Close a panel, cancel a drag, or clear the selection' },
];

/**
 * Resolve the first binding that matches, in registry order. The handler keeps
 * its own typing/Escape guards; this function only maps a key event to a named
 * action so the switch below has one obvious home per shortcut.
 */
export function matchEditorShortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
): EditorShortcutDef | null {
  for (const shortcut of EDITOR_SHORTCUTS) {
    if (shortcut.match(event, context)) return shortcut;
  }
  return null;
}

/** Groups in the order the shortcut sheet renders them. */
export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  'Tools',
  'Document',
  'Edit',
  'View',
  'Navigate',
  'Help',
];

/**
 * The sheet is generated from the same records the handler uses. Tools not in
 * the current workspace are filtered out rather than listed as dead keys.
 */
export function shortcutsForMode(_mode: string, availableTools: ReadonlySet<string>) {
  return EDITOR_SHORTCUTS.filter((shortcut) => {
    if (shortcut.hidden) return false;
    if (shortcut.tool && !availableTools.has(shortcut.tool)) return false;
    return true;
  });
}
