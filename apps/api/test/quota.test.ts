/**
 * Anonymous quota policy.
 *
 * These are the rules that keep one visitor from spending everyone's budget,
 * so they are tested directly rather than through HTTP.
 */

import { describe, expect, it } from 'vitest';
import { MemoryQuotaStore } from '../src/quota/store.js';
import { QuotaService, subjectId, tokensMatch } from '../src/quota/quota.js';

const LIMITS = { tasksPerMinute: 3, tasksPerDay: 5, bytesPerDay: 1_000 };

describe('QuotaService', () => {
  it('allows up to the per-minute ceiling and refuses the next one', async () => {
    const service = new QuotaService(new MemoryQuotaStore(), LIMITS);

    for (let i = 0; i < 3; i += 1) {
      expect((await service.consume('subject', 0)).allowed).toBe(true);
    }
    const denied = await service.consume('subject', 0);
    expect(denied.allowed).toBe(false);
    expect(denied.window).toBe('minute');
    expect(denied.limit).toBe(3);
    expect(denied.retryAfterSeconds).toBe(60);
  });

  it('keeps counting rejected calls so hammering cannot reset the window', async () => {
    const store = new MemoryQuotaStore();
    const service = new QuotaService(store, LIMITS);

    await service.consume('subject', 0);
    await service.consume('subject', 0);
    await service.consume('subject', 0);
    for (let i = 0; i < 5; i += 1) await service.consume('subject', 0);

    expect(await store.read('quota:subject:m')).toBe(8);
  });

  it('falls through to the daily ceiling once the minute window is clean', async () => {
    let clock = 1_000_000;
    const store = new MemoryQuotaStore(() => clock);
    const service = new QuotaService(store, LIMITS);

    // Burn the minute limit, wait for the window to expire, keep going.
    for (let i = 0; i < 3; i += 1) await service.consume('subject', 0);
    expect((await service.consume('subject', 0)).window).toBe('minute');
    clock += 61_000;

    expect((await service.consume('subject', 0)).allowed).toBe(true);
    expect((await service.consume('subject', 0)).allowed).toBe(true);
    const daily = await service.consume('subject', 0);
    expect(daily.allowed).toBe(false);
    expect(daily.window).toBe('day');
    expect(daily.limit).toBe(5);
  });

  it('enforces the daily upload allowance across separate files', async () => {
    const service = new QuotaService(new MemoryQuotaStore(), {
      ...LIMITS,
      bytesPerDay: 1_000,
      tasksPerMinute: 100,
    });

    expect((await service.consume('subject', 600)).allowed).toBe(true);
    expect((await service.consume('subject', 600)).allowed).toBe(false);
  });

  it('prechecks without spending budget', async () => {
    const store = new MemoryQuotaStore();
    const service = new QuotaService(store, LIMITS);

    expect((await service.precheck('subject')).allowed).toBe(true);
    expect(await store.read('quota:subject:m')).toBe(0);

    for (let i = 0; i < 3; i += 1) await service.consume('subject', 0);
    expect((await service.precheck('subject')).allowed).toBe(false);
    // Still three: precheck must not have consumed anything.
    expect(await store.read('quota:subject:m')).toBe(3);
  });

  it('reports remaining budget for the UI', async () => {
    const service = new QuotaService(new MemoryQuotaStore(), LIMITS);
    await service.consume('subject', 0);
    const peeked = await service.peek('subject');
    expect(peeked.tasksPerMinute.used).toBe(1);
    expect(peeked.tasksPerMinute.limit).toBe(3);
  });
});

describe('subject hashing', () => {
  it('never stores the raw identifier', () => {
    const subject = subjectId('203.0.113.7', 'pepper');
    expect(subject).not.toContain('203.0.113.7');
    expect(subject).toHaveLength(32);
  });

  it('is stable for the same pepper and different across peppers', () => {
    expect(subjectId('ip', 'a')).toBe(subjectId('ip', 'a'));
    expect(subjectId('ip', 'a')).not.toBe(subjectId('ip', 'b'));
  });
});

describe('token comparison', () => {
  it('accepts only the exact token', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});