/**
 * Content-stream lexer and byte-preserving emitter (C-01).
 *
 * The old content-stream pass tokenised just enough to find a show operator and
 * threw on anything it did not understand. That is a poor foundation for
 * surgery: an untouched byte cannot be corrupted if it is never re-serialised,
 * and an inline image must not abort an otherwise editable page.
 *
 * This lexer therefore has one hard promise: **tokenising then emitting a stream
 * returns the exact input bytes**. Every token carries the `[start, end)` range
 * it came from; emitting concatenates those raw slices. Operands are parsed into
 * arrays/dicts where the caller needs structure, but the structure is never used
 * to regenerate bytes that were already in the file.
 *
 * Strings are the one place where both the raw bytes *and* a decoded value are
 * kept: the raw range is what emission uses, the decoded bytes are what matching
 * uses. Escape sequences, octal escapes and hex strings are decoded correctly;
 * whether a caller is allowed to act on that decode is a policy decision made
 * above this module.
 */

export type StreamTokenKind =
  | 'whitespace'
  | 'comment'
  | 'number'
  | 'name'
  | 'string'
  | 'array'
  | 'dict'
  | 'keyword'
  | 'operator'
  | 'inline-image';

export interface StreamToken {
  kind: StreamTokenKind;
  /** Inclusive byte offset of the first byte of the token. */
  start: number;
  /** Exclusive byte offset one past the last byte of the token. */
  end: number;
  /** Number value (numbers only). */
  value?: number;
  /** Decoded name/keyword/operator text, without the leading slash. */
  text?: string;
  /** Decoded string bytes (literal and hex strings). */
  bytes?: Uint8Array;
  /** True when the string was written as `(...)` rather than `<...>`. */
  literal?: boolean;
  /** Array operands, in source order (whitespace/comments omitted). */
  items?: StreamToken[];
  /** Inline image payload range, excluding the `ID`/`EI` delimiters. */
  imageStart?: number;
  imageEnd?: number;
  /** Inline image dictionary operands between `BI` and `ID`. */
  dictItems?: StreamToken[];
  /** True when the stream ended before a terminated array/dict/inline image. */
  malformed?: boolean;
}

export interface ContentOperation {
  /** Operator name (`Tj`, `TJ`, `BT`, `BI`, …). */
  name: string;
  /** Operands that preceded the operator, in order. */
  operands: StreamToken[];
  /** First operand byte (or the operator start when there are none). */
  start: number;
  /** One past the operator's last byte. */
  end: number;
  /** The operator token itself. */
  operator: StreamToken;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const NUMBER_START = new Set([0x2b, 0x2d, 0x2e]);

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function byteString(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i += 0x8000) {
    const slice = bytes.subarray(i, Math.min(end, i + 0x8000));
    out += String.fromCharCode(...slice);
  }
  return out;
}

class Scanner {
  private index = 0;
  readonly tokens: StreamToken[] = [];

  constructor(private readonly bytes: Uint8Array) {}

