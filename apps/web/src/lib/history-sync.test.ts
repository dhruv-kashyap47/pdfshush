import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { setHistorySyncEnabled, syncHistoryEntry } from './history-sync';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => undefined) }));

const mockedApi = vi.mocked(api);

beforeEach(() => {
  mockedApi.mockClear();
  setHistorySyncEnabled(false);
});

describe('history write-through', () => {
  it('does nothing while sync is off', async () => {
    await syncHistoryEntry({
      id: 'row-1',
      toolSlug: 'merge-pdf',
      toolName: 'Merge',
      fileName: 'a.pdf',
      createdAt: 1_700_000_000_000,
    });
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it('posts only metadata when sync is on', async () => {
    setHistorySyncEnabled(true);
    await syncHistoryEntry({
      id: 'row-1',
      toolSlug: 'merge-pdf',
      toolName: 'Merge',
      fileName: 'a.pdf',
      pageCount: 3,
      sizeBytes: 1200,
      createdAt: 1_700_000_000_000,
    });

    expect(mockedApi).toHaveBeenCalledWith('/api/account/history', {
      method: 'POST',
      body: {
        toolSlug: 'merge-pdf',
        toolName: 'Merge',
        fileName: 'a.pdf',
        createdAt: 1_700_000_000_000,
        clientId: 'row-1',
        pageCount: 3,
        sizeBytes: 1200,
      },
    });
  });

  it('swallows an upload failure instead of breaking the tool', async () => {
    setHistorySyncEnabled(true);
    mockedApi.mockRejectedValueOnce(new Error('offline'));
    await expect(
      syncHistoryEntry({
        id: 'row-1',
        toolSlug: 'merge-pdf',
        toolName: 'Merge',
        fileName: 'a.pdf',
        createdAt: 1_700_000_000_000,
      }),
    ).resolves.toBeUndefined();
  });
});
