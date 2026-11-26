/**
 * Warnings cross two trust boundaries: a job (which parsed an untrusted
 * document) writes them, and the API replays them in state JSON. Bound the
 * shape here so a hostile document cannot turn a font name or annotation
 * message into an unbounded payload or embed control characters in a response.
 */

const MAX_WARNINGS = 20;
const MAX_WARNING_CHARS = 500;

export function sanitiseWarnings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const warnings = raw
    .filter((warning): warning is string => typeof warning === 'string')
    // eslint-disable-next-line no-control-regex
    .map((warning) => warning.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_WARNING_CHARS))
    .filter((warning) => warning.length > 0)
    .slice(0, MAX_WARNINGS);
  return warnings.length > 0 ? warnings : undefined;
}
