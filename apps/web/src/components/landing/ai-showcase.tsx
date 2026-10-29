import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Eraser,
  Eye,
  FileText,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  EASE,
  dur,
  onEnterViewport,
  prefersReducedMotion,
  staggerUI,
  timelineUI,
} from '@/lib/motion';
import { useMotionScope } from '@/hooks/use-motion';

/* ─────────────────────────────────────────────────────────────────────────
   The demo is the pitch: three real capabilities, one synthetic document
   each, and a state machine that mirrors what the actual tools do —
   ask → cited answer, describe → review plan → apply, detect → burn → verify.
   Nothing here calls the network; every number and string is authored copy.
   ───────────────────────────────────────────────────────────────────────── */

type ModeId = 'chat' | 'edit' | 'redact';
/** Thinking = simulated local processing, answer = result surfaced. */
type Phase = 'thinking' | 'answer';
/** How the mock editor holds a proposed natural-language edit. */
type PaperState = 'proposed' | 'applied' | 'discarded';

interface DocField {
  id: string;
  label: string;
  value: string;
}

interface ModeDoc {
  file: string;
  title: string;
  sub: string;
  page: string;
  /** Two context clauses above the active target run. */
  intro: Array<{ title: string; text: string }>;
  outro: string;
  /** Redact mode: the detected fields the engine can burn. */
  fields?: DocField[];
}

interface EditPlan {
  kind: 'replace' | 'highlight' | 'stamp';
  /** Text inside `highlight` that the edit touches. */
  find?: string;
  /** What the find text becomes. For `stamp`, the header text. */
  with?: string;
}

interface Prompt {
  label: string;
  /** Italic line shown while the local engine "reads" (thinking state). */
  thinking: string;
  answer: string;
  citation: string;
  /** The exact text run the document preview highlights. */
  highlight: string;
  /** Edit mode: the reviewable plan behind the answer. */
  apply?: EditPlan;
  /** Redact mode: field ids the engine burns for this prompt. */
  redacts?: string[];
  /** Redact mode: adds the verification gate readout. */
  verified?: boolean;
}

interface Mode {
  id: ModeId;
  label: string;
  icon: LucideIcon;
  /** Tab-adjacent explainer: what this does, when you want it. */
  blurb: string;
  consoleTitle: string;
  questionsLabel: string;
  slug: string;
  cta: string;
  toolNote: string;
  doc: ModeDoc;
  prompts: Prompt[];
}

