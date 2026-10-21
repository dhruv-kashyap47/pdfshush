/**
 * The AI welcome overlay: a full-screen, three-step walkthrough for people who
 * have never bought an API key, shown the first time an AI tool is opened
 * without one. It presents ONE easy path (a free Groq key, guided click by
 * click) plus an escape hatch to the managed trial, and never blocks —
 * "Skip for now" and Escape are always one press away.
 *
 * Motion contract (lib/motion.ts): transform + opacity only, every animation
 * parked on the per-component scope so unmount cancels everything, and zero
 * duration under prefers-reduced-motion. Entrance is a timeline (backdrop
 * fade, panel rise, staggered interactive affordances), step changes are tiny
 * translate reveals, the paste field pulses once on focus, and a save flashes
 * the check before the parent unmounts the overlay.
 *
 * The provider decision stays the user's: this walkthrough merely *selects*
 * Groq as the easy path — every option remains in the settings card, which is
 * the honest source of truth afterwards. Saving here goes through the same
 * `onSave` pipeline; nothing writes credentials directly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  KeyRound,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { createTimeline } from 'animejs';
import { AI_PROVIDERS, type AiSettings } from '@pdfshush/ai-provider/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMotionScope } from '@/hooks/use-motion';
import { dur, EASE } from '@/lib/motion';

interface AiWelcomeOverlayProps {
  settings: AiSettings;
  /** Persist + adopt the settings completed here (same pipeline as the card). */
  onSave(settings: AiSettings): void;
  /** Whether this deployment offers the managed trial ("use ours instead"). */
  managedAvailable: boolean;
  /** Switch to the managed trial (the parent owns the mode). */
  onUseManaged(): void;
  /** Close without configuring anything ("skip for now"). */
  onDismiss(): void;
}

/** The provider the walkthrough ends on; the picker keeps every other option. */
const GROQ_URL = 'https://console.groq.com/keys';

const STEP_COUNT = 3;

