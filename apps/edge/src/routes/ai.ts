/**
 * Managed AI: a streaming proxy in front of one deployment-owned key.
 *
 * The contract is fixed by `apps/web/src/lib/ai/managed.ts` and must not drift:
 * the SPA posts `{ system, messages, tools }` and reads Server-Sent Events named
 * `meta`, `delta`, `reasoning`, `tool`, `stop`, `usage`, `error`, `done`.
 *
 * Privacy: this is the one path where document text reaches the server. The
 * product's claim is therefore split — the 51 tools never upload anything, and
 * the AI panel says so plainly.
 *
 * Metering is per message (see `ai/budget.ts`), charged *before* the provider is
 * called so an aborted stream still costs its message. Charging after would let
 * a client cancel just before the billable part.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env.js';
import { redactSecrets, streamForProvider } from '@pdfshush/ai-provider';
import { managedAiConfig } from '../ai/config.js';
import { spendAiMessage, type Plan } from '../ai/budget.js';
import { D1AuthStore, type Account } from '../db/auth-store.js';
import { sha256Hex } from '../lib/crypto.js';
import { SESSION_COOKIE, fail, requireCsrf } from '../lib/http.js';

export const aiRoutes = new Hono<AppEnv>();

const MAX_SYSTEM_CHARS = 64_000;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_TOOLS = 32;
/**
 * Total prompt ceiling. The per-field limits alone would allow 64k + 200 × 1M of
 * text, which is several hundred thousand tokens and would blow both the free
 * model's context window and the point of metering messages rather than tokens.
 */
const MAX_TOTAL_CHARS = 300_000;

interface ChatBody {
  system: string;
  messages: Record<string, unknown>[];
  tools: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textualLength(message: Record<string, unknown>): number {
  let total = 0;
  if (typeof message.text === 'string') total += message.text.length;
  if (typeof message.reasoning === 'string') total += message.reasoning.length;
  if (Array.isArray(message.images)) {
    for (const image of message.images) {
      if (isRecord(image) && typeof image.base64 === 'string') total += image.base64.length;
    }
  }
  return total;
}

function parseBody(value: unknown): { ok: true; body: ChatBody } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'The request body must be an object.' };

  if (typeof value.system !== 'string' || value.system.length > MAX_SYSTEM_CHARS) {
    return { ok: false, message: `system must be a string of at most ${MAX_SYSTEM_CHARS} characters.` };
  }

  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_MESSAGES) {
    return { ok: false, message: `messages must be an array of 1-${MAX_MESSAGES} turns.` };
  }

  const messages: Record<string, unknown>[] = [];
  let total = value.system.length;

  for (const message of value.messages) {
    if (!isRecord(message)) return { ok: false, message: 'Each message must be an object.' };
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'tool') {
      return { ok: false, message: 'Each message needs role user, assistant or tool.' };
    }
    const length = textualLength(message);
    if (length > MAX_MESSAGE_CHARS) {
      return { ok: false, message: `A single message may not exceed ${MAX_MESSAGE_CHARS} characters.` };
    }
    total += length;
    messages.push(message);
  }

  if (total > MAX_TOTAL_CHARS) {
    return { ok: false, message: 'That document is too large for the AI panel. Try fewer pages.' };
  }

  const tools: Record<string, unknown>[] = [];
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > MAX_TOOLS) {
      return { ok: false, message: `tools must be an array of at most ${MAX_TOOLS} entries.` };
    }
    for (const tool of value.tools) {
      if (!isRecord(tool) || typeof tool.name !== 'string' || !isRecord(tool.inputSchema)) {
        return { ok: false, message: 'Each tool needs a name and an inputSchema object.' };
      }
      tools.push(tool);
    }
  }

  return { ok: true, body: { system: value.system, messages, tools } };
}

/**
 * Metering subject. Signed-in callers are metered by account (and get the Pro
 * allowance); anonymous callers by a hash of their address, never the address
 * itself — the same rule the Express surface followed.
 */
async function subjectFor(
  c: Context<AppEnv>,
): Promise<{ subject: string; plan: Plan }> {
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  const account: Account | undefined = token
    ? await new D1AuthStore(c.env.DB).resolveSession(token).catch(() => undefined)
    : undefined;

  if (account) return { subject: `acct:${account.id}`, plan: account.plan };

  const address =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return { subject: `visit:${await sha256Hex(address)}`, plan: 'free' };
}

/**
 * The structural head of a provider error, without the quoted response body.
 * `<what happened>: <body detail>` — the text before the first colon identifies
 * the failure, everything after it may be the request echoed back.
 */
function errorShape(message: string): string {
  const head = message.split(':', 1)[0] ?? '';
  return head.trim().slice(0, 80);
}

aiRoutes.post('/api/ai/chat', async (c) => {
  const config = managedAiConfig(c.env);
  if (!config) {
    return fail(c, 503, 'ai_disabled', 'Managed AI is not enabled on this deployment.');
  }

  // A call carrying the session cookie is spending that account's allowance, so
  // it must prove same-origin intent like every other cookie-authenticated
  // write. Anonymous calls have no cookie to protect.
  if (getCookie(c, SESSION_COOKIE) ?? '') {
    const denied = requireCsrf(c);
    if (denied) return denied;
  }

  const parsed = parseBody(await c.req.json().catch(() => undefined));
  if (!parsed.ok) return fail(c, 400, 'validation', parsed.message);

  const { subject, plan } = await subjectFor(c);
  const spend = await spendAiMessage(c.env.DB, { subject, plan });
  if (!spend.ok) {
    c.header('retry-after', String(spend.retryAfterSeconds ?? 60));
    return fail(c, 429, spend.code ?? 'ai_budget', spend.message ?? 'The AI allowance is used up.');
  }

  const abort = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send('meta', {
          provider: config.provider,
          model: config.model,
          remainingTokens: null,
          remainingMessages: spend.remaining ?? null,
        });

        await streamForProvider(
          config.provider,
          { apiKey: config.apiKey, model: config.model },
          parsed.body.system,
          parsed.body.messages as unknown as Parameters<typeof streamForProvider>[3],
          parsed.body.tools as unknown as Parameters<typeof streamForProvider>[4],
          config.maxOutputTokens,
          {
            signal: abort.signal,
            onDelta: (text) => send('delta', { text }),
            onReasoningDelta: (text) => send('reasoning', { text }),
            onToolCall: (call) => send('tool', { id: call.id, name: call.name, input: call.input }),
            onStopReason: (reason) => send('stop', { reason }),
            onUsage: (usage) => send('usage', usage),
          },
        );

        send('done', {});
      } catch (error) {
        const raw = error instanceof Error ? error.message : 'The AI request failed.';
        // The caller gets the detailed, key-redacted message: it is their own
        // request being quoted back. The log gets the shape only.
        const message = redactSecrets(raw, config.apiKey);
        console.warn('managed ai stream failed', {
          provider: config.provider,
          model: config.model,
          name: error instanceof Error ? error.name : typeof error,
          shape: errorShape(raw),
          detailChars: raw.length,
        });
        send('error', { message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // `no-transform` also keeps a proxy from buffering the whole reply.
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
});
