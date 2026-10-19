/**
 * The one rule both MCP surfaces depend on: a slug becomes the tool name the
 * agent sees. It is duplicated nowhere (the dialog and `/tools/mcp` share
 * `mcp-catalog.ts`), but a wrong mapping here would silently misname every
 * tool on the page, so it is pinned.
 */

import { describe, expect, it } from 'vitest';
import { mcpToolName } from './mcp-catalog';

describe('mcpToolName', () => {
  it('turns API slugs into the pdfshush_* tool names the server registers', () => {
    expect(mcpToolName('inspect')).toBe('pdfshush_inspect');
    expect(mcpToolName('split-by-pages')).toBe('pdfshush_split_by_pages');
    expect(mcpToolName('split-in-half')).toBe('pdfshush_split_in_half');
    expect(mcpToolName('n-up')).toBe('pdfshush_n_up');
    expect(mcpToolName('edit')).toBe('pdfshush_edit');
  });

  it('leaves an already-converted name alone', () => {
    expect(mcpToolName('pdfshush_merge')).toBe('pdfshush_merge');
  });

  it('never emits a dash, which no MCP tool name may contain', () => {
    for (const slug of ['merge', 'organize', 'stamp', 'split-by-pages', 'n-up']) {
      expect(mcpToolName(slug)).not.toContain('-');
    }
  });
});