  run(): StreamToken[] {
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      if (WHITESPACE.has(byte)) {
        this.tokens.push(this.readWhitespace());
        continue;
      }
      if (byte === 0x25) {
        this.tokens.push(this.readComment());
        continue;
      }
      this.tokens.push(this.readValue(true));
    }
    return this.tokens;
  }

  private readWhitespace(): StreamToken {
    const start = this.index;
    while (this.index < this.bytes.length && WHITESPACE.has(this.bytes[this.index]!)) {
      this.index += 1;
    }
    return { kind: 'whitespace', start, end: this.index };
  }

  private readComment(): StreamToken {
    const start = this.index;
    while (
      this.index < this.bytes.length &&
      this.bytes[this.index] !== 0x0a &&
      this.bytes[this.index] !== 0x0d
    ) {
      this.index += 1;
    }
    return { kind: 'comment', start, end: this.index };
  }

  private readLiteral(): StreamToken {
    const start = this.index;
    this.index += 1;
    const out: number[] = [];
    let depth = 1;
    let malformed = false;
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      if (byte === 0x5c) {
        this.index += 1;
        if (this.index >= this.bytes.length) {
          malformed = true;
          break;
        }
        const next = this.bytes[this.index]!;
        this.index += 1;
        if (next === 0x6e) out.push(0x0a);
        else if (next === 0x72) out.push(0x0d);
        else if (next === 0x74) out.push(0x09);
        else if (next === 0x62) out.push(0x08);
        else if (next === 0x66) out.push(0x0c);
        else if (next === 0x0a) {
          /* line continuation */
        } else if (next === 0x0d) {
          if (this.bytes[this.index] === 0x0a) this.index += 1;
        } else if (next >= 0x30 && next <= 0x37) {
          let oct = String.fromCharCode(next);
          for (let n = 0; n < 2 && this.index < this.bytes.length; n += 1) {
            const digit = this.bytes[this.index]!;
            if (digit < 0x30 || digit > 0x37) break;
            oct += String.fromCharCode(digit);
            this.index += 1;
          }
          out.push(Number.parseInt(oct, 8) & 0xff);
        } else {
          out.push(next);
        }
        continue;
      }
      this.index += 1;
      if (byte === 0x28) depth += 1;
      else if (byte === 0x29) {
        depth -= 1;
        if (depth === 0) break;
      }
      out.push(byte);
    }
    return {
      kind: 'string',
      start,
      end: this.index,
      bytes: Uint8Array.from(out),
      literal: true,
      ...(depth > 0 ? { malformed: true } : {}),
      ...(malformed ? { malformed: true } : {}),
    };
  }

  private readHexString(): StreamToken {
    const start = this.index;
    this.index += 1;
    const digits: number[] = [];
    let malformed = true;
    let invalid = false;
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      this.index += 1;
      if (byte === 0x3e) {
        malformed = false;
        break;
      }
      if (WHITESPACE.has(byte)) continue;
      const value =
        byte >= 0x30 && byte <= 0x39
          ? byte - 0x30
          : byte >= 0x41 && byte <= 0x46
            ? byte - 0x37
            : byte >= 0x61 && byte <= 0x66
              ? byte - 0x57
              : -1;
      if (value >= 0) digits.push(value);
      else invalid = true;
    }
    if (digits.length % 2 === 1) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = ((digits[i * 2] ?? 0) << 4) | (digits[i * 2 + 1] ?? 0);
    }
    return {
      kind: 'string',
      start,
      end: this.index,
      bytes: out,
      literal: false,
      ...(malformed || invalid ? { malformed: true } : {}),
    };
  }

  private readName(): StreamToken {
    const start = this.index;
    this.index += 1;
    const rawStart = this.index;
    while (
      this.index < this.bytes.length &&
      !WHITESPACE.has(this.bytes[this.index]!) &&
      !DELIMITER.has(this.bytes[this.index]!)
    ) {
      this.index += 1;
    }
    const raw = byteString(this.bytes, rawStart, this.index);
    const text = raw.replace(/#([0-9a-fA-F]{2})/g, (_, hexValue: string) =>
      String.fromCharCode(Number.parseInt(hexValue, 16)),
    );
    return { kind: 'name', start, end: this.index, text };
  }

  private skipTrivia(): void {
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      if (WHITESPACE.has(byte)) {
        this.index += 1;
        continue;
      }
      if (byte === 0x25) {
        this.readComment();
        continue;
      }
      break;
    }
  }

  private readArray(): StreamToken {
    const start = this.index;
    this.index += 1;
    const items: StreamToken[] = [];
    let malformed = true;
    while (this.index < this.bytes.length) {
      this.skipTrivia();
      if (this.index >= this.bytes.length) break;
      if (this.bytes[this.index] === 0x5d) {
        this.index += 1;
        malformed = false;
        break;
      }
      items.push(this.readValue(false));
    }
    return { kind: 'array', start, end: this.index, items, ...(malformed ? { malformed: true } : {}) };
  }

  private readDict(): StreamToken {
    const start = this.index;
    this.index += 2;
    let depth = 1;
    let malformed = true;
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      if (byte === 0x28) {
        this.readLiteral();
        continue;
      }
      if (byte === 0x25) {
        this.readComment();
        continue;
      }
      if (byte === 0x3c && this.bytes[this.index + 1] === 0x3c) {
        depth += 1;
        this.index += 2;
        continue;
      }
      if (byte === 0x3e && this.bytes[this.index + 1] === 0x3e) {
        depth -= 1;
        this.index += 2;
        if (depth === 0) {
          malformed = false;
          break;
        }
        continue;
      }
      this.index += 1;
    }
    return { kind: 'dict', start, end: this.index, ...(malformed ? { malformed: true } : {}) };
  }

  private readNumber(): StreamToken {
    const start = this.index;
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index]!;
      if (WHITESPACE.has(byte) || DELIMITER.has(byte)) break;
      this.index += 1;
    }
    const value = Number.parseFloat(byteString(this.bytes, start, this.index));
    return { kind: 'number', start, end: this.index, value };
  }

  private readWord(): StreamToken {
    const start = this.index;
    while (
      this.index < this.bytes.length &&
      !WHITESPACE.has(this.bytes[this.index]!) &&
      !DELIMITER.has(this.bytes[this.index]!)
    ) {
      this.index += 1;
    }
    const text = byteString(this.bytes, start, this.index);
    if (text === 'true' || text === 'false' || text === 'null') {
      return { kind: 'keyword', start, end: this.index, text };
    }
    return { kind: 'operator', start, end: this.index, text };
  }

  /**
   * Reads `BI <dict> ID <data> EI`. The `EI` search is the PDF-spec heuristic:
   * the two bytes must be surrounded by whitespace (or a delimiter), and the
   * first such occurrence ends the image. Binary payloads can contain `EI`; a
   * false positive is preferable to aborting the page, and the bytes are never
   * rewritten, so a mis-split still emits the original stream verbatim.
   */
  private readInlineImage(): StreamToken {
    const start = this.index;
    // Consume `BI`.
    this.index += 2;
    const dictItems: StreamToken[] = [];
    let dataStart = this.bytes.length;
    while (this.index < this.bytes.length) {
      this.skipTrivia();
      const byte = this.bytes[this.index]!;
      const afterId = this.bytes[this.index + 2];
      if (
        byte === 0x49 &&
        this.bytes[this.index + 1] === 0x44 &&
        (afterId === undefined || WHITESPACE.has(afterId) || DELIMITER.has(afterId))
      ) {
        this.index += 2;
        // One whitespace byte separates ID from the payload.
        if (this.index < this.bytes.length) this.index += 1;
        dataStart = this.index;
        break;
      }
      dictItems.push(this.readValue(false));
    }

    let dataEnd = this.bytes.length;
    let end = this.bytes.length;
    let malformed = true;
    for (let i = dataStart; i + 1 < this.bytes.length; i += 1) {
      if (this.bytes[i] !== 0x45 || this.bytes[i + 1] !== 0x49) continue;
      const before = i === 0 ? 0x20 : this.bytes[i - 1]!;
      const after = i + 2 >= this.bytes.length ? 0x20 : this.bytes[i + 2]!;
      if (WHITESPACE.has(before) && (WHITESPACE.has(after) || DELIMITER.has(after))) {
        dataEnd = i - 1 >= dataStart ? i - 1 : dataStart;
        end = i + 2;
        malformed = false;
        break;
      }
    }
    this.index = end;
    return {
      kind: 'inline-image',
      start,
      end,
      imageStart: dataStart,
      imageEnd: dataEnd,
      dictItems,
      ...(malformed ? { malformed: true } : {}),
    };
  }

  private readValue(topLevel: boolean): StreamToken {
    const byte = this.bytes[this.index]!;
    if (byte === 0x28) return this.readLiteral();
    if (byte === 0x2f) return this.readName();
    if (byte === 0x5b) return this.readArray();
    if (byte === 0x3c) {
      if (this.bytes[this.index + 1] === 0x3c) return this.readDict();
      return this.readHexString();
    }
    if (isDigit(byte) || NUMBER_START.has(byte)) {
      // A lone sign/dot that runs into a delimiter is an operator-ish token;
      // parseFloat would produce NaN, so fall back to a word.
      const token = this.readNumber();
      return token;
    }
    if (topLevel && byte === 0x42 && this.bytes[this.index + 1] === 0x49) {
      // `BI` inline image. Only recognised at operation level; inside an array
      // it is just a keyword.
      const next = this.bytes[this.index + 2];
      if (next === undefined || WHITESPACE.has(next) || DELIMITER.has(next)) {
        return this.readInlineImage();
      }
    }
    if (byte === 0x5d || byte === 0x29 || byte === 0x7b || byte === 0x7d) {
      // Stray delimiter: consume one byte so the stream stays partitioned.
      this.index += 1;
      return { kind: 'operator', start: this.index - 1, end: this.index, text: String.fromCharCode(byte) };
    }
    return this.readWord();
  }
}

