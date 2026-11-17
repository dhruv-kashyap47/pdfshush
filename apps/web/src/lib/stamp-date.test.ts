import { describe, expect, it } from 'vitest';
import { formatStampDate, isWinAnsiText } from './stamp-date';

/** Noon local time keeps the date stable in every timezone. */
const DAY = new Date(2026, 10, 17, 12, 0, 0);

describe('formatStampDate', () => {
  it('formats a long date in en-GB', () => {
    const result = formatStampDate(DAY, 'en-GB');
    expect(result.text).toBe('17 November 2026');
    expect(result.locale).toBe('en-GB');
    expect(result.fallback).toBe(false);
  });

  it('formats a long date in en-US', () => {
    const result = formatStampDate(DAY, 'en-US');
    expect(result.text).toBe('November 17, 2026');
    expect(result.fallback).toBe(false);
  });

  it('falls back to a WinAnsi-safe date for a locale it cannot draw', () => {
    const result = formatStampDate(DAY, 'ar-EG');
    expect(result.fallback).toBe(true);
    expect(result.locale).toBe('en-GB');
    expect(isWinAnsiText(result.text)).toBe(true);
    expect(result.text).toBe('17 November 2026');
  });

  it('treats an unknown locale as a safe fallback rather than throwing', () => {
    const result = formatStampDate(DAY, 'not-a-locale');
    expect(result.locale).toBe('en-GB');
    expect(result.fallback).toBe(true);
    expect(result.text).toBe('17 November 2026');
  });

  it('normalises no-break separators to ordinary spaces', () => {
    const result = formatStampDate(DAY, 'en-GB');
    expect(result.text).not.toMatch(/[\u00a0\u202f]/u);
  });
});

describe('isWinAnsiText', () => {
  it('accepts printable Latin and the typographic block', () => {
    expect(isWinAnsiText('17 November 2026')).toBe(true);
    expect(isWinAnsiText('café — “quoted” €')).toBe(true);
  });

  it('rejects script and symbol ranges', () => {
    expect(isWinAnsiText('١٧ نوفمبر ٢٠٢٦')).toBe(false);
    expect(isWinAnsiText('你好')).toBe(false);
    expect(isWinAnsiText('🙂')).toBe(false);
  });
});
