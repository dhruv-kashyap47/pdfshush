/**
 * The assistant rail.
 *
 * Not a chatbot bolted onto an editor: it is the margin beside the document.
 * Instructions are set as short notes, the assistant answers in full-width
 * prose, every tool it runs is a line in a quiet timeline, and every `[page N]`
 * is a citation you can press to move the page. The loop still owns the
 * conversation history, so follow-ups keep context.
 *
 * Motion: new rows rise once, the composer grows with its text, and streaming
 * never re-animates settled rows. Auto-scroll is pinned only while the reader is
 * already at the foot of the thread, so reading back is never yanked away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Check,
  Loader2,
  Sparkles,
  Square,
} from 'lucide-react';
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
import { useMotionScope } from '@/hooks/use-motion';
import { cn } from '@/lib/utils';
import { EASE, dur, staggerUI, prefersReducedMotion } from '@/lib/motion';

/**
 * Own-property lookup for a tool verb. Tool names come from the model event
 * stream, so the indexed read must not resolve inherited keys like
 * `constructor` and pass a function downstream.
 */
function toolCopy(tool: string): string | undefined {
  return Object.hasOwn(TOOL_COPY, tool) ? TOOL_COPY[tool] : undefined;
}

/** Composer growth cap in px; beyond it the textarea scrolls internally. */
const COMPOSER_MAX_HEIGHT = 148;

