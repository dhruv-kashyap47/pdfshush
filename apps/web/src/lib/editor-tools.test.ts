import { describe, expect, test } from 'vitest';
import {
  EDITOR_TOOL_DEFS,
  defaultToolForMode,
  toolDef,
  toolsForMode,
  type EditorMode,
} from './editor-tools';

describe('editor capability registry', () => {
  test('every tool id is unique', () => {
    const ids = EDITOR_TOOL_DEFS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every workspace opens with a tool it actually offers', () => {
    const modes: EditorMode[] = ['edit', 'sign', 'ai', 'redact', 'organize'];
    for (const mode of modes) {
      const tools = toolsForMode(mode).map((tool) => tool.id);
      expect(tools).toContain(defaultToolForMode(mode));
    }
  });

  test('redaction exposes only selection and the destructive mark', () => {
    expect(toolsForMode('redact').map((tool) => tool.id)).toEqual(['select', 'redact']);
    expect(toolDef('redact').capability.export).toBe('redact');
  });

  test('page organisation does not offer document markup', () => {
    expect(toolsForMode('organize').map((tool) => tool.id)).toEqual(['select']);
  });

  test('the assistant and text tools are available in the editing workspaces', () => {
    for (const mode of ['edit', 'sign', 'ai'] as const) {
      const ids = toolsForMode(mode).map((tool) => tool.id);
      expect(ids).toContain('ai');
      expect(ids).toContain('text');
    }
  });

  test('tool lookups always resolve', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(toolDef(tool.id)).toBe(tool);
    }
  });

  test('history capability is declared for every tool', () => {
    for (const tool of EDITOR_TOOL_DEFS) {
      expect(typeof tool.capability.history).toBe('boolean');
      expect(tool.capability.controls).toBeInstanceOf(Array);
    }
  });
});
