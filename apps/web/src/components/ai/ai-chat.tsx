/**
 * The AI assistant pane: streaming answers, a live activity timeline, and
 * citations that jump the document pane.
 *
 * The loop owns conversation history, so follow-up questions keep context
 * without this component resending anything. What this adds is the reading
 * experience: every tool the model runs is shown as it happens, every `[page N]`
 * becomes a chip you can click, and the run reports what it cost.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, Check, Loader2, Send, Sparkles, Square, User } from 'lucide-react';
import {
  AgentLoop,
  type AgentRunResult,
  type AgentSkill,
  type AgentTokenUsage,
} from '@pdfshush/ai-agent';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { LIMITS } from '@pdfshush/pdf-core';
import { Button } from '@/components/ui/button';
import { createPdfSkill } from '@/lib/ai/pdf-skill';
import type { AiDocument } from '@/lib/ai/pdf-session';
import { createByokTransport } from '@/lib/ai/transport';
import { createManagedTransport } from '@/lib/ai/managed';
import type { AiMode } from '@/lib/ai/mode';
import { citedPages, splitCitations } from '@/lib/ai/citations';
import { cn } from '@/lib/utils';

/** Friendly verbs for the tools the skills expose, for the activity timeline. */
const TOOL_COPY: Record<string, string> = {
  get_document: 'Reading the document',
  read_pages: 'Reading the pages',
  search_text: 'Searching the text',
  goto_page: 'Showing a page',
  list_pending_edits: 'Checking the queued changes',
  markup_text: 'Queuing a highlight',
  replace_text: 'Queuing a replacement',
  delete_text: 'Queuing an erasure',
  insert_text: 'Queuing new text',
  rotate_pages: 'Queuing a rotation',
  delete_pages: 'Queuing a page deletion',
  set_page_order: 'Queuing a page reorder',
  add_header_footer: 'Queuing a header & footer',
  add_page_numbers: 'Queuing page numbers',
};

interface ChatStep {
  summary: string;
  ok: boolean;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  steps: ChatStep[];
  error?: boolean;
}

interface AiChatProps {
  doc: AiDocument;
  settings: AiSettings;
  /** BYOK (key in this tab) or managed (PDFShush trial); affects only the transport. */
  mode?: AiMode;
  /** Override the skill. Defaults to the read-only PDF skill (chat / summarize). */
  skill?: AgentSkill | undefined;
  /** Active page in the document pane, used to highlight matching citations. */
  activePage?: number;
  /** Show a page when the model calls goto_page or a citation is clicked. */
  onShowPage?(page: number): void;
  /** The pages cited by the answer that just finished. */
  onCitedPages?(pages: number[]): void;
  /** Run this instruction once, as soon as the pane mounts (e.g. a summary request). */
  autoPrompt?: string | undefined;
  /** Copy for the composer. */
  placeholder?: string | undefined;
  /** Starter prompts shown before the first turn. */
  suggestions?: string[] | undefined;
}

let nextMessageId = 1;

/**
 * Join the text of a completed turn with the turn that follows it. A turn that
 * ends to call a tool ("Let me read page 1.") would otherwise run straight into
 * the next turn's prose.
 */
const joinTurns = (settled: string, current: string): string =>
  settled && current ? `${settled}\n\n${current}` : settled || current;

