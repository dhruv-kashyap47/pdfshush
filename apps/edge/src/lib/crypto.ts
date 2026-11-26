/**
 * WebCrypto replacements for the three things `apps/api` used `node:crypto` for:
 * random tokens, SHA-256, and constant-time comparison.
 *
 * Base64url is encoded by hand rather than through `btoa` because `btoa` lives
 * in a different global lib depending on which type environment is in play, and
 * 20 lines removes that question entirely.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const encoder = new TextEncoder();

/** RFC 4648 base64url, unpadded. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += ALPHABET[b0 >> 2]!;
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 === undefined) break;

    out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 === undefined) break;

    out += ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

/** 256 bits of entropy by default — same width as `randomBytes(32)`. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

/** The stored form of a session token. The token itself never reaches D1. */
export async function sha256Hex(input: string): Promise<string> {
  let hex = '';
  for (const byte of await sha256(input)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** RFC 7636 S256 challenge. */
export async function codeChallengeFor(verifier: string): Promise<string> {
  return toBase64Url(await sha256(verifier));
}

/**
 * Length-checked, then byte-wise XOR accumulation: no early return on the first
 * differing byte. Node's `timingSafeEqual` is not available here, and the
 * property that matters — a wrong-length input cannot throw — holds.
 */
export function tokensMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
