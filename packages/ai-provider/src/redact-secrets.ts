/**
 * Credential scrubbing for anything a human will read or a log will keep.
 *
 * A provider error body is echoed to the user, and a proxy or gateway that
 * rejects a request very often quotes the request it rejected -- headers
 * included. The API key is the one string this app must never render or
 * persist, so this runs on *every* error path (streaming and one-shot), not
 * just the streaming one.
 *
 * Two layers, because neither is sufficient alone:
 *   1. the exact secret in hand, removed verbatim -- covers any key shape,
 *      including shapes no heuristic here knows about;
 *   2. shape heuristics -- for a key that was transformed (truncated,
 *      URL-encoded, split across a header echo) or that belongs to a different
 *      provider slot than the one that failed.
 *
 * Deliberately never applied to model *output*: a document is allowed to
 * contain a credential the user asked about, and corrupting a real answer is
 * worse than the alternative. Dependency-free, so the browser (BYOK) and the
 * server (managed gateway) can both use it.
 */

/** The token every scrubber in the codebase converges on. */
export const REDACTED = '[redacted]'

/** Below this length a "secret" is indistinguishable from an ordinary word. */
const MIN_SECRET_LENGTH = 8

export function redactSecrets(message: string, secret?: string): string {
  const needle = secret?.trim()
  const exact =
    needle && needle.length >= MIN_SECRET_LENGTH ? message.split(needle).join(REDACTED) : message

  return (
    exact
      // `sk-…`, `sk_live_…`, `key-…`, `token-…`, plus the prefixes this app
      // actually ships: `gsk_` (Genspark), `xai-` (xAI), `ci_live_` (Cheaper
      // Inference), `ak-` (Spark), `apikey-` (Atlas). `apikey-` is why the old
      // pattern's leading `\b` before `key` never matched it.
      .replace(/\b(?:sk|key|token|gsk|apikey|api[-_]?key|ak|xai|ci_live)[-_][A-Za-z0-9._-]{8,}/gi, REDACTED)
      // Authorization-header echoes (`Bearer <jwt>`, `Basic <base64>`).
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
      // Vendor-shaped keys with no separator: Google, AWS, Slack, compact JWT.
      .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, REDACTED)
      .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED)
      .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED)
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, REDACTED)
  )
}
