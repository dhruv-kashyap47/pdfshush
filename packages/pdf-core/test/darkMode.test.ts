/**
 * Dark mode (2026-10-28): the pure transforms are pinned exactly in Node (they
 * are the same code the browser preview and the worker engine run), the job's
 * validation and envelope are checked, and Node's no-canvas environment must be
 * refused rather than degraded.
 */

import { describe, expect, test } from 'vitest';
import {
  applyDarkModeRgba,
  applyHuePreservingRgba,
  applyInvertRgba,
  applyThemeRgba,
  DARK_MODE_DEFAULT_THEME,
  DARK_MODE_THEMES,
  darkModeJob,
  darkModeTheme,
  isDarkModeThemeId,
} from '../src/index.js';
import { WORKFLOW_OUTPUT_JOBS } from '../src/workflow.js';
import { JOBS } from '../src/jobs/registry.js';
import { JOB_SLUGS } from '../src/jobs/slugs.js';
import { makeFixturePdf, testContext } from './fixtures.js';

/** Builds one RGBA pixel. */
function pixel(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

function result8(pixels: Uint8ClampedArray): number[] {
  return [pixels[0]!, pixels[1]!, pixels[2]!];
}

describe('theme transforms', () => {
  test('theme pins match the reference values', () => {
    const ids = DARK_MODE_THEMES.map((theme) => theme.id);
    expect(ids).toEqual(['ink', 'warm', 'cool', 'sepia', 'midnight', 'forest']);
    expect(darkModeTheme('ink')).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(darkModeTheme('warm')).toMatchObject({ r: 42, g: 37, b: 34 });
    expect(darkModeTheme('cool')).toMatchObject({ r: 52, g: 53, b: 65 });
    expect(darkModeTheme('sepia')).toMatchObject({ r: 40, g: 35, b: 25 });
    expect(darkModeTheme('midnight')).toMatchObject({ r: 25, g: 30, b: 45 });
    expect(darkModeTheme('forest')).toMatchObject({ r: 25, g: 35, b: 30 });
    expect(DARK_MODE_DEFAULT_THEME).toBe('ink');
  });

  test('white paper lands exactly on the theme background, black ink on white', () => {
    const white = applyTheme(pixel(255, 255, 255), 'ink');
    expect(result8(white)).toEqual([0, 0, 0]);
    const black = applyTheme(pixel(0, 0, 0), 'ink');
    expect(result8(black)).toEqual([255, 255, 255]);
  });

  test('mid-grey on midnight interpolates between the theme ends', () => {
    // brightness 128 -> factor 1 - 128/255; ink channel interpolates.
    const out = applyTheme(pixel(128, 128, 128), 'midnight');
    const factor = 1 - (0.299 * 128 + 0.587 * 128 + 0.114 * 128) / 255;
    const expected = (bg: number, factor: number): number => Math.round(bg + (255 - bg) * factor);
    expect(out[0]).toBe(expected(25, factor));
    expect(out[1]).toBe(expected(30, factor));
    expect(out[2]).toBe(expected(45, factor));
  });
});

function applyTheme(pixels: Uint8ClampedArray, theme: string): Uint8ClampedArray {
  const resolved = darkModeTheme(theme as never);
  const copy = new Uint8ClampedArray(pixels);
  applyThemeRgba(copy, resolved);
  return copy;
}

describe('smart and invert transforms', () => {
  test('invert is the classic negative', () => {
    const out = new Uint8ClampedArray(pixel(10, 128, 250));
    applyInvertRgba(out);
    expect(result8(out)).toEqual([245, 127, 5]);
  });

  test('smart keeps pure white → black and pure black → white', () => {
    const white = new Uint8ClampedArray(pixel(255, 255, 255));
    applyHuePreservingRgba(white);
    expect(result8(white)).toEqual([0, 0, 0]);
    const black = new Uint8ClampedArray(pixel(0, 0, 0));
    applyHuePreservingRgba(black);
    expect(result8(black)).toEqual([255, 255, 255]);
  });

  test('smart preserves hue: mid-value red stays red', () => {
    // A red pixel keeps redness after lightness flips (hue survives the pass).
    const red = new Uint8ClampedArray(pixel(200, 40, 40));
    applyHuePreservingRgba(red);
    const [r, g, b] = result8(red);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(127);
    expect(b).toBeLessThan(127);
  });

  test('smart flips lightness symmetrically around mid-grey', () => {
    // Grey pixels take the simple branch and are exact.
    const out = new Uint8ClampedArray(pixel(96, 96, 96));
    applyHuePreservingRgba(out);
    expect(result8(out)).toEqual([159, 159, 159]);
  });

  test('applyDarkModeRgba dispatches all three kinds', () => {
    const theme = new Uint8ClampedArray(pixel(255, 255, 255));
    applyDarkModeRgba(theme, 'theme', darkModeTheme('sepia'));
    expect(result8(theme)).toEqual([40, 35, 25]);
    const invert = new Uint8ClampedArray(pixel(0, 0, 0));
    applyDarkModeRgba(invert, 'invert', darkModeTheme('sepia'));
    expect(result8(invert)).toEqual([255, 255, 255]);
    const smart = new Uint8ClampedArray(pixel(255, 255, 255));
    applyDarkModeRgba(smart, 'smart', darkModeTheme('sepia'));
    expect(result8(smart)).toEqual([0, 0, 0]);
  });

  test('theme theme-id guard accepts the registered set and rejects the rest', () => {
    for (const theme of DARK_MODE_THEMES) expect(isDarkModeThemeId(theme.id)).toBe(true);
    expect(isDarkModeThemeId('classic')).toBe(false);
    expect(isDarkModeThemeId(42)).toBe(false);
  });
});

describe('dark-mode job', () => {
  test('slug is registered and pinned to JOB_SLUGS', () => {
    expect(darkModeJob.slug).toBe('dark-mode');
    expect(JOB_SLUGS).toContain('dark-mode');
    expect(JOBS['dark-mode']).toBe(darkModeJob);
  });

  test('dark-mode is a workflow output job', () => {
    expect(WORKFLOW_OUTPUT_JOBS.has('dark-mode')).toBe(true);
  });

  test('validate: one file, known kind and theme, clamped width and quality', async () => {
    const source = await makeFixturePdf();
    const files = [{ name: 'f.pdf', type: 'application/pdf', data: source }];
    expect(darkModeJob.validate({ files })).toMatchObject({ ok: true });
    expect(darkModeJob.validate({ files, options: { kind: 'theme', themeId: 'midnight', quality: 0.9, targetWidthPx: 1600 } })).toMatchObject({ ok: true });
    expect(darkModeJob.validate({ files: files, options: { kind: 'nope' as never } })).toMatchObject({ ok: false });
    expect(darkModeJob.validate({ files, options: { themeId: 'classic' as never } })).toMatchObject({ ok: false });
    expect(darkModeJob.validate({ files, options: { quality: 2 } })).toMatchObject({ ok: false });
    expect(darkModeJob.validate({ files: [...files, ...files] })).toMatchObject({ ok: false });
  });

  test('run in Node is refused: no canvas, no silent degradation', async () => {
    const source = await makeFixturePdf();
    await expect(
      darkModeJob.run({ files: [{ name: 'f.pdf', data: source }], options: { kind: 'invert' } }, testContext()),
    ).rejects.toThrow(/canvas/);
  });

  test('estimate scales with input bytes', async () => {
    const source = await makeFixturePdf();
    const input = { files: [{ name: 'f.pdf', data: source }] };
    expect(darkModeJob.estimate(input, 0)).toEqual({ memoryBytes: source.length * 8 });
  });
});
