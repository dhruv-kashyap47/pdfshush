/**
 * IndexedDB connection lifecycle.
 *
 * Two failure modes matter and neither is visible in normal use: an upgrade
 * blocked by another tab, and a newer version opened elsewhere while this tab
 * still holds a connection. The first used to leave `pdfshushDb()` pending
 * forever (history simply never loaded); the second would deadlock the other
 * tab's upgrade. The module is imported fresh per test so its connection cache
 * is deterministic.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeRequest {
  result: FakeDatabase;
  error: Error | null;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
}

class FakeDatabase {
  closed = false;
  onversionchange: (() => void) | null = null;
  readonly objectStoreNames = { contains: () => true };

  close(): void {
    this.closed = true;
  }
}

function fakeIndexedDb() {
  const database = new FakeDatabase();
  const request: FakeRequest = {
    result: database,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };
  const open = vi.fn(() => request);
  vi.stubGlobal('indexedDB', { open });
  return { request, database, open };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('pdfshushDb connection', () => {
  it('rejects instead of hanging when an upgrade is blocked', async () => {
    const { request } = fakeIndexedDb();
    const { pdfshushDb } = await import('./idb');

    const pending = pdfshushDb();
    request.onblocked?.();

    await expect(pending).rejects.toThrow(/blocked by another tab/);
  });

  it('forgets the rejected opening so a later attempt can retry', async () => {
    const first = fakeIndexedDb();
    const { pdfshushDb } = await import('./idb');

    const blocked = pdfshushDb();
    first.request.onblocked?.();
    await expect(blocked).rejects.toThrow();

    const second = fakeIndexedDb();
    const retry = pdfshushDb();
    second.request.onsuccess?.();
    await expect(retry).resolves.toBe(second.database);
    expect(second.open).toHaveBeenCalledTimes(1);
  });

  it('closes on versionchange so another tab can upgrade', async () => {
    const { request, database } = fakeIndexedDb();
    const { pdfshushDb } = await import('./idb');

    const opened = pdfshushDb();
    request.onsuccess?.();
    await expect(opened).resolves.toBe(database);

    database.onversionchange?.();
    expect(database.closed).toBe(true);
  });
});
