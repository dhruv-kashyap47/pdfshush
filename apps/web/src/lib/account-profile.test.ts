/**
 * Profile photo on login.
 *
 * The Worker stores Google's OIDC `picture`, but Google serves the bytes from
 * `*.googleusercontent.com`, which the production CSP used to block: the login
 * worked, `/api/auth/me` returned the URL, and the browser refused the image.
 * These tests pin the whole chain a login actually takes — response field ->
 * accepted URL -> CSP render permission — plus the fallback when there is no
 * usable picture.
 */

import { describe, expect, it } from 'vitest';
import { initialsFor, profilePictureFrom, profilePictureUrl } from './account-profile';
import { buildCsp } from './csp';

const GOOGLE_PICTURE = 'https://lh3.googleusercontent.com/a/ACg8oc-profile-photo=s96-c';

/** The exact `/api/auth/me` shape after a successful Google login. */
const ME_RESPONSE = {
  account: {
    id: 'acct-1',
    email: 'ada@example.com',
    emailVerified: true,
    name: 'Ada Lovelace',
    picture: GOOGLE_PICTURE,
    plan: 'free',
  },
};

function directive(policy: string, name: string): string[] {
  const part = policy
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name} `));
  return part ? part.slice(name.length).trim().split(/\s+/) : [];
}

/** CSP host matching, reduced to the two shapes this policy uses. */
function cspAllowsImage(policy: string, url: string): boolean {
  const sources = directive(policy, 'img-src');
  if (sources.includes("'self'") && url.startsWith('/')) return true;
  const origin = new URL(url).origin;
  return sources.some((source) => {
    if (source === '*') return true;
    if (source.startsWith('https://*.')) {
      return (
        origin.startsWith('https://') &&
        new URL(origin).hostname.endsWith(source.slice('https://*'.length))
      );
    }
    return source === origin;
  });
}

describe('profile photo after login', () => {
  it('keeps the Google picture returned by /api/auth/me and lets the CSP render it', () => {
    const picture = profilePictureFrom(ME_RESPONSE.account);
    expect(picture).toBe(GOOGLE_PICTURE);
    // This is the actual production policy, not a hand-written copy.
    expect(cspAllowsImage(buildCsp(), picture!)).toBe(true);
  });

  it('falls back to avatar_url/avatarUrl when the API uses another field name', () => {
    expect(profilePictureFrom({ avatar_url: GOOGLE_PICTURE })).toBe(GOOGLE_PICTURE);
    expect(profilePictureFrom({ avatarUrl: GOOGLE_PICTURE })).toBe(GOOGLE_PICTURE);
  });

  it('prefers picture over a stale alias when both are present', () => {
    expect(
      profilePictureFrom({
        picture: 'https://lh4.googleusercontent.com/new',
        avatar_url: 'https://lh3.googleusercontent.com/old',
      }),
    ).toBe('https://lh4.googleusercontent.com/new');
  });

  it('returns null for missing, malformed and non-http(s) values', () => {
    expect(profilePictureFrom(null)).toBeNull();
    expect(profilePictureFrom({})).toBeNull();
    expect(profilePictureFrom({ picture: '' })).toBeNull();
    expect(profilePictureFrom({ picture: 42 })).toBeNull();
    expect(profilePictureFrom({ picture: 'not a url' })).toBeNull();
    expect(profilePictureFrom({ picture: 'javascript:alert(1)' })).toBeNull();
    expect(profilePictureFrom({ picture: 'data:image/svg+xml,<svg/>' })).toBeNull();
    expect(profilePictureFrom({ picture: 'https://user:pass@example.com/a.png' })).toBeNull();
  });

  it('rejects an http picture on an https page as mixed content', () => {
    expect(profilePictureUrl('http://example.com/a.png', 'https:')).toBeNull();
    expect(profilePictureUrl('http://example.com/a.png', 'http:')).toBe(
      'http://example.com/a.png',
    );
  });

  it('renders initials when no picture can be shown', () => {
    expect(initialsFor('Ada Lovelace', 'ada@example.com')).toBe('AL');
    expect(initialsFor('Cher', 'cher@example.com')).toBe('C');
    expect(initialsFor('', 'ada@example.com')).toBe('A');
    expect(initialsFor(null, null)).toBe('?');
  });
});
