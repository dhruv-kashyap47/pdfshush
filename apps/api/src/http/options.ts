/**
 * Decoding of the multipart `options` field.
 *
 * Shared between the anonymous route and `/api/v1`: both accept `options` as
 * a JSON-encoded string from a multipart field, and the v1 route also takes
 * plain objects from JSON bodies.
 */

export function parseOptionsField(
  raw: string | undefined,
): { value?: Record<string, unknown>; error?: string } {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Silently dropping the options ran the job with defaults instead -- a
    // truncation produced "No pages selected" rather than a diagnosable 400.
    return { error: 'The "options" field is not valid JSON (it may be too large)' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'The "options" field must be a JSON object' };
  }
  return { value: parsed as Record<string, unknown> };
}
