/**
 * The auth redirect reason is read straight from the query string, so the
 * mapping must only ever resolve its own keys. Anything reachable through
 * Object.prototype would reach `toast.error()` and crash React with error #31.
 */
import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './use-auth';

describe('auth error messages', () => {
  it('maps the known reason codes', () => {
    expect(authErrorMessage('cancelled')).toBe('Sign-in was cancelled.');
    expect(authErrorMessage('expired')).toBe('That sign-in link expired. Please try again.');
    expect(authErrorMessage('signin_failed')).toBe(
      'We could not complete the sign-in. Please try again.',
    );
  });

  it('falls back for unknown reason codes', () => {
    expect(authErrorMessage('future-reason')).toBe('Sign-in failed. Please try again.');
  });

  it('never resolves inherited Object.prototype keys', () => {
    for (const hostile of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const message = authErrorMessage(hostile);
      expect(message).toBe('Sign-in failed. Please try again.');
      expect(typeof message).toBe('string');
    }
  });
});
