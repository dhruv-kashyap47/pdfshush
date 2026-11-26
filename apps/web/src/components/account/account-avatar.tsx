/**
 * The account avatar, with the fallback the header and account page both need.
 *
 * A profile photo is an enhancement: Google may return no `picture`, the CDN
 * may be blocked by an extension or a network policy, and a re-login can point
 * at a URL that has since 404'd. In every one of those cases the control stays
 * usable by showing initials instead of the browser's broken-image icon. The
 * failed URL is remembered by value, so a later login with a new picture is
 * retried rather than inheriting the old failure.
 */

import { useState } from 'react';
import { initialsFor, profilePictureUrl } from '@/lib/account-profile';
import { cn } from '@/lib/utils';

export function AccountAvatar({
  picture,
  name,
  email,
  size = 'sm',
  alt = '',
  className,
  loading = 'lazy',
}: {
  picture: string | null | undefined;
  name: string | null | undefined;
  email?: string | null;
  size?: 'sm' | 'md';
  /** Empty means decorative: the adjacent name already labels the control. */
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = profilePictureUrl(picture);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size === 'sm' ? 24 : 36}
        height={size === 'sm' ? 24 : 36}
        loading={loading}
        decoding="async"
        // Google's image CDN does not need the signed-in page as a referrer,
        // and not sending it keeps the avatar request free of account context.
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        data-testid="account-avatar"
        className={cn(
          'shrink-0 rounded-full object-cover',
          size === 'sm' ? 'h-6 w-6' : 'h-9 w-9',
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      data-testid="account-avatar"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-sm',
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}