const MODES: Mode[] = [
  {
    id: 'chat',
    label: 'Chat with a page',
    icon: MessageSquare,
    blurb:
      'Ask anything about the file, and the answer quotes the exact page it came from. Best when a fact is buried in a long contract.',
    consoleTitle: 'Conversation console',
    questionsLabel: 'Click an example question:',
    slug: 'chat-with-pdf',
    cta: 'Launch Chat with PDF',
    toolNote: 'Free, in-browser, nothing uploaded: answers cite their page.',
    doc: {
      file: 'sample-contract.pdf',
      title: 'ENTERPRISE SERVICE AGREEMENT',
      sub: 'Section 8.4 · Terms, renewal and SLA commitments',
      page: 'Page 18 of 32',
      intro: [
        { title: '1. Term & Renewal.', text: 'This Agreement begins on the Effective Date and renews automatically for successive twelve (12) month periods unless terminated with written notice.' },
        { title: '2. Definitions.', text: '“Downtime” means any unavailability exceeding five (5) consecutive minutes, measured per calendar month.' },
      ],
      outro:
        'This Agreement supersedes all prior informal quotations and binds respective successors and assigns.',
    },
    prompts: [
      {
        label: 'What notice ends the contract?',
        thinking: 'Parsing Section 8.4 for termination terms…',
        answer:
          'Either party may end the contract without cause by giving written notice at least thirty (30) days before the current term expires.',
        citation: '[p. 18]',
        highlight:
          'Either party may terminate without cause by providing written notice at least thirty (30) days prior to the expiration of the then-current term.',
      },
      {
        label: 'What uptime do we get?',
        thinking: 'Scanning the SLA schedule…',
        answer:
          'The provider guarantees 99.9% monthly availability, and downtime beyond that earns a 10% credit on the next invoice.',
        citation: '[p. 18]',
        highlight:
          'The provider guarantees 99.9% monthly availability. Downtime exceeding 0.1% results in a 10% credit applied to the next billing cycle.',
      },
      {
        label: 'Are audit logs kept?',
        thinking: 'Checking the records-retention section…',
        answer:
          'Yes. Audit records and administrative logs are kept in encrypted cold storage for at least twelve (12) months.',
        citation: '[p. 19]',
        highlight:
          'Audit records and administrative activity logs are retained in encrypted cold storage for a statutory minimum of twelve (12) months.',
      },
    ],
  },
  {
    id: 'edit',
    label: 'Natural language edit',
    icon: Wand2,
    blurb:
      'Describe the change in plain words, review the exact plan, and apply it only if you approve. Best for rewording, highlighting and stamping.',
    consoleTitle: 'Edit review console',
    questionsLabel: 'Describe the change, then approve it:',
    slug: 'edit-pdf-with-ai',
    cta: 'Launch AI Editor',
    toolNote: 'Free, in-browser: every change waits for your approval.',
    doc: {
      file: 'sample-nda.pdf',
      title: 'MUTUAL NON-DISCLOSURE AGREEMENT',
      sub: 'Governing law and confidentiality scope',
      page: 'Page 3 of 6',
      intro: [
        { title: '1. Purpose.', text: 'The parties wish to explore a business relationship and may disclose confidential information to each other for evaluation.' },
        { title: '2. Scope.', text: '“Confidential Information” includes non-public business, technical and financial information exchanged hereunder.' },
      ],
      outro:
        'Any amendment must be made in writing and signed by an authorised officer of each party.',
    },
    prompts: [
      {
        label: 'Make governing law Delaware',
        thinking: 'Planning the edit: locating the clause…',
        answer:
          'Found the governing-law clause. Plan: replace “State of New York” with “State of Delaware”. Nothing is written until you approve.',
        citation: '[p. 3]',
        highlight:
          'This Agreement shall be governed by and construed in accordance with the laws of the State of New York.',
        apply: { kind: 'replace', find: 'State of New York', with: 'State of Delaware' },
      },
      {
        label: 'Highlight the expiry dates',
        thinking: 'Planning the edit: searching date patterns…',
        answer:
          'One expiry clause on this page. Plan: amber-highlight “five (5) years from the Effective Date”.',
        citation: '[p. 3]',
        highlight:
          'The obligations of confidentiality shall endure for a period of five (5) years from the Effective Date.',
        apply: { kind: 'highlight', find: 'five (5) years from the Effective Date' },
      },
      {
        label: 'Stamp the header confidential',
        thinking: 'Planning the edit: drafting the stamp…',
        answer:
          'Plan: insert a vector header “CONFIDENTIAL · INTERNAL USE ONLY” on every page of the document. Reversible until approved.',
        citation: '[all 6 pages]',
        highlight: 'Header insertion · planned on every page of the document.',
        apply: { kind: 'stamp', with: 'CONFIDENTIAL · INTERNAL USE ONLY' },
      },
    ],
  },
  {
    id: 'redact',
    label: 'Destructive redaction',
    icon: Eraser,
    blurb:
      'Finds private data (tax IDs, bank details) and burns it out of the page bitmap, so the text is gone, not hidden. Best before sharing a file.',
    consoleTitle: 'Sanitisation console',
    questionsLabel: 'Run the local detector on this page:',
    slug: 'redact-pdf',
    cta: 'Launch Redaction Tool',
    toolNote: 'Free, in-browser: deletion is burned in, then provable.',
    doc: {
      file: 'sample-invoice.pdf',
      title: 'VENDOR INVOICE & PAYMENT DIRECTIVE',
      sub: 'Wire instructions and tax identification',
      page: 'Page 1 of 2',
      intro: [
        { title: 'Vendor.', text: 'Northstar Systems Ltd · Invoice Nº NS-2209 · Due: Net 30 · Pay to: Northstar Payments Department.' },
        { title: 'Method.', text: 'Payment is accepted by direct ACH transfer only; wire fees are borne by the paying party.' },
      ],
      outro: 'All remittance questions go to the payments desk at the address printed on the reverse.',
      fields: [
        { id: 'ein', label: 'TAX IDENTIFICATION (EIN)', value: '12-3456789' },
        { id: 'route', label: 'ROUTING (ABA)', value: '021000021' },
        { id: 'acct', label: 'ACCOUNT NO.', value: '9876543210' },
      ],
    },
    prompts: [
      {
        label: 'Detect taxpayer identifiers',
        thinking: 'Running local pattern detection…',
        answer:
          'One employer identification number found on this page. It is targeted for a permanent pixel wipe, not a black rectangle.',
        citation: '[p. 1]',
        highlight: 'Detected on this page:',
        redacts: ['ein'],
      },
      {
        label: 'Scrub the bank wire details',
        thinking: 'Matching routing and account patterns…',
        answer:
          'Two fields matched: the routing code and the account number. Both burn out of the bitmap together.',
        citation: '[p. 1]',
        highlight: 'Detected on this page:',
        redacts: ['route', 'acct'],
      },
      {
        label: 'Verify nothing survives',
        thinking: 'Rebuilding the page and re-checking output…',
        answer:
          'The saved file reopens with zero text runs, no annotations and stripped metadata. Verification gate passed.',
        citation: '[Verified]',
        highlight: 'Detected on this page:',
        redacts: ['ein', 'route', 'acct'],
        verified: true,
      },
    ],
  },
];

