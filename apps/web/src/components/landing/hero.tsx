import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  FileText,
  Image,
  LayoutGrid,
  Lock,
  Merge,
  Minimize2,
  PenTool,
  Scissors,
  ShieldCheck,
  Signature,
  Sparkles,
  Upload,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { EASE, DUR, staggerUI, timelineUI, prefersReducedMotion } from '@/lib/motion';
import { useMotionScope } from '@/hooks/use-motion';
import { McpShowcaseButton } from '@/components/landing/mcp-dialog';

/* Definitions are written to survive a 390px phone's half-panel chip on one
   line: a truncated promise ("Permanent destructive sanititi...") reads worse
   than a shorter one. */
const QUICK_AI_ACTIONS = [
  { slug: 'chat-with-pdf', name: 'Chat with PDF', desc: 'Answers cite pages' },
  { slug: 'edit-pdf-with-ai', name: 'Edit with AI', desc: 'Edits you describe' },
  { slug: 'summarize-pdf', name: 'Summarize', desc: 'Executive brief' },
  { slug: 'redact-pdf', name: 'Redact PII', desc: 'Erased for good' },
] as const;

/* The eight jobs people open this site for. Every entry is a real route under
   /tools and every one runs today, so the grid never lies about what is live.
   Descriptions stay short so a chip never wraps its promise mid-sentence on a
   phone. */
interface ToolShortcut {
  slug: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** Accent family mirrored from the tool registry (tool-card palette). */
  accent: 'green' | 'blue' | 'amber' | 'orange';
  soon?: boolean;
}

const HERO_TOOLS: ToolShortcut[] = [
  { slug: 'merge-pdf', label: 'Merge PDF', desc: 'Combine files in any order', icon: Merge, accent: 'green' },
  { slug: 'split-by-pages', label: 'Split PDF', desc: 'Cut into page ranges', icon: Scissors, accent: 'blue' },
  { slug: 'compress-pdf', label: 'Compress PDF', desc: 'Smaller file, sharp text', icon: Minimize2, accent: 'orange' },
  { slug: 'edit-pdf', label: 'Edit PDF', desc: 'Type right on the page', icon: PenTool, accent: 'green' },
  { slug: 'pdf-to-jpg', label: 'Convert PDF', desc: 'Export pages as images', icon: Image, accent: 'amber' },
  { slug: 'organize-pdf', label: 'Organize Pages', desc: 'Drag to reorder pages', icon: LayoutGrid, accent: 'blue' },
  { slug: 'fill-sign', label: 'Sign PDF', desc: 'Draw or type a signature', icon: Signature, accent: 'amber' },
  { slug: 'protect-pdf', label: 'Protect PDF', desc: 'Add an open password', icon: Lock, accent: 'blue' },
];

/* Icon tiles mirror the accents the registry already assigns these tools, so
   a "Merge PDF" chip and its catalog card read as the same product. */
const ACCENT_TILE: Record<ToolShortcut['accent'], string> = {
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
};

const ACCENT_TILE_RING: Record<ToolShortcut['accent'], string> = {
  green: 'group-hover:ring-emerald-500/30',
  blue: 'group-hover:ring-sky-500/30',
  amber: 'group-hover:ring-amber-500/30',
  orange: 'group-hover:ring-orange-500/30',
};

