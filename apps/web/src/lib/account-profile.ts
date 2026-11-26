/**
 * The account fields that are provider-shaped, not pdfshush-shaped.
 *
 * Google's OIDC claim is `picture`, which is what the Worker stores. An older
 * or self-hosted API, and every other OAuth provider, spells the same value
 * `avatar_url` or `avatarUrl`. The SPA used to read `account.picture` alone,
 * so those deployments rendered an empty header even though the response had
 * a perfectly good image URL in it.
 *
 * URL acceptance is deliberately narrow: an http(s) URL, no embedded
 * credentials, and never a downgrade from an HTTPS page (a mixed-content image
 * is blocked by the browser anyway, and failing early lets the avatar render
 * its initials instead of a broken-image icon).
 */

const PICTURE_FIELDS = ['picture', 'avatar_url', 'avatarUrl'] as const;
const MAX_PICTURE_URL_LENGTH = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A renderable profile image URL, or null when there is nothing safe to load. */
export function profilePictureUrl(
  raw: unknown,
  pageProtocol: string = typeof location === 'undefined' ? '' : location.protocol,
): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_PICTURE_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  // The page is HTTPS in production; an http image would be blocked as mixed
  // content and leaves the avatar blank instead of falling back to initials.
  if (pageProtocol === 'https:' && url.protocol !== 'https:') return null;

  return url.toString();
}

/**
 * Reads the picture from any of the field names a login response may use.
 * First valid value wins, so `picture` stays authoritative when present.
 */
export function profilePictureFrom(account: unknown): string | null {
  if (!isRecord(account)) return null;
  for (const field of PICTURE_FIELDS) {
    const candidate = profilePictureUrl(account[field]);
    if (candidate) return candidate;
  }
  return null;
}

/** One or two letters for the fallback avatar: a name beats an email address. */
export function initialsFor(name: unknown, email: unknown): string {
  const words =
    typeof name === 'string'
      ? name
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0)
      : [];
  if (words.length > 0) {
    const first = words[0]!;
    const last = words.length > 1 ? words[words.length - 1]! : '';
    return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?';
  }
  if (typeof email === 'string') {
    const first = email.trim()[0];
    if (first) return first.toUpperCase();
  }
  return '?';
}
