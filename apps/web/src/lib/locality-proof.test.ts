/**
 * The locality proof is arithmetic over observed requests. These tests pin the
 * arithmetic -- especially that a body-bearing request always counts as an
 * upload -- so a refactor cannot make the panel quietly report zero.
 */

import { describe, expect, it } from 'vitest';
import { summarizeNetwork, type NetworkEvent } from './locality-proof';
import { buildSamplePdf } from './sample-pdf';

function event(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    api: 'fetch',
    url: 'https://example.test/',
    method: 'GET',
    crossOrigin: true,
    body: false,
    ...overrides,
  };
}

describe('network summary', () => {
  it('separates same-origin work from cross-origin traffic', () => {
    const summary = summarizeNetwork(
      [
        event({ url: '/assets/job-worker.js', crossOrigin: false }),
        event({ url: '/assets/pdfium.wasm', crossOrigin: false }),
        event({ url: 'https://api.openai.com/v1/chat' }),
      ],
      1,
      12.4,
    );
    expect(summary.requests).toBe(3);
    expect(summary.sameOrigin).toBe(2);
    expect(summary.crossOrigin).toBe(1);
    expect(summary.uploads).toBe(0);
    expect(summary.pageCount).toBe(1);
    expect(summary.durationMs).toBe(12);
  });

  it('counts every body-bearing request as an upload, whatever the method label', () => {
    const summary = summarizeNetwork(
      [
        event({ api: 'xhr', method: 'POST', body: true }),
        event({ api: 'beacon', method: 'POST', body: true }),
        event({ api: 'fetch', method: 'PUT', body: true, crossOrigin: false }),
        event({ api: 'fetch', method: 'GET', body: false, crossOrigin: false }),
      ],
      1,
      5,
    );
    expect(summary.uploads).toBe(3);
  });

  it('counts a websocket or event source as a request even without a body', () => {
    const summary = summarizeNetwork(
      [
        event({ api: 'websocket', method: 'GET' }),
        event({ api: 'eventsource', method: 'GET' }),
      ],
      1,
      1,
    );
    expect(summary.requests).toBe(2);
    expect(summary.uploads).toBe(0);
    expect(summary.crossOrigin).toBe(2);
  });

  it('counts module and worker loads separately, and flags an external one', () => {
    const summary = summarizeNetwork([], 1, 1, [
      { crossOrigin: false },
      { crossOrigin: false },
      { crossOrigin: true },
    ]);
    expect(summary.resources).toBe(3);
    expect(summary.crossOriginResources).toBe(1);
    expect(summary.requests).toBe(0);
  });
});

describe('built-in sample PDF', () => {
  const bytes = buildSamplePdf();
  const text = new TextDecoder('latin1').decode(bytes);

  it('is a real PDF with a correct trailer', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Count 1');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('points startxref at the actual xref table', () => {
    const startxref = Number(/startxref\s+(\d+)/u.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('escapes parentheses so arbitrary labels cannot break the stream', () => {
    const tricky = new TextDecoder('latin1').decode(buildSamplePdf('a (b) \\ c'));
    expect(tricky).toContain('(a \\(b\\) \\\\ c)');
  });
});