export function HeroSection() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ name: string; size: number } | null>(null);

  /* Hero choreography lives here: one anime timeline for the headline, sub,
     CTAs, tool grid and console. Under reduced motion the gate class never
     renders, so the section is fully visible with zero animation. */
  const reducedMotion = prefersReducedMotion();
  const copyRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const motion = useMotionScope();

  useEffect(() => {
    if (reducedMotion) return;
    const copy = copyRef.current;
    if (!copy) return;

    const headline = copy.querySelector('[data-motion="headline"]');
    const subhead = copy.querySelector('[data-motion="subhead"]');
    const actions = copy.querySelector('[data-motion="actions"]');
    const toolGrid = copy.querySelector('[data-motion="tools"]');
    const chips = copy.querySelectorAll<HTMLElement>('[data-tool-chip]');
    // The console entrance targets the card itself (the wrapper stays
    // positionable by the grid).
    const consoleCard = consoleRef.current?.querySelector('div') ?? null;

    const tl = timelineUI({ defaults: { ease: EASE.out, duration: DUR.slow } });
    if (headline) tl.add(headline, { opacity: [0, 1], y: [22, 0] }, 0);
    if (subhead) tl.add(subhead, { opacity: [0, 1], y: [18, 0], duration: DUR.base }, 130);
    if (actions) tl.add(actions, { opacity: [0, 1], y: [16, 0], duration: DUR.base }, 260);
    if (toolGrid) tl.add(toolGrid, { opacity: [0, 1], y: [14, 0], duration: DUR.base }, 380);
    // Chips stay transform-free (Tailwind's hover lift owns their transform
    // afterwards), so their entrance is an opacity wave only.
    if (chips.length) {
      tl.add(chips, { opacity: [0, 1], duration: 460, delay: staggerUI(30) }, 430);
    }
    if (consoleCard) tl.add(consoleCard, { opacity: [0, 1], y: [26, 0], duration: 820 }, 320);

    motion.park(tl);
    return undefined;
    // copyRef/consoleRef are stable refs; the motion scope is a stable
    // registry object, so this runs once per mount (and re-runs cleanly on
    // StrictMode's double mount because the scope cancels everything).
  }, [reducedMotion, motion]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setStagedFile({ name: file.name, size: file.size });
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setStagedFile({ name: file.name, size: file.size });
    }
  };

  const gate = reducedMotion ? '' : 'motion-gate';

  return (
    // Top padding clears the sticky h-16 header, so the first line of copy is
    // never tucked underneath it on a phone.
    <section className="relative overflow-hidden bg-background pb-16 pt-[4.75rem] sm:pb-24 sm:pt-20">
      {/* Cinematic Greek plates — purely decorative, theme decides which paints.
          Both live in the DOM so switching themes is a pure class swap. */}
      <div className="hero-backdrop" aria-hidden="true">
        <img
          src="/hero/greek-day.webp"
          srcSet="/hero/greek-day-sm.webp 1080w, /hero/greek-day.webp 1572w"
          sizes="100vw"
          alt=""
          draggable={false}
          decoding="async"
          className="hero-backdrop-image hero-backdrop-image--day block dark:hidden"
        />
        <img
          src="/hero/greek-night.webp"
          srcSet="/hero/greek-night-sm.webp 1080w, /hero/greek-night.webp 1572w"
          sizes="100vw"
          alt=""
          draggable={false}
          decoding="async"
          className="hero-backdrop-image hero-backdrop-image--night hidden dark:block"
        />
        <div className="hero-backdrop-wash" />
        <div className="hero-backdrop-scrim" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Headline block */}
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 lg:items-start">
          <div ref={copyRef} className="lg:col-span-7">
            {/* New headline: what it is, then why it is different. Two lines
                max, no hidden meaning. The privacy promise moves to the sub. */}
            <h1 data-motion="headline" className={`text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl lg:leading-[1.05] ${gate}`}>
              PDF tools.
              <br />
              Smarter document intelligence.
            </h1>
            {/* Privacy-first messaging stays: it is the reason to trust the
                buttons above it. */}
            <p
              data-motion="subhead"
              className={`mt-6 max-w-2xl text-base leading-relaxed text-foreground sm:text-lg ${gate}`}
            >
              Question, edit, merge and redact documents right in this tab. Every job runs in
              local Web Workers; answers cite the exact page.
            </p>

            {/* Instant action bar — the two AI entry points, nothing else.
                The merge CTA retired into the tool grid below. */}
            <div data-motion="actions" className={`mt-8 flex flex-wrap items-center gap-3 ${gate}`}>
              <Button size="lg" className="h-11 rounded-md px-5 text-sm font-semibold shadow-none" asChild>
                <Link to="/tools/chat-with-pdf">
                  <Bot className="mr-2 h-4 w-4" />
                  Talk to a PDF
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 rounded-md px-5 text-sm font-medium shadow-none" asChild>
                <Link to="/tools/edit-pdf-with-ai">
                  <Wand2 className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Edit with AI
                </Link>
              </Button>
              {/* Third door: the MCP server, for people whose agent does the
                  work instead of their tab. Opens the in-page console. */}
              <McpShowcaseButton />
            </div>

            {/* Jump-straight-in tool grid (replaces the plain "Start directly"
                chips). Chips are opacity-only in anime so the CSS hover lift
                owns their transform after the intro. */}
            <div data-motion="tools" className={`mt-10 ${gate}`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Jump straight to a tool
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {HERO_TOOLS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.slug}
                      to={`/tools/${item.slug}`}
                      data-tool-chip
                      className="group rounded-lg border border-border/70 bg-background/72 p-2.5 text-left backdrop-blur-sm transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-background hover:shadow-[0_10px_24px_-16px_oklch(0_0_0/30%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 dark:bg-card/62 dark:hover:border-primary/45"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-transparent transition-shadow duration-200 ${ACCENT_TILE[item.accent]} ${ACCENT_TILE_RING[item.accent]}`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <p className="whitespace-nowrap text-[13px] font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
                          {item.label}
                        </p>
                      </div>
                      {/* The promise, below the tool, in readable italics; the
                          "soon" badge rides this row so it never forces the
                          label to wrap. */}
                      <p className="mt-1.5 text-[11px] italic leading-snug text-muted-foreground">
                        {item.desc}
                        {item.soon && (
                          <span className="ml-1.5 inline-block -translate-y-px rounded-full bg-muted px-1.5 text-[9px] font-semibold not-italic uppercase tracking-wide text-muted-foreground">
                            soon
                          </span>
                        )}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right column: the working console — drop a file, stage it, pick an
              action. It is a real upload widget, hence data-ui. Translucent +
              blurred rather than a solid card: over a photographic backdrop an
              opaque panel reads as a hole cut in the picture rather than part of
              the same composition. */}
          <div ref={consoleRef} data-motion="console" className="lg:col-span-5" data-ui>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative overflow-hidden rounded-xl border bg-background/82 p-6 backdrop-blur-xl transition-colors dark:bg-card/62 ${gate} ${
                dragActive
                  ? 'border-primary ring-2 ring-primary/20 bg-background/90 dark:bg-card/76'
                  : 'border-transparent hover:border-foreground/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInput}
                id="hero-file-input"
              />

              {!stagedFile ? (
                <div>
                  <div>
                    <p className="text-[15px] font-semibold text-foreground">Start with a document</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Runs in memory, nothing stored or sent.
                    </p>
                  </div>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/50"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        fileInputRef.current?.click();
                      }
                    }}
                    aria-label="Upload PDF to launch tool"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Upload className="h-5 w-5" />
                    </div>
                    <p className="mt-3 text-[15px] font-medium text-foreground">
                      Drop a PDF here to begin
                    </p>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      or click to choose a local file from your disk
                    </p>
                  </div>

                  <div className="mt-5">
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_AI_ACTIONS.map((item) => {
                        return (
                          <Link
                            key={item.slug}
                            to={`/tools/${item.slug}`}
                            className="group rounded-lg bg-background/55 p-3 text-left transition-colors hover:bg-background/85 dark:bg-background/52 dark:hover:bg-background/72"
                          >
                            <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                              {item.name}
                            </p>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">
                              {item.desc}
                            </p>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between pb-3">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText className="h-5 w-5 shrink-0 text-primary" />
                      <div className="truncate">
                        <p className="truncate text-[15px] font-semibold text-foreground">{stagedFile.name}</p>
                        <p className="text-[13px] text-muted-foreground">{formatBytes(stagedFile.size)} · Local</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStagedFile(null)}
                      className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      Change
                    </button>
                  </div>

                  <div className="pt-3">
                    <p className="text-[13px] font-medium text-muted-foreground">Choose an action for this document:</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/chat-with-pdf')}
                      >
                        <Bot className="mr-2 h-4 w-4" />
                        Chat & Ask
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/edit-pdf-with-ai')}
                      >
                        <Wand2 className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Edit with AI
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/summarize-pdf')}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Summarize
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/redact-pdf')}
                      >
                        <ShieldCheck className="mr-2 h-4 w-4 text-rose-500" />
                        Redact PII
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/edit-pdf')}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Visual Editor
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-[13px]"
                        onClick={() => navigate('/tools/merge-pdf')}
                      >
                        <Zap className="mr-2 h-4 w-4" />
                        Merge / Organize
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Four plain spec entries — sentence case, no icons on top of cards,
            no rules; reads as a quiet footnote strip under the photograph.
            Their reveal stays on the CSS/IO system (use-reveal). */}
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-10">
          {[
            { icon: Cpu, label: 'All client-side', desc: 'PDFium and pdf.js render and rebuild files inside sandboxed Web Workers.' },
            { icon: Lock, label: 'Keys stay put', desc: 'Bring your own API key. It lives in browser storage and never leaves this device.' },
            { icon: CheckCircle2, label: 'Deletion you can verify', desc: 'Redactions destroy the underlying pixels and strip the text layer, then prove it.' },
            { icon: Zap, label: 'No toll gates', desc: 'No page limits, watermarks or sign-ups for anything that runs in your browser.' },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                data-reveal
                data-reveal-delay={i * 80}
                className="space-y-1"
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Icon className="h-4 w-4 text-primary" />
                  <span>{item.label}</span>
                </p>
                <p className="text-base leading-relaxed text-foreground/80 dark:text-muted-foreground">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
