import { describe, expect, it } from 'vitest';
import { EDITOR_TOOL_DEFS, toolsForMode } from '@/lib/editor-tools';
import {
  EDITOR_SHORTCUTS,
  matchEditorShortcut,
  shortcutsForMode,
  type ShortcutContext,
} from '@/lib/editor-shortcuts';

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {},
) {
  return {
    key: value,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

const context: ShortcutContext = {
  typing: false,
  hasObject: false,
  hasTextSelection: false,
  hasObjectClipboard: false,
  findOpen: false,
  saving: false,
  canEdit: true,
};

describe('editor shortcut registry', () => {
  it('publishes one binding for every tool shortcut', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      if (!tool.shortcut) continue;
      const match = matchEditorShortcut(key(tool.shortcut), context);
      expect(match?.tool, tool.id).toBe(tool.id);
    }
  });

  it('keeps the undocumented S alias working without listing it', () => {
    const match = matchEditorShortcut(key('s'), context);
    expect(match?.tool).toBe('select');
    expect(shortcutsForMode('edit', new Set(toolsForMode('edit').map((tool) => tool.id)))).not.toContainEqual(
      expect.objectContaining({ id: 'tool-select-alias' }),
    );
  });

  it('resolves document commands regardless of the active tool', () => {
    expect(matchEditorShortcut(key('f', { ctrlKey: true }), context)?.id).toBe('find');
    expect(matchEditorShortcut(key('f', { metaKey: true }), context)?.id).toBe('find');
    expect(matchEditorShortcut(key('s', { ctrlKey: true }), context)?.id).toBe('save');
    expect(matchEditorShortcut(key('z', { ctrlKey: true }), context)?.id).toBe('undo');
    expect(matchEditorShortcut(key('Z', { ctrlKey: true, shiftKey: true }), context)?.id).toBe(
      'redo',
    );
    expect(matchEditorShortcut(key('y', { ctrlKey: true }), context)?.id).toBe('redo-alt');
  });

  it('distinguishes fit width from fit page', () => {
    expect(matchEditorShortcut(key('0', { ctrlKey: true }), context)?.id).toBe('fit-width');
    expect(matchEditorShortcut(key('0', { ctrlKey: true, shiftKey: true }), context)?.id).toBe(
      'fit-page',
    );
  });

  it('requires the context a command actually needs', () => {
    expect(matchEditorShortcut(key('Delete'), context)).toBeNull();
    expect(matchEditorShortcut(key('Delete'), { ...context, hasObject: true })?.id).toBe('delete');
    expect(
      matchEditorShortcut(key('Backspace'), { ...context, hasTextSelection: true })?.id,
    ).toBe('delete');
    expect(matchEditorShortcut(key('v', { ctrlKey: true }), context)).toBeNull();
    expect(
      matchEditorShortcut(key('v', { ctrlKey: true }), {
        ...context,
        hasObjectClipboard: true,
      })?.id,
    ).toBe('paste');
  });

  it('does not arm tools while typing', () => {
    expect(matchEditorShortcut(key('t'), { ...context, typing: true })).toBeNull();
  });

  it('copies and cuts either kind of selection', () => {
    expect(matchEditorShortcut(key('c', { ctrlKey: true }), context)).toBeNull();
    expect(
      matchEditorShortcut(key('c', { ctrlKey: true }), { ...context, hasObject: true })?.id,
    ).toBe('copy');
    expect(
      matchEditorShortcut(key('x', { ctrlKey: true }), { ...context, hasTextSelection: true })?.id,
    ).toBe('cut');
  });

  it('keeps every visible id unique', () => {
    const visible = EDITOR_SHORTCUTS.filter((shortcut) => !shortcut.hidden);
    const ids = visible.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
