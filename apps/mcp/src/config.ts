/**
 * Configuration (§25.4): the server is stateless and disk-free. Everything it
 * needs arrives as `PDFSHUSH_API_URL` + `PDFSHUSH_API_KEY`; every request it
 * makes goes to that one base URL, which `resolveBaseUrl` guards before the
 * first byte leaves the process.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface McpConfig {
  /** Absolute base of the PDFShush deployment; `/api/v1/…` is appended. */
  baseUrl: URL;
  apiKey: string;
}

/** Hosts where plain http is safe by construction: localhost only. */
function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * The no-escape gate for the configured base URL:
 *
 * - absolute `http(s)` only -- no other scheme reaches `fetch` from here;
 * - https is the default posture; plain http is accepted for loopback hosts
 *   (local development) or via the explicit `PDFSHUSH_ALLOW_HTTP=1` opt-in,
 *   so a testing harness needs no code path in the server itself;
 * - no userinfo, query string, fragment or control characters -- the base is
 *   a deployment root, not a search box, and stray `?`/`#` would falsify the
 *   paths we build under it.
 */
export function resolveBaseUrl(
  raw: string,
  env: { PDFSHUSH_ALLOW_HTTP?: string } = {},
): URL {
  const candidate = raw.trim();
  const allowHttp = env.PDFSHUSH_ALLOW_HTTP === '1';
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConfigError(
      `PDFSHUSH_API_URL must be an absolute URL (got ${JSON.stringify(candidate)}), e.g. https://pdfshush.example.com`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError(
      `PDFSHUSH_API_URL must be http(s) (got ${url.protocol}) -- the MCP server only talks to PDFShush deployments.`,
    );
  }
  if (url.protocol === 'http:' && !allowHttp && !isLoopback(url.hostname)) {
    throw new ConfigError(
      `PDFSHUSH_API_URL is plain http and ${url.hostname} is not a loopback host. Your API key would travel ` +
        'unencrypted; use the https URL of the deployment, or set PDFSHUSH_ALLOW_HTTP=1 to accept the risk explicitly.',
    );
  }
  if (url.username || url.password) {
    throw new ConfigError('PDFSHUSH_API_URL must not carry userinfo -- credentials go to PDFSHUSH_API_KEY.');
  }
  // Any of these characters anywhere in the candidate — not just at the start.
  // A leading `^` anchor here once turned this into "only the first character
  // may be forbidden", which let `https:\attacker.example` through as host
  // smuggling (WHATWG normalises backslashes to slashes on special schemes).
  // The class therefore matches anywhere: control characters (0x00-0x1f,
  // 0x7f), a literal space, parser-divergence bait (`<>"'`\~^|{\}`), and the
  // percent-smuggled query/fragment introducers (`?`/`#`) that `url.search`
  // cannot see in encoded form.
  const forbidden = /[\x00-\x20\x7f<>"'`\\~^|{}?#]/;
  if (url.search || url.hash || forbidden.test(candidate)) {
    throw new ConfigError(
      'PDFSHUSH_API_URL must end at the deployment root -- no query string, fragment or path escape characters.',
    );
  }
  // Percent-encoding can smuggle the characters above past a literal check.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    throw new ConfigError('PDFSHUSH_API_URL contains malformed percent-encoding.');
  }
  if (forbidden.test(decoded)) {
    throw new ConfigError(
      'PDFSHUSH_API_URL must end at the deployment root -- no query string, fragment or path escape characters.',
    );
  }
  return url;
}

/** Reads and validates the environment into a usable config, failing loudly. */
export function loadConfig(env: NodeJS.ProcessEnv): McpConfig {
  const apiKey = env.PDFSHUSH_API_KEY ?? '';
  if (!apiKey) {
    throw new ConfigError(
      'PDFSHUSH_API_KEY is not set. Create a key in the PDFShush account dashboard ' +
        '(pshk_…) and put it in the MCP client config: env: { PDFSHUSH_API_KEY: "pshk_…" }.',
    );
  }
  const baseUrl = resolveBaseUrl(env.PDFSHUSH_API_URL ?? 'https://api.pdfshush.com', {
    PDFSHUSH_ALLOW_HTTP: env.PDFSHUSH_ALLOW_HTTP,
  });
  return { baseUrl, apiKey };
}
