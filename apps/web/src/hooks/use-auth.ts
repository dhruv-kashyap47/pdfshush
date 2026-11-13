/**
 * Who is signed in, and the two actions that change it.
 *
 * Anonymous is a first-class state here, not an error: the API answers 204 for
 * "nobody", and every tool works without a session. That is why `account` is
 * `null` rather than an exception, and why nothing gates on it.
 *
 * One provider owns this state for the whole app. The header, account page and
 * workflows page used to mount three independent copies, so signing out in one
 * place left the others showing a stale user until a full reload.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api';
import { SERVER_UNAVAILABLE_MESSAGE, serverDeployed } from '@/lib/deployment';
import { setHistorySyncEnabled } from '@/lib/history-sync';

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
  /** False when this deployment has no account system at all. */
  accountsEnabled: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  // A frontend-only deployment has no account system to talk to, so the control
  // is hidden from the start rather than shown and then failing.
  const [accountsEnabled, setAccountsEnabled] = useState(serverDeployed);
  const mountedRef = useRef(true);
  const refreshControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!serverDeployed) {
      // Nothing to refresh: this deployment has no API and therefore no
      // session. Saying so here keeps the request out of the network entirely.
      if (mountedRef.current) {
        setAccount(null);
        setLoading(false);
      }
      return;
    }
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    try {
      const result = await api<{ account: Account }>('/api/auth/me', {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setAccount(result?.account ?? null);
    } catch (error) {
      // A 503 (accounts not configured) and a network blip look the same from
      // here and mean the same thing: signed out. Abort is not a real failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setAccount(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshControllerRef.current?.abort();
    };
  }, [refresh]);

  // `/api/auth/me` deliberately answers 204 for both "nobody" and "accounts
  // disabled". `/api/tools` is the deployment-level switch; an older API that
  // does not expose it keeps the previous behaviour (sign-in visible).
  useEffect(() => {
    if (!serverDeployed) return;
    const controller = new AbortController();
    void api<{ accounts?: { enabled?: boolean } }>('/api/tools', {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && result?.accounts?.enabled === false) {
          setAccountsEnabled(false);
        }
      })
      .catch(() => {
        // Network/older-deployment failure: do not hide a control that may work.
      });
    return () => controller.abort();
  }, []);

  // Keep the module-level write-through flag in step with the account's stored
  // preference. Without this, only visiting /account enabled sync for the tab.
  useEffect(() => {
    if (!account) {
      setHistorySyncEnabled(false);
      return;
    }
    const controller = new AbortController();
    void api<{ preferences: { syncHistory?: boolean } }>('/api/account/preferences', {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setHistorySyncEnabled(Boolean(result?.preferences?.syncHistory));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistorySyncEnabled(false);
      });
    return () => controller.abort();
  }, [account]);

  const signIn = useCallback(() => {
    if (!serverDeployed) {
      toast.error(SERVER_UNAVAILABLE_MESSAGE);
      return;
    }
    // A full navigation, not fetch: this is a browser redirect to Google, and
    // the callback returns the browser to wherever we sent it from.
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      if (mountedRef.current) setAccount(null);
    } catch (error) {
      // An expired session is already signed out. Anything else means the
      // server session may still be live, so do not pretend it was revoked.
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'unauthenticated' || error.code === 'auth_disabled')
      ) {
        if (mountedRef.current) setAccount(null);
        return;
      }
      toast.error('Could not sign out. Check your connection and try again.');
      void refresh();
    }
  }, [refresh]);

  const value: AuthState = {
    account,
    loading,
    accountsEnabled,
    signIn,
    signOut,
    refresh,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

/** Human text for the reason codes the callback puts in the URL. */
const AUTH_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  expired: 'That sign-in link expired. Please try again.',
  invalid_request: 'That sign-in link was incomplete.',
  signin_failed: 'We could not complete the sign-in. Please try again.',
};

/**
 * Own-property lookup only: `reason` comes from the query string, and a plain
 * indexed read would resolve `constructor`/`__proto__`/`toString` on the
 * prototype chain and hand a function/object to `toast.error()`, which crashes
 * React with error #31.
 */
export function authErrorMessage(reason: string): string {
  return (Object.hasOwn(AUTH_ERRORS, reason) ? AUTH_ERRORS[reason] : undefined) ??
    'Sign-in failed. Please try again.';
}

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
      toast.error(authErrorMessage(reason));
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