/* ── Small view helpers ─────────────────────────────────────────────────── */

/** Word-cascade reveal: one span per word so anime can stagger them without
 *  ever shifting layout — spans reserve their space while invisible. */
function WordCascade({ text }: { text: string }) {
  const words = useMemo(() => text.split(' '), [text]);
  return (
    <>
      {words.map((word, i) => (
        <span key={i} data-word style={{ display: 'inline-block', whiteSpace: 'pre' }}>
          {word}
          {i < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </>
  );
}

/** Splits the highlight run into [before, find, after] for the tracked-change
 *  view; null when the plan does not target a substring. */
function splitFind(highlight: string, find?: string): [string, string, string] | null {
  if (!find) return null;
  const index = highlight.indexOf(find);
  if (index < 0) return null;
  return [highlight.slice(0, index), find, highlight.slice(index + find.length)];
}

/** Array equality on id strings; keeps setBurned() from re-render loops. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function AiShowcase() {
  const [modeId, setModeId] = useState<ModeId>('chat');
  const [promptIndex, setPromptIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('answer');
  const [paperState, setPaperState] = useState<PaperState>('proposed');
  const [burned, setBurned] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState('');

  /* Deriving mode/prompt from static data keeps references stable across
     renders, so effects that depend on them only run on real selections. */
  const mode = MODES.find((m) => m.id === modeId) ?? MODES[0]!;
  const prompt = mode.prompts[promptIndex] ?? mode.prompts[0]!;

  const motion = useMotionScope();
  const docPageRef = useRef<HTMLElement>(null);
  const docTargetRef = useRef<HTMLDivElement>(null);
  const docFlashRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = prefersReducedMotion();

  /* Every simulated engine timer is internal state, not animation, so it is
     cancelled on unmount and on explicit selections rather than "animated". */
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
    };
  }, []);

  const selectMode = (next: ModeId, index: number) => {
    if (next === modeId) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setModeId(next);
    setPromptIndex(0);
    setPhase('answer');
    setPaperState('proposed');
    setBurned([]);
    setVerified(false);
    setPeeking(false);
    setThinkingLabel('');
    // Tab press: a short, quiet pop — the only anime on the tab bar.
    const tab = tabRefs.current[index];
    if (tab) {
      motion.animate(tab, { scale: [1, 1.05, 1], duration: dur(360), ease: EASE.soft });
    }
  };

  const selectPrompt = (index: number) => {
    if (timerRef.current !== null) return; // one question at a time
    const next = mode.prompts[index];
    if (!next) return;
    setPromptIndex(index);
    setPhase('thinking');
    setThinkingLabel(next.thinking);
    setPaperState('proposed');
    setVerified(false);
    setPeeking(false);
    setBurned([]);
    // The round-trip is a state machine beat, not an animation: reduced motion
    // still shows the "Working" phase, just shorter.
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPhase('answer');
    }, reducedMotion ? 420 : mode.id === 'redact' ? 1250 : 950);
  };

  /* ── Effect: answer lands (flash, cascade, burn-fetch) ────────────────── */
  useEffect(() => {
    if (phase !== 'answer') return;

    // Redact: the answer declares its burn set. Guarded so re-renders can't
    // re-run the set (and the effect) in circles.
    if (mode.id === 'redact') {
      const next = prompt.redacts ?? [];
      setBurned((prev) => (sameIds(prev, next) ? prev : next));
    }

    const target = docTargetRef.current;
    if (target) {
      motion.animate(target, { opacity: [0.38, 1], duration: dur(320), ease: EASE.soft });
      if (docFlashRef.current) {
        motion.animate(docFlashRef.current, {
          opacity: [
            { to: 0.35, duration: dur(150) },
            { to: 0, duration: dur(520), ease: EASE.inOut },
          ],
        });
      }
      // No page movement on answer landing: on phones the assistant is where
      // the user is looking. The citation chip is the explicit route back to
      // the document.
    }

    const words = answerRef.current?.querySelectorAll('[data-word]');
    if (words && words.length) {
      motion.animate(words, {
        opacity: [0, 1],
        y: [4, 0],
        duration: dur(340),
        ease: EASE.out,
        delay: staggerUI(13),
      });
    }
  }, [phase, modeId, promptIndex, mode, prompt, motion]);

  /* ── Effect: thinking state (dim target + scan sweep) ─────────────────── */
  useEffect(() => {
    if (phase !== 'thinking') return;
    const target = docTargetRef.current;
    if (target) {
      motion.animate(target, { opacity: 0.38, duration: dur(240), ease: EASE.soft });
    }
    // Scan sweep is redact's cause-and-effect shot: one line, one pass.
    if (mode.id === 'redact' && docPageRef.current && scanRef.current) {
      const travel = docPageRef.current.offsetHeight + 64;
      const tl = timelineUI({ defaults: { ease: 'linear' } });
      tl.add(scanRef.current, { y: [-56, travel], duration: 1250 }, 0);
      tl.add(scanRef.current, { opacity: [0, 1], duration: 140 }, 0);
      tl.add(scanRef.current, { opacity: 0, duration: 320 }, 1000);
      motion.park(tl);
    }
  }, [phase, mode, motion]);

  /* ── Effect: burning the detected fields (redact) ─────────────────────── */
  useEffect(() => {
    if (!burned.length) return;
    const boxes = docPageRef.current?.querySelectorAll('[data-burn-box]');
    if (boxes && boxes.length) {
      motion.animate(boxes, {
        scaleX: [0, 1],
        duration: dur(480),
        ease: EASE.soft,
        delay: staggerUI(120),
      });
    }
  }, [burned, modeId, motion]);

  /* ── Effect: verification gate readout for the verified prompt ────────── */
  useEffect(() => {
    if (phase !== 'answer' || !prompt.verified) return;
    // The gate announces only after the boxes finish burning.
    const t = window.setTimeout(() => setVerified(true), reducedMotion ? 250 : 950);
    return () => window.clearTimeout(t);
  }, [phase, prompt, reducedMotion]);

  /* ── Effect: applied tracked-change markup (edit) ─────────────────────── */
  useEffect(() => {
    if (phase !== 'answer' || mode.id !== 'edit' || paperState !== 'applied') return;
    const page = docPageRef.current;
    const strikes = page?.querySelectorAll('[data-strike]');
    if (strikes && strikes.length) {
      motion.animate(strikes, { scaleX: [0, 1], duration: dur(280), ease: EASE.soft });
    }
    const deltas = page?.querySelectorAll('.applied-delta, .applied-mark');
    if (deltas && deltas.length) {
      motion.animate(deltas, {
        opacity: [0, 1],
        scale: [0.96, 1],
        duration: dur(320),
        ease: EASE.out,
        delay: staggerUI(60),
      });
    }
  }, [phase, mode, paperState, promptIndex, motion]);

  /* ── Effect: the stamp slam (edit + stamp plan applied) ────────────────── */
  useEffect(() => {
    if (mode.id !== 'edit' || paperState !== 'applied' || prompt.apply?.kind !== 'stamp') return;
    if (!stampRef.current) return;
    motion.animate(stampRef.current, {
      opacity: [0, 1],
      scale: [1.3, 1],
      rotate: [-16, -5],
      duration: dur(460),
      ease: EASE.out,
    });
  }, [mode, paperState, prompt, motion]);

  /* ── Effect: section console entrance (anime, IO-gated, once) ─────────── */
  useEffect(() => {
    const el = consoleRef.current;
    if (!el || reducedMotion) return;
    // Pre-paint gate: the console is below the fold on load, so hiding it
    // here can never flash; the IO below then reveals it exactly once.
    el.style.opacity = '0';
    const disarm = onEnterViewport(el, () => {
      const tl = timelineUI({ defaults: { ease: EASE.out } });
      tl.add(el, { opacity: [0, 1], y: [26, 0], duration: 720 });
      motion.park(tl);
    });
    return disarm;
  }, [reducedMotion, motion]);

  /* ── Interactions ─────────────────────────────────────────────────────── */

  /** Clickable citation: bring the cited run into view and flash it. */
  const revealCitation = () => {
    const target = docTargetRef.current;
    if (!target) return;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    if (docFlashRef.current) {
      motion.animate(docFlashRef.current, {
        opacity: [
          { to: 0.45, duration: dur(150) },
          { to: 0, duration: dur(620), ease: EASE.inOut },
        ],
      });
    }
  };

  /** Peek: the burned boxes part for a beat, then re-burn. Under reduced
   *  motion the same reveal happens as instant states (no animation). */
  const peekBurned = () => {
    if (peeking || burned.length === 0) return;
    const boxesEl = docPageRef.current?.querySelectorAll<HTMLElement>('[data-burn-box]');
    if (!boxesEl || !boxesEl.length) return;
    setPeeking(true);
    if (reducedMotion) {
      boxesEl.forEach((b) => (b.style.opacity = '0.08'));
      peekTimerRef.current = window.setTimeout(() => {
        boxesEl.forEach((b) => (b.style.opacity = '1'));
        setPeeking(false);
      }, 900);
      return;
    }    motion.animate(boxesEl, {
      opacity: [
        { to: 0.08, duration: 240, ease: EASE.soft },
        { to: 0.08, duration: 640 },
        { to: 1, duration: 420, ease: EASE.soft },
      ],
      onComplete: () => setPeeking(false),
    });
  };

  /* ── Roving-tabindex keyboard model (arrow keys, Home, End) ───────────── */
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = MODES.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    selectMode(MODES[next]!.id, next);
    tabRefs.current[next]?.focus();
  };

  /* ── Document target run rendering (mode-aware) ───────────────────────── */
  const introFirst = mode.doc.intro[0];
  const introSecond = mode.doc.intro[1];

  const renderTargetRun = () => {
    if (mode.id === 'chat') {
      return <p className="min-h-[3.4rem]">{prompt.highlight}</p>;
    }

    if (mode.id === 'edit') {
      const plan = prompt.apply!;
      if (plan.kind === 'stamp') {
        return (
          <p className="min-h-[3.4rem]">
            Insert into the running header: <em className="doc-ink-soft">{plan.with}</em>
          </p>
        );
      }
      const parts = splitFind(prompt.highlight, plan.find);
      if (!parts) return <p className="min-h-[3.4rem]">{prompt.highlight}</p>;
      const [before, find, after] = parts;

      if (paperState === 'applied' && plan.kind === 'replace') {
        // Tracked-change view: the old phrase struck, the inserted phrase lit.
        return (
          <p className="min-h-[3.4rem]">
            {before}
            <span className="relative inline-block" data-old-run>
              <span className="text-foreground/50">{find}</span>
              <span className="strike-line" data-strike aria-hidden="true" />
            </span>{' '}
            <span className="applied-delta">{plan.with}</span>
            {after}
          </p>
        );
      }
      if (paperState === 'applied' && plan.kind === 'highlight') {
        return (
          <p className="min-h-[3.4rem]">
            {before}
            <span className="applied-mark">{find}</span>
            {after}
          </p>
        );
      }
      // Proposed (or discarded: the flag lives in the console, paper resets).
      return (
        <p className="min-h-[3.4rem]">
          {before}
          <span className="doc-proposed">{find}</span>
          {after}
        </p>
      );
    }

    /* Redact: the detected fields, each carrying a burn-box overlay. */
    const fields = mode.doc.fields ?? [];
    return (
      <div className="min-h-[3.4rem] space-y-2">
        {fields.map((field) => {
          const isBurned = burned.includes(field.id);
          return (
            <div key={field.id} className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] doc-ink-soft">
                {field.label}
              </span>
              <span className="relative inline-block text-[12.5px] font-semibold tabular-nums tracking-[0.08em]">
                {field.value}
                {isBurned && (
                  <span data-burn-box={field.id} className="redact-box" aria-hidden="true" />
                )}
              </span>
            </div>
          );
        })}
        {verified && (
          <div className="flex items-center gap-1.5 pt-1" data-verify-row>
            <span className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              0 text runs · pixels burned · metadata clean
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <section id="ai-studio" className="bg-background py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-3xl" data-reveal>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            AI that cites the page.
          </h2>
          {/* Orientation for the demo: a working mock, not a screenshot. */}
          <p className="mt-3 text-base text-foreground sm:text-lg">
            Pick a capability, click an example, and watch the document react. This console
            is a live mock of the real tools, same engine, same privacy: your key and your
            file stay in this tab.
          </p>
        </div>

        {/* Mode tabs */}
        <div
          className="mt-8 flex flex-wrap gap-2"
          role="tablist"
          aria-label="AI capabilities"
          data-reveal
          data-reveal-delay="80"
        >
          {MODES.map((m, index) => {
            const Icon = m.icon;
            const isActive = m.id === modeId;
            return (
              <button
                key={m.id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                id={`ai-tab-${m.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="ai-studio-panel"
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectMode(m.id, index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`tool-tab inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-colors sm:text-sm ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Mode explainer — italic, plain language, swaps with the mode. */}
        <p
          key={modeId}
          className="showcase-swap mt-3 max-w-2xl text-[13px] italic leading-relaxed text-muted-foreground sm:text-sm"
        >
          {mode.blurb}
        </p>

        {/* Interactive studio console — the product's own interface, shown
            rendered: document viewport left, assistant right. data-ui marks
            this as an interface fragment, so the page-stat CSS ignores it. */}
        <div
          ref={consoleRef}
          id="ai-studio-panel"
          role="tabpanel"
          aria-labelledby={`ai-tab-${mode.id}`}
          className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-stretch"
          data-ui
        >
          {/* Left column: simulated document viewport */}
          {/* min-h values are the measured worst case across all tabs and
              prompts at each breakpoint, so switching never reflows the
              section. */}
          <div
            key={`doc:${modeId}`}
            data-ui
            className="showcase-swap flex min-h-[717px] flex-col rounded-xl bg-muted/25 p-4 sm:min-h-[570px] sm:p-5 lg:col-span-6 lg:min-h-[634px] xl:min-h-[570px] dark:bg-muted/30"
          >
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>{mode.doc.file}</span>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">{mode.doc.page}</span>
            </div>

            {/* Document page — rendered as real paper, like a desktop PDF viewer.
                The scan line and stamp slide in here; overflow clips the sweep. */}
            <article ref={docPageRef} className="doc-page flex flex-1 flex-col rounded-md px-6 py-7 sm:px-8 sm:py-8">
              <header className="flex items-start justify-between gap-3 pb-3.5">
                <div>
                  <h3 className="doc-body text-[11px] font-semibold uppercase tracking-[0.14em]">
                    {mode.doc.title}
                  </h3>
                  <p className="doc-body doc-ink-soft mt-1 text-[11.5px] italic">
                    {mode.doc.sub}
                  </p>
                </div>
                {paperState === 'applied' && prompt.apply?.kind === 'stamp' && (
                  <span ref={stampRef} className="stamp-chip">
                    {prompt.apply.with}
                  </span>
                )}
              </header>

              <div className="doc-body doc-ruled min-h-[13.5rem] flex-1 space-y-4 pt-4 text-[13px] leading-[1.75] sm:text-[13.5px]">
                <p className="doc-clause">
                  <span className="doc-clause-title">{introFirst?.title}</span>{' '}
                  {introFirst?.text}
                </p>
                <p className="doc-clause">
                  <span className="doc-clause-title">{introSecond?.title}</span>{' '}
                  {introSecond?.text}
                </p>

                {/* Active target text run — the piece the assistant interacts
                    with. Remounted per prompt/paper state so the tracked-change
                    markup resets cleanly and the swap animation replays. */}
                <div
                  ref={docTargetRef}
                  key={`run:${modeId}:${promptIndex}:${paperState}`}
                  className="doc-highlight relative rounded-r-[3px]"
                >
                  <div className="showcase-swap">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="doc-highlight-tag text-[10px] font-semibold uppercase tracking-[0.12em]">
                        Active target text
                      </span>
                      <span className="doc-highlight-tag shrink-0 text-[11px] font-medium tabular-nums">
                        {prompt.citation}
                      </span>
                    </div>
                    {renderTargetRun()}

                    {/* Redact: the peek control lives on the paper. */}
                    {mode.id === 'redact' && burned.length > 0 && (
                      <button
                        type="button"
                        onClick={peekBurned}
                        disabled={peeking}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] doc-highlight-tag transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
                        aria-label="Peek the destroyed data, then re-burn it"
                      >
                        <Eye className="h-3 w-3" />
                        {peeking ? 'Re-burning…' : 'Peek destroyed data'}
                      </button>
                    )}
                  </div>
                  {/* Flash overlay — anime pulses it when the answer lands or a
                      citation is clicked. */}
                  <div ref={docFlashRef} className="doc-flash rounded-r-[3px]" />
                </div>

                <p className="doc-clause">
                  <span className="doc-clause-title">3. General Provisions:</span>{' '}
                  {mode.doc.outro}
                </p>
              </div>

              {/* Scan line — sweeps the whole paper while redact "detects". */}
              <div ref={scanRef} className="scan-line" aria-hidden="true" />

              <footer className="doc-verify mt-5 flex flex-col gap-1 pt-3 text-[10px] uppercase tracking-[0.1em] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="doc-verify-icon h-3.5 w-3.5" />
                  Verified run geometry
                </span>
                <span className="text-[10.5px] tabular-nums normal-case tracking-normal">
                  COORDS: X:72 Y:240 W:468 H:36
                </span>
              </footer>
            </article>
          </div>

          {/* Right column: assistant controller */}
          <div
            key={`assistant:${modeId}`}
            data-ui
            className="showcase-swap flex min-h-[575px] flex-col rounded-xl bg-card p-6 sm:min-h-[515px] lg:col-span-6"
          >
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <mode.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold text-foreground">{mode.consoleTitle}</h3>
                    <p className="text-[12.5px] text-muted-foreground">Local model session · BYOK or managed trial</p>
                  </div>
                </div>
                {phase === 'thinking' ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    <span className="flex gap-0.5 text-amber-500" aria-hidden="true">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                    </span>
                    Working
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Ready
                  </span>
                )}
              </div>

              <div className="mt-6">
                <p className="text-[13px] font-medium text-muted-foreground">{mode.questionsLabel}</p>
                <div className="mt-2.5 space-y-2">
                  {mode.prompts.map((item, idx) => {
                    const isSelected = idx === promptIndex;
                    const isBusy = phase === 'thinking' && isSelected;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => selectPrompt(idx)}
                        disabled={phase === 'thinking'}
                        aria-pressed={isSelected}
                        className={`flex w-full items-start justify-between gap-3 rounded-lg p-3.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                          isSelected
                            ? 'bg-primary/10 font-medium text-foreground'
                            : 'bg-muted/25 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        } ${isBusy ? 'italic' : ''} disabled:pointer-events-none disabled:opacity-80`}
                      >
                        <span>{item.label}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">
                          {item.citation}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Answer display box. It absorbs the panel's spare height so the
                  CTA can pin to the bottom without a void opening above it. */}
              <div
                ref={answerRef}
                key={`answer:${modeId}:${promptIndex}:${phase}`}
                className="showcase-swap mt-6 flex flex-1 flex-col rounded-lg bg-primary/5 p-4"
              >
                <div className="flex items-center justify-between text-[13px] font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    {phase === 'thinking' ? 'Working' : 'Answer'}
                  </span>
                  {phase === 'answer' && (
                    <button
                      type="button"
                      onClick={revealCitation}
                      title="Show this passage in the document"
                      className="text-[11px] tabular-nums font-medium text-primary underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={`Find the cited source ${prompt.citation} in the document`}
                    >
                      {prompt.citation}
                    </button>
                  )}
                </div>

                {phase === 'thinking' ? (
                  <div className="mt-3 min-h-[4.5rem] text-[13px] italic leading-relaxed text-muted-foreground">
                    {thinkingLabel}
                    <span className="mt-2 flex gap-1 text-foreground/70" aria-hidden="true">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                      <span className="thinking-dot" />
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-foreground/90">
                    <WordCascade text={prompt.answer} />
                  </div>
                )}

                {/* Review controls — the edit mode's headline interaction:
                    nothing touches the document until the operator approves,
                    exactly like the real editor. */}
                {mode.id === 'edit' && phase === 'answer' && (
                  <div key={paperState} className="showcase-swap mt-3">
                    {paperState === 'applied' ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-emerald-500/10 px-3 py-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />
                          Applied in the mock; real edits run in the editor.
                        </span>
                        <button
                          type="button"
                          onClick={() => setPaperState('proposed')}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 transition-opacity hover:opacity-75 dark:text-emerald-400"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Revert
                        </button>
                      </div>
                    ) : paperState === 'discarded' ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                          <X className="h-3.5 w-3.5" />
                          Discarded: the document is untouched.
                        </span>
                        <button
                          type="button"
                          onClick={() => setPaperState('proposed')}
                          className="inline-flex items-center gap-1 text-[12px] font-semibold text-foreground transition-opacity hover:opacity-75"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Re-propose
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" className="shadow-none" onClick={() => setPaperState('applied')}>
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          Apply this edit
                        </Button>
                        <Button size="sm" variant="outline" className="shadow-none" onClick={() => setPaperState('discarded')}>
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Discard
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Pin a quiet status line to the pane's floor: the absorbed
                    spare height then reads as a message bubble with deliberate
                    room, not an unloaded panel. */}
                <p className="mt-auto pt-3 text-[11.5px] text-muted-foreground">
                  Local session · nothing leaves this tab.
                </p>
              </div>
            </div>

            {/* Bottom link to the real tool */}
            <div className="mt-6 flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] italic text-muted-foreground">{mode.toolNote}</p>
              <Button size="sm" className="shadow-none" asChild>
                <Link to={`/tools/${mode.slug}`}>
                  {mode.cta}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