/** Tokenises a decoded content stream into contiguous, raw-preserving tokens. */
export function tokenizeContentStream(bytes: Uint8Array): StreamToken[] {
  return new Scanner(bytes).run();
}

/** Emits tokens back to bytes by concatenating their original ranges. */
export function emitContentStream(bytes: Uint8Array, tokens: readonly StreamToken[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const token of tokens) {
    const chunk = bytes.subarray(token.start, token.end);
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Groups tokens into operations, skipping whitespace/comments between them. */
export function parseOperations(tokens: readonly StreamToken[]): ContentOperation[] {
  const operations: ContentOperation[] = [];
  let operands: StreamToken[] = [];
  for (const token of tokens) {
    if (token.kind === 'whitespace' || token.kind === 'comment') continue;
    if (token.kind === 'inline-image') {
      operations.push({
        name: 'BI',
        operands,
        start: operands[0]?.start ?? token.start,
        end: token.end,
        operator: token,
      });
      operands = [];
      continue;
    }
    if (token.kind === 'keyword') {
      operands.push(token);
      continue;
    }
    if (token.kind !== 'operator') {
      operands.push(token);
      continue;
    }
    operations.push({
      name: token.text ?? '',
      operands,
      start: operands[0]?.start ?? token.start,
      end: token.end,
      operator: token,
    });
    operands = [];
  }
  return operations;
}

/** True when the token's raw bytes are a plain `(...)` string with no escapes. */
export function isPlainLiteral(bytes: Uint8Array, token: StreamToken): boolean {
  if (token.kind !== 'string' || token.literal !== true) return false;
  if (token.malformed) return false;
  for (let i = token.start; i < token.end; i += 1) {
    const byte = bytes[i]!;
    if (byte === 0x5c) return false;
    if (byte === 0x28 && i > token.start) return false;
    if (byte === 0x29 && i < token.end - 1) return false;
  }
  return true;
}
