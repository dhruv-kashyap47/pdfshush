/**
 * Worker-pool sizing is a memory safeguard, not a performance guess.
 *
 * The 4x CPU emulation used by Q3 does not change `hardwareConcurrency`, so a
 * test that only counted cores would miss the device that actually dies: a
 * small phone reporting 2 GB. This pins both inputs and the cap.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS } from '@pdfshush/pdf-core';
import { workerCountFor } from './job-pool';

describe('workerCountFor', () => {
  it('uses one spare core per worker, capped at four', () => {
    expect(workerCountFor(8)).toBe(4);
    expect(workerCountFor(4)).toBe(3);
    expect(workerCountFor(2)).toBe(1);
    expect(workerCountFor(1)).toBe(1);
  });

  it('never opens more than one worker on a low-memory device', () => {
    expect(workerCountFor(8, 2)).toBe(1);
    expect(workerCountFor(8, 1)).toBe(1);
    expect(workerCountFor(8, 4)).toBe(4);
  });

  it('treats missing or nonsensical evidence as the conservative case', () => {
    expect(workerCountFor(Number.NaN)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(0)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(-4)).toBe(LIMITS.client.minWorkers);
    expect(workerCountFor(8, Number.NaN)).toBe(4);
  });
});
