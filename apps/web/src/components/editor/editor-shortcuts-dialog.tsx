/**
 * The keyboard sheet. It renders the same registry the window handler uses, so
 * an unlisted binding or a listed dead key cannot survive a review.
 */

import { useMemo } from 'react';
import { Command } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { EditorMode, EditorToolDef } from '@/lib/editor-tools';
import {
  EDITOR_SHORTCUT_NOTES,
  SHORTCUT_GROUPS,
  shortcutsForMode,
} from '@/lib/editor-shortcuts';

export interface EditorShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: EditorMode;
  tools: ReadonlyArray<EditorToolDef>;
}

export function EditorShortcutsDialog({
  open,
  onOpenChange,
  mode,
  tools,
}: EditorShortcutsDialogProps) {
  const rows = useMemo(
    () => shortcutsForMode(mode, new Set(tools.map((tool) => tool.id))),
    [mode, tools],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="editor-shortcuts-dialog grid max-h-[min(42rem,calc(100svh-2rem))] w-[min(40rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-border bg-card p-0"
        data-testid="editor-shortcuts-dialog"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
              <Command className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-sm font-semibold">Keyboard shortcuts</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                Every binding below is active in this workspace.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => {
              const groupRows = rows.filter((row) => row.group === group);
              if (groupRows.length === 0) return null;
              return (
                <section key={group} aria-label={group} className="min-w-0">
                  <h3 className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    {group}
                  </h3>
                  <dl className="flex flex-col gap-1.5">
                    {groupRows.map((row) => (
                      <div
                        key={row.id}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-md px-1.5 py-1 text-xs"
                      >
                        <dt className="min-w-0 truncate text-foreground/80">{row.label}</dt>
                        <dd className="flex shrink-0 items-center gap-1">
                          {row.keys.map((key) => (
                            <kbd key={key} className="editor-shortcut-key">
                              {key}
                            </kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>

          <div className="mt-5 border-t border-border pt-3">
            <h3 className="mb-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Gestures
            </h3>
            <dl className="flex flex-col gap-1.5">
              {EDITOR_SHORTCUT_NOTES.map((note) => (
                <div
                  key={note.keys}
                  className="flex items-center justify-between gap-3 px-1.5 text-xs"
                >
                  <dt className="text-foreground/80">{note.label}</dt>
                  <dd>
                    <kbd className="editor-shortcut-key">{note.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <footer className="border-t border-border px-5 py-2.5 text-[11px] text-muted-foreground">
          On macOS, use <kbd className="editor-shortcut-key">⌘</kbd> wherever{' '}
          <kbd className="editor-shortcut-key">Ctrl</kbd> is shown.
        </footer>
      </DialogContent>
    </Dialog>
  );
}
