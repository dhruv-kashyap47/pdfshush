/**
 * BYOK agent transport.
 *
 * The browser talks to the chosen provider directly, with the user's own key,
 * over `@pdfshush/ai-provider`. This is the web counterpart of the donor's
 * Electron renderer→main IPC hop: same provider stack, no server in between.
 */

import type {
  AgentStreamCallbacks,
  AgentStreamHandle,
  AgentStreamRequest,
  AgentTransport,
} from '@pdfshush/ai-agent';
import {
  activeProvider,
  maxOutputTokensOf,
  streamForProvider,
  type AiSettings,
} from '@pdfshush/ai-provider/browser';
import { redactSecrets } from './settings';

export function createByokTransport(getSettings: () => AiSettings): AgentTransport {
  return {
    stream(request: AgentStreamRequest, cb: AgentStreamCallbacks): AgentStreamHandle {
      const settings = getSettings();
      const provider = activeProvider(settings);
      const config = settings.providers[provider];
      if (!config) {
        // Report asynchronously so callers always observe the same ordering
        // (error then done) regardless of how the failure happened.
        queueMicrotask(() => {
          cb.onError('No AI provider is configured. Add a key in AI settings.');
          cb.onDone();
        });
        return { cancel() {} };
      }

      const controller = new AbortController();
      let announced = false;
      cb.onPhase?.({ kind: 'requesting' });

      streamForProvider(
        provider,
        config,
        request.system,
        request.messages,
        request.tools,
        maxOutputTokensOf(settings),
        {
          signal: controller.signal,
          onDelta(text) {
            if (!announced) {
              announced = true;
              cb.onPhase?.({ kind: 'responding' });
            }
            cb.onDelta(text);
          },
          onReasoningDelta: (text) => cb.onReasoning?.(text),
          onToolCall: (call) => cb.onToolCall(call),
          onStopReason: (reason) => cb.onStopReason?.(reason),
          onUsage: (usage) => cb.onUsage?.(usage),
        },
      )
        .then(() => cb.onDone())
        .catch((error: unknown) => {
          // A user cancel is a normal end, not an error bubble.
          if (controller.signal.aborted) {
            cb.onDone();
            return;
          }
          // The key must never reach the DOM, a log, or a screenshot: scrub it
          // (and anything shaped like one) from a provider message that quotes
          // the request it rejected.
          const message = error instanceof Error ? error.message : String(error);
          cb.onError(redactSecrets(message, config.apiKey));
          cb.onDone();
        });

      return {
        cancel() {
          controller.abort();
        },
      };
    },
  };
}
