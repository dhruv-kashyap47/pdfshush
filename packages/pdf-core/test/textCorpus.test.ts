import { beforeAll, describe, expect, it } from 'vitest';
import { configurePdfjsRuntime, extractTextRuns } from '../src/index.js';
import {
  TEXT_SURGERY_MANIFEST,
  buildTextSurgeryFixture,
  type TextSurgeryFixtureKind,
} from './corpus/textSurgery.js';

beforeAll(() => {
  configurePdfjsRuntime({
    workerSrc: new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
      .href,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
});

describe('text-surgery corpus (G-02)', () => {
  it('declares a unique kind and a named failure for every fixture', () => {
    const kinds = TEXT_SURGERY_MANIFEST.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const entry of TEXT_SURGERY_MANIFEST) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.guards).toMatch(/^C-\d+/);
      expect(entry.expectText.length).toBeGreaterThan(0);
    }
  });

  it('builds every fixture deterministically (no timestamps or machine fonts)', async () => {
    for (const entry of TEXT_SURGERY_MANIFEST) {
      const first = await buildTextSurgeryFixture(entry.kind as TextSurgeryFixtureKind);
      const second = await buildTextSurgeryFixture(entry.kind as TextSurgeryFixtureKind);
      expect(second.bytes, `${entry.kind} must be byte-stable`).toEqual(first.bytes);
    }
  });

  for (const entry of TEXT_SURGERY_MANIFEST) {
    it(`builds and extracts ${entry.kind}`, async () => {
      const fixture = await buildTextSurgeryFixture(entry.kind as TextSurgeryFixtureKind);
      const runs = await extractTextRuns(fixture.bytes, [0]);
      const text = runs.flat().map((run) => run.text).join('\n');
      for (const expected of fixture.expectText) {
        expect(text, `${entry.kind}: expected "${expected}" in "${text}"`).toContain(expected);
      }
    });
  }
});
