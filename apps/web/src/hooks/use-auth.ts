/**
 * Who is signed in, and the two actions that change it.
 *
 * Anonymous is a first-class state here, not an error: the API answers 204 for
 * "nobody", and every tool works without a session. That is why `account` is
 * `null` rather than an exception, and why nothing gates on it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

export interface Account {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface AuthState {
  account: Account | null;
  /** True only until the first answer arrives, so the header does not flicker. */
  loading: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ account: Account }>('/api/auth/me');
      setAccount(result?.account ?? null);
    } catch {
      // A 503 (accounts not configured) and a network blip look the same from
      // here and mean the same thing: signed out.
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(() => {
    // A full navigation, not fetch: this is a browser redirect to Google, and
    // the callback returns the browser to wherever we sent it from.
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      // Already signed out is a success as far as the user is concerned.
      if (!(error instanceof ApiError)) throw error;
    }
    setAccount(null);
  }, []);

  return { account, loading, signIn, signOut, refresh };
}

/** Human text for the reason codes the callback puts in the URL. */
const AUTH_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Please try again.',
  invalid_request: 'That sign-in link was incomplete.',
  signin_failed: 'We could not complete the sign-in. Please try again.',
};

/**
 * Surfaces the callback's outcome once, then strips it from the URL.
 *
 * The callback redirects back with `?auth=error&reason=…` rather than rendering
 * an error page, so the SPA owns the messaging. Leaving the query in place means
 * a refresh re-toasts a failure the user already read.
 */
export function useAuthRedirectNotice(onSignedIn?: () => void): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('auth');
    if (!outcome) return;

    if (outcome === 'error') {
      const reason = params.get('reason') ?? 'signin_failed';
      void import('sonner').then(({ toast }) => {
        toast.error(AUTH_ERRORS[reason] ?? 'Sign-in failed. Please try again.');
      });
    } else {
      onSignedIn?.();
    }

    params.delete('auth');
    params.delete('reason');
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    );
    // Runs once per mount: the parameters are consumed and removed here.
  }, [onSignedIn]);
}
