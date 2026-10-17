/**
 * Guard for the M1 finding: a shared reverse-proxy IP collapses identity.
 *
 * The anonymous quota, the AI daily budget and the AI concurrency slot are all
 * keyed on the resolved client IP. That is only meaningful if Express resolves
 * the *real* client. With `TRUST_PROXY` left at its default of `0` behind a load
 * balancer, every request resolves to the proxy's own address, so the first
 * visitor's work exhausts the day's quota for everyone. It is not impersonation
 * -- no one can choose another visitor's bucket -- but it is a trivial
 * fair-use denial of service, and it silently makes the per-visitor limits a
 * single shared limit.
 *
 * Nothing here can be detected reliably from the server: a deployment that is
 * behind a proxy and one that is not look identical from inside the process. So
 * this does not change behaviour. It returns a sentence to log at boot when the
 * configuration is the risky one, which is the cheapest honest mitigation: an
 * operator who reads the startup line can set `TRUST_PROXY` to the real hop
 * count, and one who does not has still been told.
 */

import type { ApiConfig } from '../config.js';

/** The message to log, or `undefined` when there is nothing to warn about. */
export function trustProxyWarning(config: ApiConfig): string | undefined {
  // Development runs the API directly on localhost: there is no proxy to trust,
  // so the compression is expected and warning about it every boot is noise.
  if (!config.isProduction) return undefined;
  if (config.http.trustProxy > 0) return undefined;
  return (
    'TRUST_PROXY is unset: if this API sits behind a reverse proxy, every client ' +
    'resolves to the proxy address and the anonymous quota, the AI budget and the ' +
    'AI concurrency slot all collapse onto one shared identity. Set TRUST_PROXY to ' +
    'the number of trusted proxy hops if that applies.'
  );
}
