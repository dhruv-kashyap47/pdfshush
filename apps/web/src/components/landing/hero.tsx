import { useState, useRef } from 'react';
import { ArrowRight, Bot, CheckCircle2, Cpu, FileText, Lock, Sparkles, Upload, Wand2, ShieldCheck, Zap } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';

/* Definitions are written to survive a 390px phone's half-panel chip on one
   line: a truncated promise ("Permanent destructive sanititi...") reads worse
   than a shorter one. */
const QUICK_AI_ACTIONS = [
  { slug: 'chat-with-pdf', name: 'Chat with PDF', desc: 'Answers cite pages' },
  { slug: 'edit-pdf-with-ai', name: 'Edit with AI', desc: 'Edits you describe' },
  { slug: 'summarize-pdf', name: 'Summarize', desc: 'Executive brief' },
  { slug: 'redact-pdf', name: 'Redact PII', desc: 'Erased for good' },
] as const;

const QUICK_CORE_TOOLS = [
  { slug: 'edit-pdf', name: 'Edit PDF' },
  { slug: 'merge-pdf', name: 'Merge PDFs' },
  { slug: 'organize-pdf', name: 'Organize' },
  { slug: 'compress-pdf', name: 'Compress' },
] as const;

export function HeroSection() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [stagedFile, setStagedFile] = useState<{ name: string; size: number } | null>(null);

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
          <div className="lg:col-span-7">
            <h1 className="hero-stagger-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl lg:leading-[1.05]">
              Private PDF tools.
              <br />
              Files stay home.
            </h1>
            <p className="hero-stagger-3 mt-6 max-w-2xl text-base leading-relaxed text-foreground sm:text-lg">
              Question, edit, merge and redact documents right in this tab. Every job runs in
              local Web Workers; answers cite the exact page.
            </p>

            {/* Instant Action Bar */}
            <div className="hero-stagger-4 mt-8 flex flex-wrap items-center gap-3">
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
              <Button size="lg" variant="ghost" className="inline-flex h-11 rounded-md px-4 text-sm text-muted-foreground shadow-none" asChild>
                <Link to="/tools/merge-pdf">
                  Merge files
                </Link>
              </Button>
            </div>

            {/* Quick access chips */}
            <div className="hero-stagger-5 mt-7 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Start directly:</span>
              {QUICK_CORE_TOOLS.map((item) => (
                <Link
                  key={item.slug}
                  to={`/tools/${item.slug}`}
                  className="rounded-md bg-background/75 px-3 py-1.5 text-sm font-medium text-foreground/90 transition-colors hover:bg-background"
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          {/* Right column: the working console — drop a file, stage it, pick an
              action. It is a real upload widget, hence data-ui. Translucent +
              blurred rather than a solid card: over a photographic backdrop an
              opaque panel reads as a hole cut in the picture rather than part of
              the same composition. */}
          <div className="hero-stagger-3 lg:col-span-5" data-ui>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative overflow-hidden rounded-xl border bg-background/82 p-6 backdrop-blur-xl transition-colors dark:bg-card/55 ${
                dragActive
                  ? 'border-primary ring-2 ring-primary/20 bg-background/90 dark:bg-card/70'
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
                            className="group rounded-lg bg-background/55 p-3 text-left transition-colors hover:bg-background/85 dark:bg-background/45 dark:hover:bg-background/70"
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
            no rules; reads as a quiet footnote strip under the photograph. */}
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
