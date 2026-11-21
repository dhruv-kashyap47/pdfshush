import { describe, expect, it } from 'vitest';
import {
  emitContentStream,
  isPlainLiteral,
  parseOperations,
  tokenizeContentStream,
} from '../src/index.js';

function bytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function roundTrip(input: Uint8Array): Uint8Array {
  return emitContentStream(input, tokenizeContentStream(input));
}

describe('content-stream lexer (C-01)', () => {
  const CASES: Array<{ label: string; stream: Uint8Array }> = [
    { label: 'plain text and escapes', stream: bytes('BT /F1 12 Tf 72 700 Td (Hello \\(x\\) \\123) Tj ET') },
    { label: 'hex and array operands', stream: bytes('[<48656C6C6F> -120 (world) 250] TJ') },
    { label: 'comments, names and numbers', stream: bytes('% lead\n/Na#6De [1 2.5 -3 (str)] TJ % tail') },
    { label: 'nested dictionaries', stream: bytes('<</A 1 /B <</C (x)>>>> setdict') },
    { label: 'unterminated array still round-trips', stream: bytes('[1 2 (three') },
    { label: 'empty stream', stream: new Uint8Array() },
  ];

  for (const entry of CASES) {
    it(`round-trips ${entry.label} byte-identically`, () => {
      expect(Array.from(roundTrip(entry.stream))).toEqual(Array.from(entry.stream));
    });
  }

  it('handles an inline image instead of throwing', () => {
    const head = bytes('q BI /W 2 /H 2 /BPC 8 /CS /G ID ');
    const image = Uint8Array.of(0x00, 0x01, 0x02, 0x03);
    const tail = bytes(' EI Q BT /F1 12 Tf (after) Tj ET');
    const stream = new Uint8Array(head.length + image.length + tail.length);
    stream.set(head, 0);
    stream.set(image, head.length);
    stream.set(tail, head.length + image.length);

    const tokens = tokenizeContentStream(stream);
    expect(Array.from(emitContentStream(stream, tokens))).toEqual(Array.from(stream));
    const inline = tokens.find((token) => token.kind === 'inline-image');
    expect(inline).toBeDefined();
    expect(inline?.malformed).not.toBe(true);

    const operations = parseOperations(tokens);
    expect(operations.map((operation) => operation.name)).toContain('BI');
    expect(operations.map((operation) => operation.name)).toContain('Tj');
  });

  it('groups operands with their operator and preserves the operator range', () => {
    const stream = bytes('BT /F1 12 Tf 72 700 Td (Hi) Tj ET');
    const operations = parseOperations(tokenizeContentStream(stream));
    const show = operations.find((operation) => operation.name === 'Tj');
    expect(show).toBeDefined();
    expect(show?.operands).toHaveLength(1);
    expect(show?.operands[0]?.kind).toBe('string');
    expect(new TextDecoder().decode(stream.subarray(show!.start, show!.end))).toBe('(Hi) Tj');
  });

  it('identifies plain literals without confusing hex or escaped strings', () => {
    const stream = bytes('(abc) <6162> (a\\(b)');
    const [plain, hex, escaped] = tokenizeContentStream(stream).filter(
      (token) => token.kind === 'string',
    );
    expect(isPlainLiteral(stream, plain!)).toBe(true);
    expect(isPlainLiteral(stream, hex!)).toBe(false);
    expect(isPlainLiteral(stream, escaped!)).toBe(false);
  });
});
