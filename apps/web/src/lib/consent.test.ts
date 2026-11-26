import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_CONTAINER_ID,
  CONSENT_STORAGE_KEY,
  decideMeasurement,
  gtmScriptUrl,
  isAutomatedBrowser,
  readChoice,
  requiresConsent,
  writeChoice,
  type StorageLike,
} from './consent';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('consent region', () => {
  it('asks visitors whose clock names a European city', () => {
    for (const zone of [
      'Europe/London',
      'Europe/Berlin',
      'Europe/Dublin',
      'Europe/Zurich',
      'Europe/Lisbon',
      'Europe/Kyiv',
      'Atlantic/Canary',
      'Atlantic/Reykjavik',
      'Asia/Nicosia',
      'Africa/Ceuta',
    ]) {
      expect(requiresConsent(zone), zone).toBe(true);
    }
  });

  it('does not ask the rest of the world', () => {
    for (const zone of [
      'America/New_York',
      'America/Sao_Paulo',
      'Asia/Kolkata',
      'Asia/Tokyo',
      'Africa/Lagos',
      'Australia/Sydney',
      'Pacific/Auckland',
    ]) {
      expect(requiresConsent(zone), zone).toBe(false);
    }
  });

  it('treats a missing or unreadable zone as requiring consent', () => {
    expect(requiresConsent(null)).toBe(true);
    expect(requiresConsent(undefined)).toBe(true);
    expect(requiresConsent('')).toBe(true);
  });
});

describe('consent decision', () => {
  it('loads for everyone who said yes', () => {
    expect(decideMeasurement({ choice: 'granted', timeZone: 'Europe/Berlin' })).toBe('load');
    expect(decideMeasurement({ choice: 'granted', timeZone: 'Asia/Tokyo' })).toBe('load');
  });

  it('never loads for anyone who said no', () => {
    expect(decideMeasurement({ choice: 'denied', timeZone: 'Europe/Berlin' })).toBe('skip');
    expect(decideMeasurement({ choice: 'denied', timeZone: 'Asia/Tokyo' })).toBe('skip');
  });

  it('asks only when the visitor is European and has not answered', () => {
    expect(decideMeasurement({ choice: null, timeZone: 'Europe/Paris' })).toBe('ask');
    expect(decideMeasurement({ choice: null, timeZone: 'America/Chicago' })).toBe('load');
  });
});

describe('stored choice', () => {
  it('round-trips both answers', () => {
    const storage = memoryStorage();
    expect(readChoice(storage)).toBeNull();

    writeChoice('granted', storage);
    expect(storage.map.get(CONSENT_STORAGE_KEY)).toBe('granted');
    expect(readChoice(storage)).toBe('granted');

    writeChoice('denied', storage);
    expect(readChoice(storage)).toBe('denied');
  });

  it('ignores anything it did not write', () => {
    expect(readChoice(memoryStorage({ [CONSENT_STORAGE_KEY]: 'yes' }))).toBeNull();
    expect(readChoice(memoryStorage({ [CONSENT_STORAGE_KEY]: '' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    const hostile: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readChoice(hostile)).toBeNull();
    expect(() => writeChoice('granted', hostile)).not.toThrow();
  });

  it('treats absent storage as no answer', () => {
    expect(readChoice(null)).toBeNull();
    expect(() => writeChoice('granted', null)).not.toThrow();
  });
});

describe('container url', () => {
  it('names the one container the CSP allows', () => {
    expect(ANALYTICS_CONTAINER_ID).toBe('GTM-W5QPVR3Z');
    expect(gtmScriptUrl()).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-W5QPVR3Z');
  });
});

describe('automation', () => {
  it('recognises a driver-controlled browser', () => {
    expect(isAutomatedBrowser({ webdriver: true })).toBe(true);
    expect(isAutomatedBrowser({ webdriver: false })).toBe(false);
    expect(isAutomatedBrowser({})).toBe(false);
    expect(isAutomatedBrowser(null)).toBe(false);
    expect(isAutomatedBrowser(undefined)).toBe(false);
  });
});
