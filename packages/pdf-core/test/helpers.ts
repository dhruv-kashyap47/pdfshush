import { unzlibSync } from 'fflate';

/**
 * pdf-lib both hex-encodes drawText strings (`<506167...>`) AND deflates every
 * content stream, so a byte scan must first inflate the streams.
 */
export function pdfContainsText(bytes: Uint8Array, needle: string): boolean {
  const decoder = new TextDecoder('latin1');
  const latin1 = decoder.decode(bytes);
  let haystack = '';
  const streams = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streams.exec(latin1)) !== null) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) break;
    const slice = bytes.subarray(start, end);
    try {
      haystack += decoder.decode(unzlibSync(slice));
    } catch {
      haystack += decoder.decode(slice);
    }
    // Skip past 'endstream' itself -- otherwise the next match lands on the
    // "stream\n" tail inside "endstream\n" and re-slices from the wrong offset.
    streams.lastIndex = end + 'endstream'.length;
  }

  const hex = Array.from(new TextEncoder().encode(needle))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  haystack = haystack.toLowerCase();
  return haystack.includes(needle.toLowerCase()) || haystack.includes(hex);
}