/** Friendly verbs for the tools the skills expose, for the activity timeline. */
const TOOL_COPY: Record<string, string> = {
  get_document: 'Reading the document',
  read_pages: 'Reading the pages',
  scan_document: 'Surveying every page',
  search_text: 'Searching the text',
  goto_page: 'Showing a page',
  list_pending_edits: 'Checking the queued changes',
  markup_text: 'Queuing a highlight',
  replace_text: 'Queuing a replacement',
  replace_everywhere: 'Queuing replacements across the document',
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
  /** BYOK (key in this tab) or managed (pdfshush trial); affects only the transport. */
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
  /** Rail heading and one-line explanation. */
  title?: string;
  hint?: string;
  /** Empty-state lead line. */
  emptyLead?: string;
  /** Empty-state explanatory sentence; include the document name. */
  emptyCopy?: string;
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
    <p className="studio-answer">
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
                className={cn('studio-cite tabular-nums', page === activePage && 'is-active')}
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
  title = 'Instructions',
  hint = 'The assistant proposes; you decide.',
  emptyLead = 'Describe the change you want.',
  emptyCopy,
}: AiChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [usage, setUsage] = useState<AgentTokenUsage | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
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
    () =>
      mode === 'managed' ? createManagedTransport() : createByokTransport(() => settingsRef.current),
    [mode],
  );

  const loop = useMemo(() => {
    const resolved =
      skill ?? createPdfSkill(doc, { onGotoPage: (page) => showPageRef.current?.(page) });
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
            if (result.cancelled && !result.turnLimit) text = text || 'Stopped.';
            const notes: string[] = [];
            if (result.truncated) notes.push('Response cut off by the output limit.');
            if (result.turnLimit) {
              notes.push('Stopped at the turn limit; ask a narrower follow-up to continue.');
            }
            if (notes.length > 0) text = [text, ...notes].filter(Boolean).join('\n\n');
            return { ...message, text, error: false };
          });
          const pages = citedPages(fullTextRef.current || result.text);
          citedRef.current?.(pages);
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

  /**
   * Auto-follow the stream only while the reader is at the foot of the thread.
   * Scrolling up to re-read an earlier answer must not be undone on the next
   * token.
   */
  const pinnedRef = useRef(true);

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
      pinnedRef.current = true;
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

  /**
   * Auto-follow the stream only while the reader is at the foot of the thread.
   * Scrolling up to re-read an earlier answer must not be undone on the next
   * token.
   */
  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
  }, []);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !pinnedRef.current) return;
    node.scrollTo({
      top: node.scrollHeight,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [messages, runningTool]);

  /**
   * The thread changes height when the ledger expands or a panel is resized.
   * If the reader was at the foot, keep them there; if they had scrolled up,
   * leave their position untouched.
   */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Entrance choreography. Every row (message, tool step, running tool) carries
   * a stable `data-motion-id`; those seen for the first time rise in with the
   * shared enter ease. The seen-set keeps the streaming text from re-animating
   * settled rows many times a second.
   */
  const motion = useMotionScope();
  const seenMotionRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || prefersReducedMotion()) return;
    const fresh: HTMLElement[] = [];
    for (const node of root.querySelectorAll<HTMLElement>('[data-motion-id]')) {
      const id = node.dataset.motionId;
      if (!id || seenMotionRef.current.has(id)) continue;
      seenMotionRef.current.add(id);
      fresh.push(node);
    }
    if (fresh.length === 0) return;
    for (const node of fresh) node.style.opacity = '0';
    motion.animate(fresh, {
      translateY: [8, 0],
      opacity: [0, 1],
      duration: dur(340),
      ease: EASE.out,
      delay: staggerUI(45),
    });
  }, [messages, runningTool, motion]);
  useEffect(() => () => seenMotionRef.current.clear(), []);

  // The composer grows with its text (capped, then it scrolls).
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [input]);

  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const statusLine = runningTool
    ? (toolCopy(runningTool) ?? 'Working') + '…'
    : busy
      ? 'Thinking…'
      : null;
  const usageLabel =
    usage && (usage.inputTokens || usage.outputTokens)
      ? `${usage.inputTokens ?? 0} in, ${usage.outputTokens ?? 0} out`
      : null;

  return (
    <section className="studio-chat" aria-label={title}>
      <header className="studio-chat-head">
        <div className="min-w-0 flex-1">
          <p className="studio-chat-title">{title}</p>
          <p className="studio-chat-hint">{hint}</p>
        </div>
        <span
          className={cn('studio-live', busy ? 'is-busy' : 'is-quiet')}
          title={busy ? 'The assistant is working' : 'The assistant is idle'}
          role="status"
          aria-live="polite"
        >
          <span className="studio-live-dot" aria-hidden />
          {busy ? 'Working' : 'Ready'}
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="studio-thread"
        role="log"
        aria-label="Assistant conversation"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="studio-empty">
            <p data-motion-id="welcome:lead" className="studio-empty-lead">
              {emptyLead}
            </p>
            <p data-motion-id="welcome:copy" className="studio-empty-copy">
              {emptyCopy ?? (
                <>
                  It reads <span className="font-medium text-foreground">{doc.fileName}</span> page
                  by page. Every proposed change waits for your approval.
                </>
              )}
            </p>
            {suggestions?.length ? (
              <div className="mt-4 space-y-px">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    type="button"
                    data-motion-id={`welcome:suggestion:${index}`}
                    onClick={() => send(suggestion)}
                    className="studio-suggestion group"
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-left">{suggestion}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            data-motion-id={`msg:${message.id}`}
            className={cn('studio-turn', message.role === 'user' ? 'is-user' : 'is-assistant')}
          >
            <p className="studio-turn-label">{message.role === 'user' ? 'You' : 'Assistant'}</p>

            {message.role === 'user' ? (
              <div className="studio-instruction">{message.text}</div>
            ) : (
              <div className="space-y-2">
                {message.steps.length > 0 || (message.id === lastAssistantId && runningTool) ? (
                  <ol className="studio-steps">
                    {message.steps.map((step, index) => (
                      <li
                        key={index}
                        data-motion-id={`${message.id}:step:${index}`}
                        className={cn('studio-step', !step.ok && 'is-error')}
                      >
                        <span className="studio-step-dot" aria-hidden>
                          {step.ok ? (
                            <Check className="h-2.5 w-2.5" />
                          ) : (
                            <AlertTriangle className="h-2.5 w-2.5" />
                          )}
                        </span>
                        <span className="truncate">{step.summary}</span>
                      </li>
                    ))}
                    {message.id === lastAssistantId && runningTool ? (
                      <li
                        data-motion-id={`${message.id}:running:${runningTool}`}
                        className="studio-step is-running"
                      >
                        <span className="studio-step-dot" aria-hidden>
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        </span>
                        <span className="truncate">{toolCopy(runningTool) ?? 'Working'}…</span>
                      </li>
                    ) : null}
                  </ol>
                ) : null}

                {message.text ? (
                  <div
                    data-testid="ai-message-assistant"
                    data-motion-id={`${message.id}:text`}
                    className={message.error ? 'text-destructive' : undefined}
                  >
                    <AnswerText
                      text={message.text}
                      activePage={activePage}
                      onShowPage={onShowPage}
                    />
                  </div>
                ) : message.id === lastAssistantId && busy ? (
                  <p className="studio-thinking">
                    <span className="studio-thinking-rule" aria-hidden />
                    {statusLine ?? 'Working…'}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {usageLabel || (busy && turnCount > 1) ? (
        <div className="studio-thread-foot">
          {busy && statusLine ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> {statusLine}
            </span>
          ) : null}
          {busy && turnCount > 1 ? <span>, pass {turnCount + 1}</span> : null}
          {usageLabel ? <span className="ml-auto tabular-nums">{usageLabel}</span> : null}
        </div>
      ) : null}

      <form
        className="studio-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <div className="studio-composer-box">
          <label className="sr-only" htmlFor="studio-instruction">
            {title}
          </label>
          <textarea
            id="studio-instruction"
            ref={composerRef}
            data-testid="ai-composer"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder={placeholder ?? 'Ask a question about this PDF…'}
            className="studio-textarea"
          />
          <div className="studio-composer-bar">
            <span className="studio-composer-hint">
              {busy ? 'Streaming the answer' : 'Enter to send. Shift + Enter for a new line.'}
            </span>
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="studio-stop"
                onClick={() => loop.cancel()}
                data-testid="ai-stop"
              >
                <Square className="h-3 w-3" />
                <span className="sr-only">Stop</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="studio-send"
                disabled={!input.trim()}
                data-testid="ai-send"
                aria-label="Send instruction"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
