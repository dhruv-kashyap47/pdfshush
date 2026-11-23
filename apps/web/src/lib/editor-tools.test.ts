import { describe, expect, test } from 'vitest';
import {
  EDITOR_TOOL_DEFS,
  TOOL_GROUP_LABELS,
  TOOL_HELP,
  TOOL_LIMITS,
  defaultToolForMode,
  toolDef,
  toolsForMode,
  type EditorMode,
} from './editor-tools';

const MODES: EditorMode[] = ['edit', 'sign', 'ai', 'redact', 'organize'];

describe('editor tool registry', () => {
  test('every tool id is unique', () => {
    const ids = EDITOR_TOOL_DEFS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every definition carries a label, icon, group and valid workspace list', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(tool.label.trim().length, `${tool.id} label`).toBeGreaterThan(0);
      expect(typeof tool.icon, `${tool.id} icon`).toBeDefined();
      expect(Object.keys(TOOL_GROUP_LABELS), `${tool.id} group`).toContain(tool.group);
      for (const mode of tool.modes ?? []) {
        expect(MODES, `${tool.id} mode ${mode}`).toContain(mode);
      }
    }
  });

  test('every workspace opens with a tool it actually offers', () => {
    for (const mode of MODES) {
      const tools = toolsForMode(mode).map((tool) => tool.id);
      expect(tools).toContain(defaultToolForMode(mode));
    }
  });

  test('no tool is orphaned from every workspace', () => {
    const offered = new Set(MODES.flatMap((mode) => toolsForMode(mode).map((tool) => tool.id)));
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(offered.has(tool.id), `${tool.id} is in at least one rail`).toBe(true);
    }
  });

  test('each workspace exposes exactly its intended rail', () => {
    const edit = [
      'select',
      'text',
      'ai',
      'image',
      'signature',
      'highlight',
      'strikeout',
      'underline',
      'whiteout',
      'rect',
      'ellipse',
      'line',
      'arrow',
      'pen',
      'check',
      'cross',
      'date',
      'stamp',
    ];
    expect(toolsForMode('edit').map((tool) => tool.id)).toEqual(edit);
    expect(toolsForMode('sign').map((tool) => tool.id)).toEqual(edit);
    expect(toolsForMode('ai').map((tool) => tool.id)).toEqual(
      edit.filter((id) => id !== 'image' && id !== 'signature'),
    );
    expect(toolsForMode('redact').map((tool) => tool.id)).toEqual(['select', 'redact']);
    expect(toolsForMode('organize').map((tool) => tool.id)).toEqual(['select']);
  });

  test('tool lookups always resolve', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(toolDef(tool.id)).toBe(tool);
    }
  });

  test('every declared shortcut is unique', () => {
    const shortcuts = EDITOR_TOOL_DEFS.map((tool) => tool.shortcut).filter(
      (shortcut): shortcut is string => Boolean(shortcut),
    );
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  test('every tool has help copy and no help entry is stale', () => {
    const ids = new Set(EDITOR_TOOL_DEFS.map((tool) => tool.id));
    expect(Object.keys(TOOL_HELP).sort()).toEqual([...ids].sort());
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(TOOL_HELP[tool.id].trim().length, `${tool.id} help`).toBeGreaterThan(0);
    }
  });

  test('tool limits only name real tools', () => {
    const ids = new Set(EDITOR_TOOL_DEFS.map((tool) => tool.id));
    for (const id of Object.keys(TOOL_LIMITS)) {
      expect(ids.has(id as (typeof EDITOR_TOOL_DEFS)[number]['id']), `${id} limit`).toBe(true);
    }
  });

  test('there is no dead capability metadata on the registry', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(tool).not.toHaveProperty('capability');
    }
  });
});
