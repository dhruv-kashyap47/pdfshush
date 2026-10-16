/**
 * Managed-mode client transport.
 *
 * The PDFShush trial: the browser posts the same turn shape it would send
 * directly to a provider (system + messages + tools) to `/api/ai/chat`, and the
 * server streams Server-Sent Events back from the PDFShush-owned key. This is
 * the one path where document text reaches our server; BYOK keeps it in the tab.
 *
 * One SSE consumer serves both uses: the agent loop (streaming `stream`) and the
 * one-shot asks behind smart redaction (`managedAsk` in ./ask.ts).
 */

import type {
  AgentMessage,
  AgentStreamCallbacks,
  AgentStreamHandle,
  AgentStreamRequest,
  AgentTokenUsage,
  AgentToolCall,
  AgentToolDef,
  AgentTransport,
} from '@pdfshush/ai-agent';

const ENDPOINT = '/api/ai/chat';
const STATUS_ENDPOINT = '/api/tools';

/** Cached capability probe: the SPA asks once per session. */
let probe: Promise<boolean> | null = null;

/** Whether this deployment offers the managed trial (server has a key + model). */
export function managedAvailable(): Promise<boolean> {
  probe ??= (async () => {
    try {
      const response = await fetch(STATUS_ENDPOINT, { credentials: 'same-origin' });
      if (!response.ok) return false;
      const data = (await response.json()) as { ai?: { enabled?: boolean } };
      return Boolean(data.ai?.enabled);
    } catch {
      return false;
    }
  })();
  return probe;
}

/** Drop the cached probe (tests, or after a server change). */
export function resetManagedProbe(): void {
  probe = null;
}

/** The double-submit CSRF token, when the SPA has one (the API does not require it, but echoes the convention). */
function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|; )pdfshush_csrf=([^;]*)/);
  return match?.[1] ? { 'x-csrf-token': decodeURIComponent(match[1]) } : {};
}

export interface ManagedHandlers {
  onMeta?(meta: { provider?: string; model?: string; remainingTokens?: number | null }): void;
  onDelta?(text: string): void;
  onReasoning?(text: string): void;
  onToolCall?(call: AgentToolCall): void;
  onStopReason?(reason: string): void;
  onUsage?(usage: AgentTokenUsage): void;
}

export interface ManagedRequestBody {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolDef[];
}

function dispatchFrame(frame: string, handlers: ManagedHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  switch (event) {
    case 'meta':
      handlers.onMeta?.(payload as { provider?: string; model?: string; remainingTokens?: number | null });
      break;
    case 'delta':
      if (typeof payload.text === 'string') handlers.onDelta?.(payload.text);
      break;
    case 'reasoning':
      if (typeof payload.text === 'string') handlers.onReasoning?.(payload.text);
      break;
    case 'tool':
      if (typeof payload.name === 'string') {
        handlers.onToolCall?.({
          id: typeof payload.id === 'string' ? payload.id : `tool-${Math.random().toString(36).slice(2)}`,
          name: payload.name,
          input: (payload.input as Record<string, unknown>) ?? {},
        });
      }
      break;
    case 'stop':
      if (typeof payload.reason === 'string') handlers.onStopReason?.(payload.reason);
      break;
    case 'usage':
      handlers.onUsage?.(payload as AgentTokenUsage);
      break;
    case 'error':
      throw new Error(typeof payload.message === 'string' ? payload.message : 'The AI request failed.');
    default:
      break;
  }
}

/**
 * Post one turn and drive `handlers` from the SSE response. Resolves when the
 * stream ends; rejects when the request fails or the server sends an error
 * event. Aborting `signal` rejects with an `AbortError`, like `fetch`.
 */
export async function streamManaged(
  body: ManagedRequestBody,
  handlers: ManagedHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...csrfHeader() },
    credentials: 'same-origin',
    body: JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    let message = `The AI request failed (${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Non-JSON body: keep the generic message.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error('The AI stream could not be opened.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      dispatchFrame(frame, handlers);
      separator = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) dispatchFrame(buffer, handlers);
}

/** The agent transport that proxies every turn through the managed endpoint. */
export function createManagedTransport(): AgentTransport {
  return {
    stream(request: AgentStreamRequest, cb: AgentStreamCallbacks): AgentStreamHandle {
      const controller = new AbortController();
      let announced = false;
      cb.onPhase?.({ kind: 'requesting' });

      streamManaged(
        { system: request.system, messages: request.messages, tools: request.tools },
        {
          onDelta(text) {
            if (!announced) {
              announced = true;
              cb.onPhase?.({ kind: 'responding' });
            }
            cb.onDelta(text);
          },
          onReasoning: (text) => cb.onReasoning?.(text),
          onToolCall: (call) => cb.onToolCall(call),
          onStopReason: (reason) => cb.onStopReason?.(reason),
          onUsage: (usage) => cb.onUsage?.(usage),
        },
        controller.signal,
      )
        .then(() => cb.onDone())
        .catch((error: unknown) => {
          // A user cancel is a normal end, not an error bubble.
          if (controller.signal.aborted) {
            cb.onDone();
            return;
          }
          cb.onError(error instanceof Error ? error.message : String(error));
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
