/**
 * Page-range parsing, kept dependency-free on purpose: the main thread needs it
 * for input validation, and pulling pdf-lib into the bundle just for a string
 * parser would defeat the worker-only architecture.
 */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const result = new Set<number>();
  const chunks = input
    .split(/[,;\n]/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const match = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(chunk);
    if (!match) throw new Error(`Cannot understand page range "${chunk}"`);
    const rawStart = match[1];
    const rawEnd = match[2];

    // A bare number is a single page ("5" != "5-"). An open end ("8-") runs to
    // the last page; an open start ("-3") begins at page one.
    const isRange = rawEnd !== undefined;
    const start = rawStart ? Number.parseInt(rawStart, 10) : 1;
    const end = !isRange ? start : rawEnd ? Number.parseInt(rawEnd, 10) : pageCount;

    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`Cannot understand "${chunk}"`);
    if (pageCount <= 0) continue;

    // Clamp both ends into the document before normalising, so a fully
    // out-of-range request ("99-200" on a 10 page file) degrades to the last
    // page instead of silently yielding nothing.
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const from = Math.max(1, Math.min(low, pageCount));
    const to = Math.max(1, Math.min(high, pageCount));

    for (let page = from; page <= to; page += 1) result.add(page - 1);
  }

  return [...result].sort((a, b) => a - b);
}
