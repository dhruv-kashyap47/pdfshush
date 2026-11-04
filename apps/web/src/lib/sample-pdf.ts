/**
 * A tiny, dependency-free PDF used by the locality proof and its tests.
 *
 * The trust page must be able to prove that a real job runs without asking the
 * user for a file first, so it needs a PDF it can build in memory. Shipping a
 * fixture would put bytes in the bundle for one panel; generating the document
 * is smaller and keeps the fixture from drifting.
 *
 * Deliberately minimal: one page, one text run. It is a real PDF (correct xref
 * offsets), not a stub the engine has to special-case.
 */

const encoder = new TextEncoder();

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/gu, (character) => `\\${character}`);
}

export function buildSamplePdf(text = 'PDFShush locality proof'): Uint8Array {
  const stream = `BT /F1 18 Tf 72 770 Td (${escapePdfText(text)}) Tj ET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  const header = '%PDF-1.4\n';
  let body = header;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(body).length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(body).length;
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  return encoder.encode(body + xref);
}