export function AiWelcomeOverlay({
  settings,
  onSave,
  managedAvailable,
  onUseManaged,
  onDismiss,
}: AiWelcomeOverlayProps) {
  const motion = useMotionScope();
  const [step, setStep] = useState(1);
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);

  const groqMeta = AI_PROVIDERS.find((m) => m.id === 'groq');

  /* ── Entrance: backdrop fades, panel rises, controls stagger in ───────── */
  useEffect(() => {
    const timeline = createTimeline({ defaults: { ease: EASE.out } });
    motion.park(timeline);
    if (backdropRef.current) {
      timeline.add(backdropRef.current, { opacity: [0, 1], duration: dur(280) });
    }
    if (panelRef.current) {
      timeline.add(
        panelRef.current,
        { opacity: [0, 1], translateY: [16, 0], scale: [0.98, 1], duration: dur(420) },
        '-=120',
      );
    }
    // Only the interactive scaffold fades; the text is visible from the first
    // paint so the overlay never flashes empty while entering.
    const controls = panelRef.current?.querySelectorAll('button, input, a');
    if (controls?.length) {
      timeline.add(controls, { opacity: [0, 1], duration: dur(240), delay: dur(60) }, '-=240');
    }
    timeline.play();
    return () => {
      timeline.pause();
    };
  }, [motion]);

  /* ── Step transitions ─────────────────────────────────────────────────── */
  useEffect(() => {
    const body = stepBodyRef.current;
    if (!body) return;
    motion.animate(body, {
      translateY: [10, 0],
      opacity: [0, 1],
      duration: dur(260),
      ease: EASE.soft,
    });
  }, [step, motion]);

  // Escape backs out like "Skip for now" — the overlay must never trap a user.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  /* ── Actions ──────────────────────────────────────────────────────────── */

  /** Next step, with Groq selected so step 3 completes that config. The key
   * field is initially empty — never prefilled with what the user typed
   * before; the card's own field also stays untouched until a save happens. */
  const openConsole = useCallback(() => {
    if (groqMeta) {
      const config = settings.providers['groq'] ?? { apiKey: '', model: groqMeta.defaultModel };
      onSave({
        ...settings,
        provider: 'groq',
        providers: {
          ...settings.providers,
          groq: { apiKey: config.apiKey, model: config.model || groqMeta.defaultModel },
        },
      });
    }
    window.open(GROQ_URL, '_blank', 'noopener,noreferrer');
    setStep(3);
  }, [groqMeta, onSave, settings]);

  const saveKey = useCallback(() => {
    const trimmed = key.trim();
    if (!trimmed || !groqMeta) return;
    setSaved(true);
    onSave({
      ...settings,
      provider: 'groq',
      providers: {
        ...settings.providers,
        groq: { apiKey: trimmed, model: settings.providers['groq']?.model || groqMeta.defaultModel },
      },
    });
    // The badge pauses a beat so the pulse reads, then the parent unmounts us.
    window.setTimeout(() => onDismiss(), 650);
  }, [groqMeta, key, onDismiss, onSave, settings]);

  const successPulse = useCallback(
    (el: HTMLElement) => {
      motion.animate(el, { scale: [1, 1.015, 1], duration: dur(320), ease: EASE.soft });
    },
    [motion],
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4" data-testid="ai-welcome">
      <div ref={backdropRef} className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Getting started with AI"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-transparent px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Turn on AI features</h2>
              <p className="text-xs text-muted-foreground">
                Summarize, chat, edit and redact any PDF
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Skip for now"
            data-testid="ai-welcome-dismiss"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 px-6 pt-5" aria-hidden="true">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                index < step ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
        <p
          className="px-6 pt-2 text-[0.7rem] uppercase tracking-wide text-muted-foreground"
          aria-hidden="true"
        >
          Step {step} of {STEP_COUNT}
        </p>

        <div ref={stepBodyRef} className="px-6 pb-2" data-testid="ai-welcome-body">
          {step === 1 ? (
            <div className="py-3">
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="font-medium text-sm">AI needs one tiny thing: a key</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    It's like a password that tells the AI "this person is allowed". Nothing more — a
                    short code you copy and paste, and your files never leave this browser.
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                You can get one <strong>for free</strong> in about two minutes — no credit card.
                We'll walk you through it.
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="py-3">
              <ol className="space-y-2.5" data-testid="ai-welcome-guide">
                {[
                  'Press the button below — it opens the key page in a new tab.',
                  'Log in (Google is fine) and press "Create API Key".',
                  'Click Copy on the code it shows you.',
                  'Come back and paste it in the next step.',
                ].map((line, index) => (
                  <li key={index} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-[0.7rem] font-medium tabular-nums">
                      {index + 1}
                    </span>
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ol>
              <Button
                type="button"
                className="mt-4 w-full"
                size="sm"
                data-testid="ai-welcome-open-console"
                onClick={openConsole}
              >
                <MousePointerClick className="mr-1.5 h-4 w-4" />
                Open Groq (free)
                <ArrowRight className="ml-auto h-4 w-4" />
              </Button>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                No card, no trial clock. Groq's free tier is enough for everyday PDF work.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="py-3">
              <label className="grid gap-2" htmlFor="ai-welcome-key">
                <span className="text-sm font-medium">Paste your key here</span>
                <Input
                  id="ai-welcome-key"
                  data-testid="ai-welcome-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder="gsk_..."
                  onChange={(event) => setKey(event.target.value)}
                  onFocus={(event) => successPulse(event.currentTarget)}
                />
                <span className="text-xs text-muted-foreground">
                  Starts with gsk_ . It stays in this browser and is sent only to Groq.
                </span>
              </label>
              <Button
                type="button"
                className="mt-4 w-full"
                size="sm"
                disabled={!key.trim()}
                data-testid="ai-welcome-save"
                onClick={saveKey}
              >
                {saved ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> You're all set
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 h-4 w-4" /> Save &amp; start using AI
                  </>
                )}
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Didn't get a key yet? Press "Skip for now" — the normal settings are still there.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!managedAvailable}
            title={managedAvailable ? undefined : 'Not offered by this deployment'}
            data-testid="ai-welcome-managed"
            onClick={() => {
              onUseManaged();
              onDismiss();
            }}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            Too much? Use ours
          </Button>
          {step < STEP_COUNT ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
