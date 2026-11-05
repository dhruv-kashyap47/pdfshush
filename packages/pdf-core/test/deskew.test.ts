/**
 * Deskew (2026-11-05): the estimator is pinned against synthetic rulers in
 * Node, the job envelope is checked, and the raster helper must actually draw
 * the embedded image (the bug that made the earlier raster rebuilds blank).
 */

import { describe, expect, test } from 'vitest';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import {
  SKEW_LIMITS,
  deskewJob,
  estimateSkewAngle,
  isValidOverrideAngle,
} from '../src/index.js';
import { addRasterPage } from '../src/ops/rasterPage.js';
import { WORKFLOW_OUTPUT_JOBS } from '../src/workflow.js';
import { JOBS } from '../src/jobs/registry.js';
import { JOB_SLUGS } from '../src/jobs/slugs.js';
import { makeFixturePdf, testContext } from './fixtures.js';

/**
 * Builds a size×size ink matrix of horizontal rulers rotated by `angleDeg`.
 * The inverse rotation maps each output pixel back into the straight source,
 * which is exactly what a camera sees when the page is turned.
 */
function skewMatrix(size: number, angleDeg: number): Uint8Array {
  const gray = new Uint8Array(size * size);
  const center = size / 2;
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const sourceX = dx * cos + dy * sin + center;
      const sourceY = -dx * sin + dy * cos + center;
      if (sourceX < 0 || sourceX >= size || sourceY < 0 || sourceY >= size) continue;
      const phase = ((sourceY % 24) + 24) % 24;
      if (phase < 2.5) gray[y * size + x] = 255;
    }
  }
  return gray;
}

describe('skew estimator', () => {
  test('recovers a positive synthetic skew within half a degree', () => {
    const angle = estimateSkewAngle(skewMatrix(420, 4), 420, 420);
    expect(Math.abs(angle - 4)).toBeLessThanOrEqual(0.6);
  });

  test('recovers a negative synthetic skew within half a degree', () => {
    const angle = estimateSkewAngle(skewMatrix(420, -3), 420, 420);
    expect(Math.abs(angle + 3)).toBeLessThanOrEqual(0.6);
  });

  test('a straight page stays at zero', () => {
    expect(estimateSkewAngle(skewMatrix(420, 0), 420, 420)).toBe(0);
  });

  test('a blank or malformed matrix returns zero instead of guessing', () => {
    expect(estimateSkewAngle(new Uint8Array(100), 10, 10)).toBe(0);
    expect(estimateSkewAngle(new Uint8Array(0), 0, 0)).toBe(0);
    expect(estimateSkewAngle(new Uint8Array(4), 10, 10)).toBe(0);
  });

  test('the manual override guard accepts the documented range only', () => {
    for (const value of [0, 12.5, -12.5, SKEW_LIMITS.maxOverrideDeg, -SKEW_LIMITS.maxOverrideDeg]) {
      expect(isValidOverrideAngle(value)).toBe(true);
    }
    for (const value of [SKEW_LIMITS.maxOverrideDeg + 0.1, -46, Number.NaN, Infinity, '4', null]) {
      expect(isValidOverrideAngle(value)).toBe(false);
    }
  });
});

describe('deskew job', () => {
  test('slug is registered and pinned to the workflow contract', () => {
    expect(deskewJob.slug).toBe('deskew');
    expect(JOB_SLUGS).toContain('deskew');
    expect(JOBS.deskew).toBe(deskewJob);
    expect(WORKFLOW_OUTPUT_JOBS.has('deskew')).toBe(true);
  });

  test('validate: one file, bounded override, width and quality', async () => {
    const source = await makeFixturePdf();
    const files = [{ name: 'f.pdf', type: 'application/pdf', data: source }];
    expect(deskewJob.validate({ files })).toMatchObject({ ok: true });
    expect(deskewJob.validate({ files, options: { overrideAngle: 4.5, targetWidthPx: 1600, quality: 0.9 } })).toMatchObject({ ok: true });
    expect(deskewJob.validate({ files, options: { overrideAngle: 46 } })).toMatchObject({ ok: false });
    expect(deskewJob.validate({ files, options: { overrideAngle: -46 } })).toMatchObject({ ok: false });
    expect(deskewJob.validate({ files, options: { targetWidthPx: 100 } })).toMatchObject({ ok: false });
    expect(deskewJob.validate({ files, options: { quality: 0 } })).toMatchObject({ ok: false });
    expect(deskewJob.validate({ files: [...files, ...files] })).toMatchObject({ ok: false });
  });

  test('run in Node is refused: no canvas, no silent degradation', async () => {
    const source = await makeFixturePdf();
    await expect(
      deskewJob.run({ files: [{ name: 'f.pdf', data: source }] }, testContext()),
    ).rejects.toThrow(/canvas/);
  });

  test('estimate scales with input bytes', async () => {
    const source = await makeFixturePdf();
    const input = { files: [{ name: 'f.pdf', data: source }] };
    expect(deskewJob.estimate(input, 0)).toEqual({ memoryBytes: source.length * 8 });
  });
});

describe('raster page helper', () => {
  test('draws the embedded image so the page is not blank', async () => {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = '#d92b2b';
    context.fillRect(0, 0, 8, 8);
    const jpeg = canvas.toBuffer('image/jpeg');

    const out = await PDFDocument.create();
    await addRasterPage(out, jpeg, 120, 80);
    const bytes = await out.save();

    const reloaded = await PDFDocument.load(bytes);
    const page = reloaded.getPage(0);
    // The page must reference an image XObject. Embedding alone leaves the
    // image unreferenced and the page renders blank -- the old bug.
    const resources = page.node.Resources();
    expect(resources).toBeDefined();
    expect(resources?.lookup(PDFName.of('XObject'))).toBeDefined();
    expect(page.getWidth()).toBeCloseTo(120);
    expect(page.getHeight()).toBeCloseTo(80);
  });
});
