/**
 * Result content types.
 *
 * The map exists so a `.json` inspection result is not labelled
 * `application/pdf`; it stays a closed allowlist. `.html` was in it although no
 * job emits HTML, which is exactly the kind of entry that becomes an
 * injection footgun the day one does. It now falls through to the safe default.
 */

import { describe, expect, it } from 'vitest';
import { contentTypeFor } from '../src/http/result-stream.js';

describe('contentTypeFor', () => {
  it('maps the file kinds jobs actually produce', () => {
    expect(contentTypeFor('merged.pdf')).toBe('application/pdf');
    expect(contentTypeFor('inspect-result.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('pages.zip')).toBe('application/zip');
    expect(contentTypeFor('page-1.png')).toBe('image/png');
    expect(contentTypeFor('page-1.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('page-1.jpeg')).toBe('image/jpeg');
    expect(contentTypeFor('text.txt')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('table.csv')).toBe('text/csv; charset=utf-8');
  });

  it('does not serve HTML even when a stored name ends in .html', () => {
    expect(contentTypeFor('report.html')).toBe('application/octet-stream');
    expect(contentTypeFor('REPORT.HTML')).toBe('application/octet-stream');
  });

  it('defaults to octet-stream for unknown or empty extensions', () => {
    expect(contentTypeFor('blob')).toBe('application/octet-stream');
    expect(contentTypeFor('archive.7z')).toBe('application/octet-stream');
    expect(contentTypeFor('.pdf')).toBe('application/octet-stream');
  });
});
