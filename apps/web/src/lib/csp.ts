/**
 * The production Content-Security-Policy, in one place.
 *
 * Two claims depend on this file, so it lives in the app (not in a deploy
 * config) and is imported by both the build that injects the policy and the
 * page that explains it:
 *
 *  1. A client-side tool cannot upload a document, because there is no origin
 *     for it to upload to. Every origin not listed here is blocked by the
 *     browser before a request leaves.
 *  2. The only network destinations the product needs are pdfshush itself and
 *     the AI provider a user explicitly configures. If a feature ever needs a
 *     new origin, it has to be added here, in a commit a reviewer can see.
 *
 * It is deliberately not a full XSS defence: the theme bootstrap is inline, so
 * `script-src` allows `'unsafe-inline'`. The policy's job is egress, and that is
 * what the trust page and the offline/proof tests assert.
 *
 * `connect-src` is the important directive. `form-action 'self'` closes the
 * other obvious way to POST a file off-origin, and `img-src` / `media-src`
 * exclude remote hosts so a beacon cannot be hidden in a pixel.
 */

/**
 * Base URLs the shipped AI providers actually call. Kept as origins (no path)
 * because that is what CSP matches; a provider that adds a regional mirror must
 * add it here or its BYOK requests will be blocked.
 */
export const AI_PROVIDER_ORIGINS = [
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com',
  'https://api.deepseek.com',
  'https://api.openai.com',
  'https://api.groq.com',
  'https://api.moonshot.ai',
  'https://api.moonshot.cn',
  'https://open.bigmodel.cn',
  'https://dashscope.aliyuncs.com',
  'https://ark.cn-beijing.volces.com',
  'https://api.xiaomimimo.com',
  'https://api.hunyuan.cloud.tencent.com',
  'https://api.ant-ling.com',
  'https://maas-api.cn-huabei-1.xf-yun.com',
  'https://api.longcat.chat',
  'https://api.minimax.io',
  'https://api.x.ai',
  'https://api.mistral.ai',
  'https://openrouter.ai',
  'https://router.requesty.ai',
  'https://router.eu.requesty.ai',
  'https://api.opper.ai',
  'https://api.cheaperinference.com',
  'https://api.atlascloud.ai',
  'https://tokenhub.tencentcloudmaas.com',
  'https://www.genspark.ai',
  'https://opencode.ai',
] as const;

/**
 * Local model servers (Ollama, LM Studio, llama.cpp) are a normal BYOK setup,
 * and their port is chosen by the user, so the policy allows the loopback
 * interface rather than a fixed port. Nothing outside the device is reachable
 * through these sources.
 */
export const LOCAL_MODEL_ORIGINS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'https://localhost:*',
  'https://127.0.0.1:*',
] as const;

export const CSP_CONNECT_SRC = [
  "'self'",
  'blob:',
  ...AI_PROVIDER_ORIGINS,
  ...LOCAL_MODEL_ORIGINS,
] as const;

/**
 * Builds the policy. `extraOrigins` is the self-hoster escape hatch: a custom
 * OpenAI-compatible endpoint whose origin is not in the shipped list is blocked
 * by the browser, and the honest fix is to add it at build time
 * (`VITE_CSP_CONNECT_EXTRA=https://ai.internal.example`) rather than widen the
 * policy for everyone. Values are normalised to origins so a pasted URL with a
 * path cannot smuggle a broader match into `connect-src`.
 */
export function buildCsp(extraOrigins: readonly string[] = []): string {
  const extras = extraOrigins.flatMap((value) => {
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  });
  const connectSrc = [...new Set([...CSP_CONNECT_SRC, ...extras])];

  const directives: Record<string, readonly string[]> = {
    'default-src': ["'self'"],
    // The inline theme bootstrap and Vite's module preload need inline script;
    // pdfium/pdf.js compile WebAssembly, which needs the wasm allowance.
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'connect-src': connectSrc,
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-src': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/**
 * Parses the `connect-src` directive back out of a policy string. The trust
 * page uses this to render the policy it is actually running under rather than
 * a second, hand-written copy that could drift.
 */
export function parseConnectSrc(policy: string): string[] {
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src '));
  if (!directive) return [];
  return directive
    .slice('connect-src '.length)
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * `false` means the browser will block a request to this origin in a production
 * build. The AI settings use it to warn before a user saves a custom endpoint
 * that cannot work, instead of letting them discover a CSP violation later.
 *
 * CSP source matching is deliberately not reimplemented here: exact origins and
 * the loopback wildcards this policy ships are handled, and anything else is
 * reported as allowed so the check can only under-warn, never wrongly block.
 */
export function isConnectOriginListed(originUrl: string, policy?: string): boolean {
  let origin: string;
  try {
    origin = new URL(originUrl).origin;
  } catch {
    return true;
  }

  const sources = policy ? parseConnectSrc(policy) : [...CSP_CONNECT_SRC];
  if (sources.includes(origin)) return true;
  if (sources.includes("'self'") && typeof window !== 'undefined' && origin === window.location.origin) {
    return true;
  }
  // Loopback entries ship as `http://localhost:*`; compare without the port.
  return sources.some((source) => {
    const wildcard = /^(https?):\/\/(localhost|127\.0\.0\.1):\*$/.exec(source);
    return wildcard !== null && origin.startsWith(`${wildcard[1]}://${wildcard[2]}:`);
  });
}
