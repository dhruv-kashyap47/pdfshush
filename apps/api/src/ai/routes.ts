/**
 * Managed AI HTTP surface.
 *
 * A streaming proxy in front of one PDFShush-owned provider key: the browser
 * posts the same turn shape it would send directly (system + messages + tools)
 * and gets Server-Sent Events back. Off entirely unless the deployment sets a
 * managed key and model.
 *
 * Privacy note: managed mode is the one path where document text reaches our
 * server. BYOK keeps it in the tab; this route exists for users without a key,
 * and is metered accordingly.
 */

import express, { type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AgentMessage, AgentToolDef } from '@pdfshush/ai-agent';
import { redactSecrets, streamForProvider, type AiProviderId } from '@pdfshush/ai-provider';
import type { Logger } from '../logger.js';
import { AiBudgetService, AiConcurrencyGuard } from './budget.js';

export interface AiRoutesDeps {
  enabled: boolean;
  provider: AiProviderId;
  config: { apiKey: string; model: string; baseUrl?: string | undefined };
  maxOutputTokens: number;
  budget: AiBudgetService;
  concurrency: AiConcurrencyGuard;
  /** Metering subject (IP- or account-derived); never the raw IP. */
  subjectFor(request: Request): string;
  /** Whether the caller is signed in (larger daily allowance). */
  isAuthenticated(request: Request): Promise<boolean>;
  logger: Logger;
}

const MAX_SYSTEM_CHARS = 64_000;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 1_000_000;
const MAX_TOOLS = 32;

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  text: z.string().max(MAX_MESSAGE_CHARS).optional(),
  reasoning: z.string().max(MAX_MESSAGE_CHARS).optional(),
  images: z
    .array(z.object({ base64: z.string().max(24_000_000), mime: z.string().max(128) }))
    .max(8)
    .optional(),
  toolCalls: z.array(z.unknown()).max(64).optional(),
  results: z.array(z.unknown()).max(64).optional(),
});

const bodySchema = z.object({
  system: z.string().max(MAX_SYSTEM_CHARS),
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  tools: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        description: z.string().max(8192),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .max(MAX_TOOLS)
    .default([]),
});

interface Sse {
  send(event: string, data: unknown): void;
  end(): void;
}

function openSse(response: Response): Sse {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  // Ask reverse proxies not to buffer; without it a whole reply arrives at once.
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();
  let open = true;
  return {
    send(event, data) {
      if (!open) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!open) return;
      open = false;
      response.end();
    },
  };
}

export function registerAiRoutes(app: Express, deps: AiRoutesDeps): void {
  app.post(
    '/api/ai/chat',
    // Its own parser: the global JSON body is intentionally absent on uploads.
    express.json({ limit: '16mb' }),
    async (request: Request, response: Response) => {
      if (!deps.enabled) {
        response.status(503).json({ error: 'Managed AI is not enabled', code: 'ai_disabled' });
        return;
      }

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: parsed.error.issues[0]?.message ?? 'Invalid AI request',
          code: 'validation',
        });
        return;
      }

      const authenticated = await deps.isAuthenticated(request).catch(() => false);
      const subject = deps.subjectFor(request);

      if (!deps.concurrency.acquire(subject)) {
        response.status(409).json({
          error: 'An AI request is already running for this client.',
          code: 'ai_busy',
        });
        return;
      }

      let reserved = false;
      let usedTokens: number | undefined;
      try {
        const verdict = await deps.budget.reserve(subject, authenticated);
        if (!verdict.allowed) {
          response.setHeader('Retry-After', String(verdict.retryAfterSeconds));
          response.status(429).json({ error: verdict.reason, code: 'ai_budget' });
          return;
        }
        reserved = true;

        const controller = new AbortController();
        request.on('close', () => controller.abort());
        const stream = openSse(response);
        stream.send('meta', {
          provider: deps.provider,
          model: deps.config.model,
          remainingTokens: verdict.remainingTokens ?? null,
        });

        try {
          await streamForProvider(
            deps.provider,
            deps.config,
            parsed.data.system,
            parsed.data.messages as unknown as AgentMessage[],
            parsed.data.tools as unknown as AgentToolDef[],
            deps.maxOutputTokens,
            {
              signal: controller.signal,
              onDelta: (text) => stream.send('delta', { text }),
              onReasoningDelta: (text) => stream.send('reasoning', { text }),
              onToolCall: (call) =>
                stream.send('tool', { id: call.id, name: call.name, input: call.input }),
              onStopReason: (reason) => stream.send('stop', { reason }),
              onUsage: (usage) => {
                if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
                  usedTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
                }
                stream.send('usage', usage);
              },
            },
          );
          stream.send('done', {});
        } catch (error) {
          const raw = error instanceof Error ? error.message : 'The AI request failed.';
          // A provider error embeds up to 500 chars of the response body
          // (`httpBodyDetail`), and a proxy that rejects the request can quote
          // the request back -- Authorization header included. This key is the
          // deployment's, but it must not reach a client or a log in the clear.
          const message = redactSecrets(raw, deps.config.apiKey);
          deps.logger.warn({ error: message }, 'managed ai stream failed');
          stream.send('error', { message });
        } finally {
          stream.end();
        }
      } finally {
        if (reserved) {
          await deps.budget
            .settle(subject, usedTokens)
            .catch((error: unknown) =>
              deps.logger.warn({ error: String(error) }, 'could not settle ai budget'),
            );
        }
        deps.concurrency.release(subject);
      }
    },
  );
}
