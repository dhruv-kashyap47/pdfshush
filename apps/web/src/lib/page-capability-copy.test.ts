import { describe, expect, test } from 'vitest';
import type { PageTextCapability } from '@pdfshush/pdf-core';
import {
  CAPABILITY_SNAPSHOT_NOTE,
  describePageEditStatus,
  describeParagraphEditStatus,
  textLayerLabel,
} from './page-capability-copy';

function capability(overrides: Partial<PageTextCapability> = {}): PageTextCapability {
  return {
    pageIndex: 0,
    widthPt: 612,
    heightPt: 792,
    rotation: 0,
    objectCounts: { text: 1, image: 0, path: 0, form: 0, unknown: 0 },
    textObjects: [],
    fonts: [],
    textLayer: 'native',
    likelyScanned: false,
    ...overrides,
  };
}

describe('page capability copy (E-10)', () => {
  test('the snapshot note says it is not a permanent promise', () => {
    expect(CAPABILITY_SNAPSHOT_NOTE).toMatch(/snapshot/i);
    expect(CAPABILITY_SNAPSHOT_NOTE).toMatch(/not a permanent promise/i);
  });

  test('every non-null page status is marked as an inspection snapshot', () => {
    const statuses = [
      describePageEditStatus(capability({ likelyScanned: true }), null),
      describePageEditStatus(capability({ textLayer: 'none' }), null),
      describePageEditStatus(capability({ textLayer: 'ocr' }), null),
      describePageEditStatus(capability({ textLayer: 'mixed' }), null),
      describePageEditStatus(capability({ textLayer: 'native' }), null),
      describeParagraphEditStatus(capability({ likelyScanned: true })),
      describeParagraphEditStatus(capability({ textLayer: 'none' })),
      describeParagraphEditStatus(capability({ textLayer: 'ocr' })),
      describeParagraphEditStatus(capability({ textLayer: 'mixed' })),
      describeParagraphEditStatus(capability({ textLayer: 'native' })),
    ];
    for (const status of statuses) {
      expect(status).toMatch(/inspected/i);
    }
  });

  test('a vector-only or blank page is not described as having text', () => {
    const blank = capability({ textLayer: 'none', likelyScanned: false });
    expect(describePageEditStatus(blank, null)).toMatch(/no text layer/i);
    expect(describePageEditStatus(blank, null)).not.toMatch(/document text/i);
    expect(describeParagraphEditStatus(blank)).toMatch(/no text layer/i);
    expect(describeParagraphEditStatus(blank)).not.toMatch(/document text/i);
    expect(textLayerLabel(blank)).toMatch(/no text layer/i);
  });

  test('the inspecting state is honest instead of claiming a capability', () => {
    expect(describePageEditStatus(null, null)).toBe('Inspecting fonts and page objects.');
    expect(describeParagraphEditStatus(null)).toBe('Inspecting fonts and page objects.');
    expect(textLayerLabel(null)).toBe('Not inspected yet');
  });

  test('OCR confidence is reported only when this session recorded it', () => {
    const page = capability({ textLayer: 'ocr' });
    expect(describePageEditStatus(page, { confidence: 87.6 })).toContain('88% mean confidence');
    expect(describePageEditStatus(page, null)).toMatch(/confidence was not recorded/i);
  });

  test('text-layer labels name the inspected shape', () => {
    expect(textLayerLabel(capability({ likelyScanned: true }))).toMatch(/image-only/i);
    expect(textLayerLabel(capability({ textLayer: 'ocr' }))).toMatch(/OCR/i);
    expect(textLayerLabel(capability({ textLayer: 'mixed' }))).toMatch(/mixed/i);
    expect(textLayerLabel(capability({ textLayer: 'native' }))).toMatch(/native/i);
  });
});
