/**
 * Shared helpers for the browser E2E scripts.
 *
 * These are deliberately dependency-light: a PDF built byte by byte (so the
 * fixture is the *same* document on every run, with one text run of known
 * content that both the extractor and PDFium can see) and text extraction with
 * the same pdf.js build the app renders with.
 */

/**
 * A spec-valid 1-page PDF whose content stream draws one run of known text.
 * Helvetica (a standard font with a standard encoding) is what makes the run
 * rewritable in place, so this fixture exercises the native editing path too.
 */
export function buildPdf(text) {
  const stream = `BT /F1 18 Tf 72 770 Td (${text}) Tj ET`;
  const objects = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let n = 1; n <= 5; n += 1) {
    offsets[n] = Buffer.byteLength(body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += 'xref\n0 6\n0000000000 65535 f \n';
  for (let n = 1; n <= 5; n += 1) body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** Extracts all text from a PDF using the same pdf.js build the app renders with. */
export async function extractText(bytes) {
  const pdfjs = await import(
    new URL('../../apps/web/node_modules/pdfjs-dist/legacy/build/pdf.mjs', import.meta.url).href
  );
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const doc = await task.promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str ?? '').join(' ') + '\n';
  }
  await task.destroy();
  return text;
}

/** Polls `fn` until it returns something truthy, or throws after `timeoutMs`. */
export async function waitFor(fn, timeoutMs = 45_000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Dismisses the AI welcome overlay when a fresh browser profile would trigger
 * it (no stored key yet). A no-op when the overlay is absent — existing flows
 * that seed a key, or run in managed mode, never see it. Must be awaited
 * before any interaction with the underlying page, because the overlay covers
 * it full-screen while open.
 */
export async function dismissAiWelcome(page) {
  const dismiss = page.getByTestId('ai-welcome-dismiss');
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 3000 });
    await dismiss.click();
  } catch {
    /* no overlay within the window — the page had a key or managed mode on */
  }
}