/** Assistant text with each `[page N]` rendered as a jump chip. */
function AnswerText({
  text,
  activePage,
  onShowPage,
}: {
  text: string;
  activePage?: number | undefined;
  onShowPage?(page: number): void;
}) {
  const segments = useMemo(() => splitCitations(text), [text]);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span key={index} className="inline-flex gap-0.5 align-baseline">
            {segment.pages.map((page) => (
              <button
                key={page}
                type="button"
                data-testid="ai-citation"
                onClick={() => onShowPage?.(page)}
                title={`Show page ${page}`}
                className={cn(
                  'mx-0.5 inline-flex items-center rounded px-1 py-px text-[0.7rem] font-medium tabular-nums transition-colors',
                  page === activePage
                    ? 'bg-violet-500 text-white'
                    : 'bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-300',
                )}
              >
                p.{page}
              </button>
            ))}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * Chat over one document. History lives in the loop across runs; this component
 * renders it, shows what the model is doing, and forwards citation clicks.
 */
export function AiChat({
  doc,
  settings,
  mode = 'byok',
  skill,
  activePage,
  onShowPage,
  onCitedPages,
  autoPrompt,
  placeholder,
  suggestions,
}: AiChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [usage, setUsage] = useState<AgentTokenUsage | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const assistantIdRef = useRef<number | null>(null);
  const settledRef = useRef('');
  const fullTextRef = useRef('');
  const showPageRef = useRef(onShowPage);
  showPageRef.current = onShowPage;
  const citedRef = useRef(onCitedPages);
  citedRef.current = onCitedPages;

  const updateAssistant = useCallback((patch: (message: ChatMessage) => ChatMessage) => {
    const id = assistantIdRef.current;
    setMessages((prev) => prev.map((message) => (message.id === id ? patch(message) : message)));
  }, []);

  const transport = useMemo(
    () => (mode === 'managed' ? createManagedTransport() : createByokTransport(() => settingsRef.current)),
    [mode],
  );

  const loop = useMemo(() => {
    const resolved = skill ?? createPdfSkill(doc, { onGotoPage: (page) => showPageRef.current?.(page) });
    let lastCum = '';
    let runUsage: AgentTokenUsage | null = null;
    return new AgentLoop({
      transport,
      skill: resolved,
      maxTurns: LIMITS.ai.clientMaxTurns,
      events: {
        onText(cumulative) {
          lastCum = cumulative;
          const text = joinTurns(settledRef.current, cumulative);
          fullTextRef.current = text;
          updateAssistant((message) => ({ ...message, text }));
        },
        onToolStart(call) {
          setRunningTool(call.name);
        },
        onToolExecuted({ execution }) {
          setRunningTool(null);
          updateAssistant((message) => ({
            ...message,
            steps: [...message.steps, { summary: execution.summary, ok: !execution.isError }],
          }));
        },
        onTurnEnd() {
          settledRef.current = joinTurns(settledRef.current, lastCum);
          lastCum = '';
          setTurnCount((count) => count + 1);
        },
        onUsage(next) {
          runUsage = {
            inputTokens: (runUsage?.inputTokens ?? 0) + (next.inputTokens ?? 0),
            outputTokens: (runUsage?.outputTokens ?? 0) + (next.outputTokens ?? 0),
          };
          setUsage(runUsage);
        },
        onDone(result: AgentRunResult) {
          setBusy(false);
          setRunningTool(null);
          lastCum = '';
          updateAssistant((message) => {
            let text = message.text || settledRef.current || result.text;
            if (result.cancelled) text = text || 'Stopped.';
            if (result.truncated) text = `${text}\n\n_(Response cut off by the output limit.)_`;
            return { ...message, text, error: false };
          });
          const pages = citedPages(fullTextRef.current || result.text);
          if (pages.length > 0) citedRef.current?.(pages);
        },
        onError(error) {
          setBusy(false);
          setRunningTool(null);
          updateAssistant((message) => ({
            ...message,
            text: message.text || 'The request failed.',
            error: true,
            steps: [...message.steps, { summary: error, ok: false }],
          }));
        },
      },
    });
  }, [doc, skill, transport, updateAssistant]);

  const send = useCallback(
    (instruction: string) => {
      const text = instruction.trim();
      if (!text || busy) return;
      settledRef.current = '';
      fullTextRef.current = '';
      const assistantId = nextMessageId++;
      assistantIdRef.current = assistantId;
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId++, role: 'user', text, steps: [] },
        { id: assistantId, role: 'assistant', text: '', steps: [] },
      ]);
      setInput('');
      setBusy(true);
      setTurnCount(0);
      loop.run(text);
    },
    [busy, loop],
  );

  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoPrompt && !autoRanRef.current) {
      autoRanRef.current = true;
      send(autoPrompt);
    }
    // Intentionally keyed to the resolved prompt only; `send` is stable enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt]);

  // Never leave a stream running behind an unmounted pane (navigating away, a new
  // file remounting the chat): the loop is aborted with the component.
  useEffect(() => () => loop.cancel(), [loop]);

  // Keep the newest message in view as it streams.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, runningTool]);

  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const statusLine = runningTool
    ? (TOOL_COPY[runningTool] ?? 'Working') + '…'
    : busy
      ? 'Thinking…'
      : null;
  const usageLabel =
    usage && (usage.inputTokens || usage.outputTokens)
      ? `${usage.inputTokens ?? 0} in · ${usage.outputTokens ?? 0} out`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Ask anything about <span className="font-medium text-foreground">{doc.fileName}</span>.
              Answers cite the pages they came from.
            </p>
            {suggestions?.length ? (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={cn('flex gap-3', message.role === 'user' && 'justify-end')}>
            {message.role === 'assistant' ? (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </span>
            ) : null}

            <div className={cn('min-w-0 flex-1', message.role === 'user' && 'flex justify-end')}>
              {message.role === 'user' ? (
                // Neutral, not the primary fill: the page's primary action is
                // Apply, and a saturated bubble here would out-shout it.
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-border bg-muted px-3.5 py-2 text-sm text-foreground">
                  {message.text}
                </div>
              ) : (
                <div className="space-y-2">
                  {message.steps.length > 0 || (message.id === lastAssistantId && runningTool) ? (
                    <ul className="space-y-1">
                      {message.steps.map((step, index) => (
                        <li
                          key={index}
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                            step.ok
                              ? 'border-border/60 bg-muted/40 text-muted-foreground'
                              : 'border-destructive/30 bg-destructive/10 text-destructive',
                          )}
                        >
                          {step.ok ? (
                            <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                          )}
                          <span className="truncate">{step.summary}</span>
                        </li>
                      ))}
                      {message.id === lastAssistantId && runningTool ? (
                        <li className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs text-primary">
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                          <span className="truncate">{TOOL_COPY[runningTool] ?? 'Working'}…</span>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}

                  {message.text ? (
                    <div data-testid="ai-message-assistant" className={message.error ? 'text-destructive' : undefined}>
                      <AnswerText text={message.text} activePage={activePage} onShowPage={onShowPage} />
                    </div>
                  ) : message.id === lastAssistantId && busy ? (
                    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {statusLine ?? 'Working…'}
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {message.role === 'user' ? (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {usageLabel || (busy && turnCount > 1) ? (
        <div className="flex items-center gap-3 border-t border-border/60 px-4 py-1.5 text-[0.7rem] text-muted-foreground">
          {busy && statusLine ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> {statusLine}
            </span>
          ) : null}
          {busy && turnCount > 1 ? <span>· turn {turnCount + 1}</span> : null}
          {usageLabel ? <span className="ml-auto tabular-nums">{usageLabel} tokens</span> : null}
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <textarea
          data-testid="ai-composer"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder={placeholder ?? 'Ask a question about this PDF…'}
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={() => loop.cancel()} data-testid="ai-stop">
            <Square className="mr-1.5 h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()} data-testid="ai-send">
            <Send className="mr-1.5 h-4 w-4" /> Send
          </Button>
        )}
      </form>
    </div>
  );
}
