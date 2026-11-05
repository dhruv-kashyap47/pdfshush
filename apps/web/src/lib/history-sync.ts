/**
 * Metadata-only history write-through.
 *
 * The account switch promises "sync history"; historically it copied the
 * browser's existing entries once and then stopped, so every later tool run
 * stayed local. This module keeps the preference in memory for the session and
 * mirrors new local entries to `/api/account/history` when it is on.
 *
 * The local IndexedDB write is still the source of truth for the UI. A failed
 * upload is swallowed: losing a server copy of a filename must never make a
 * finished PDF tool look broken.
 */

import { api } from '@/lib/api';
import type { RecentEntry } from '@/tools/recent';

let enabled = false;

export function setHistorySyncEnabled(value: boolean): void {
  enabled = Boolean(value);
}

export function historySyncEnabled(): boolean {
  return enabled;
}

export async function syncHistoryEntry(entry: RecentEntry): Promise<void> {
  if (!enabled) return;
  try {
    await api('/api/account/history', {
      method: 'POST',
      body: {
        toolSlug: entry.toolSlug,
        toolName: entry.toolName,
        fileName: entry.fileName,
        createdAt: entry.createdAt,
        clientId: entry.id,
        ...(entry.pageCount !== undefined ? { pageCount: entry.pageCount } : {}),
        ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
      },
    });
  } catch {
    // Local history already succeeded; the next successful run can try again.
  }
}
