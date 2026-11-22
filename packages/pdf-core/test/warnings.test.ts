/**
 * X-01: warning codes are a contract, not decoration.
 *
 * The registry has to keep three promises: a prefixed engine warning keeps its
 * code and detail, a legacy sentence still gets a stable code, and a repeated
 * loss is reported once.
 */

import { describe, expect, test } from 'vitest';
import {
  WARNING_CODES,
  WARNING_LIMIT,
  collectWarnings,
  hasUntouchedPageWarning,
  toJobWarning,
  warningMessages,
} from '../src/warnings.js';

describe('warning registry', () => {
  test('parses a registered code prefix and keeps the human sentence', () => {
    const warning = toJobWarning('glyph-rasterised: "😀" was drawn as an image');
    expect(warning.code).toBe('glyph-rasterised');
    expect(warning.detail).toBe('"😀" was drawn as an image');
    expect(warning.message).toBe('glyph-rasterised: "😀" was drawn as an image');
  });

  test('classifies legacy sentences instead of dropping their meaning', () => {
    expect(toJobWarning('content-stream fallback found no safely anchored show operator').code).toBe(
      'stream-unavailable',
    );
    expect(
      toJobWarning('3 of 4 edits were applied as overlays: the original text could not be rewritten').code,
    ).toBe('overlay-fallback');
    expect(toJobWarning('Pages were rebuilt as images: text selection is not preserved').code).toBe(
      'redaction-rasterised',
    );
  });

  test('unknown prose still becomes a coded warning', () => {
    const warning = toJobWarning('something unexpected happened');
    expect(warning.code).toBe('engine-warning');
    expect(warning.detail).toBe('something unexpected happened');
  });

  test('an unknown colon prefix is not mistaken for a code', () => {
    expect(toJobWarning('note: this is prose').code).toBe('engine-warning');
  });

  test('deduplicates by code + detail and caps the list', () => {
    const values = [
      'leftover-cover: 2 patches added',
      'leftover-cover: 2 patches added',
      'leftover-cover: 3 patches added',
    ];
    expect(collectWarnings(values)).toHaveLength(2);

    const many = Array.from({ length: WARNING_LIMIT + 10 }, (_, index) => `edit-coverage: edit ${index}`);
    const capped = collectWarnings(many);
    expect(capped).toHaveLength(WARNING_LIMIT);
    expect(capped[0]!.detail).toBe('edit 0');
    expect(capped.at(-1)!.detail).toBe(`edit ${WARNING_LIMIT - 1}`);
  });

  test('exposes messages for consumers that only render text', () => {
    const warnings = collectWarnings(['font-substituted: heading', 'text-squeeze: body']);
    expect(warningMessages(warnings)).toEqual([
      'font-substituted: heading',
      'text-squeeze: body',
    ]);
  });

  test('recognises the untouched-page override codes', () => {
    expect(
      hasUntouchedPageWarning(
        collectWarnings(['untouched-page-accepted: up to date pages changed']),
      ),
    ).toBe(true);
    expect(hasUntouchedPageWarning(collectWarnings(['glyph-rasterised: word']))).toBe(false);
  });

  test('the exported code list contains no duplicates', () => {
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length);
  });
});
