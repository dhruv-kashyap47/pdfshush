import { useState, useRef } from 'react';
import { ArrowRight, Bot, CheckCircle2, Cpu, FileText, Lock, Sparkles, Upload, Wand2, ShieldCheck, Zap } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatBytes } from '@/lib/format';

const QUICK_AI_ACTIONS = [
  { slug: 'chat-with-pdf', name: 'Chat with PDF', icon: Bot, desc: 'Question and cite pages' },
  { slug: 'edit-pdf-with-ai', name: 'Edit with AI', icon: Wand2, desc: 'Describe edits in text' },
  { slug: 'summarize-pdf', name: 'Summarize', icon: Sparkles, desc: 'Executive brief with receipts' },
  { slug: 'redact-pdf', name: 'Redact PII', icon: ShieldCheck, desc: 'Permanent destructive sanitization' },
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
    <section className="relative overflow-hidden border-b border-border/60 bg-background pb-16 pt-12 sm:pb-24 sm:pt-20">
      {/* Ambient dot-grid texture — pulses gently in both modes */}
      <div className="hero-dot-grid" aria-hidden="true" />

      {/* Subtle radial glow — emerald in dark, barely visible in light */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[500px] w-[900px] rounded-full bg-primary/5 blur-[120px] dark:bg-primary/8" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Architectural status badge */}
        <div className="hero-stagger-1 mb-6 flex flex-wrap items-center gap-2.5">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-border/80 bg-background/80 px-3 py-1 font-mono text-[11px] font-medium tracking-tight backdrop-blur-sm"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-gently" />
            <span>LOCAL RUNTIME</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">ZERO UPLOADS</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">AGPL-3.0</span>
          </Badge>
          <span className="hidden text-xs text-muted-foreground sm:inline-block">
            All operations execute inside this browser tab via Web Workers.
          </span>
        </div>

        {/* Headline block */}
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12 lg:items-start">
          <div className="lg:col-span-7">
            <h1 className="hero-stagger-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl lg:leading-[1.08]">
              Private PDF tools and local document intelligence.
            </h1>
            <p className="hero-stagger-3 mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Question, edit, merge and redact documents directly in your browser. Our AI model
              analyzes text and cites every source page, while your file never leaves this machine.
            </p>

            {/* Instant Action Bar */}
            <div className="hero-stagger-4 mt-8 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="btn-glow h-11 rounded-md px-5 text-sm font-semibold shadow-xs"
                asChild
              >
                <Link to="/tools/chat-with-pdf">
                  <Bot className="mr-2 h-4 w-4" />
                  Talk to a PDF
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-11 rounded-md px-5 text-sm font-medium" asChild>
                <Link to="/tools/edit-pdf-with-ai">
                  <Wand2 className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Edit with AI
                </Link>
              </Button>
              <Button size="lg" variant="ghost" className="h-11 rounded-md px-4 text-sm text-muted-foreground" asChild>
                <Link to="/tools/merge-pdf">
                  Merge files
                </Link>
              </Button>
            </div>

            {/* Quick access chips */}
            <div className="hero-stagger-5 mt-6 flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Quick utility launch:</span>
              {QUICK_CORE_TOOLS.map((item) => (
                <Link
                  key={item.slug}
                  to={`/tools/${item.slug}`}
                  className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          {/* Right Column: Direct Drop & Command Interface */}
          <div className="hero-stagger-3 lg:col-span-5">
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative overflow-hidden rounded-xl border bg-card p-6 shadow-xs transition-all ${
                dragActive
                  ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                  : 'border-border/80 hover:border-border dark:hover:border-border/60'
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
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Immediate Workspace Launch
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                      <Lock className="h-3 w-3" /> In-Memory Only
                    </span>
                  </div>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center transition-colors hover:border-primary/60 hover:bg-muted/40"
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
                    <p className="mt-3 text-sm font-medium text-foreground">
                      Drop a PDF here to begin
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      or click to choose a local file from your disk
                    </p>
                  </div>

                  <div className="mt-5 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Direct tool shortcuts:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {QUICK_AI_ACTIONS.map((item) => {
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.slug}
                            to={`/tools/${item.slug}`}
                            className="group flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/50 p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                          >
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                                {item.name}
                              </p>
                              <p className="truncate text-[10px] text-muted-foreground">
                                {item.desc}
                              </p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText className="h-5 w-5 shrink-0 text-primary" />
                      <div className="truncate">
                        <p className="truncate text-sm font-semibold text-foreground">{stagedFile.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(stagedFile.size)} · Local</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStagedFile(null)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Change
                    </button>
                  </div>

                  <div className="pt-4">
                    <p className="text-xs font-medium text-muted-foreground">Choose an action for this document:</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
                        onClick={() => navigate('/tools/chat-with-pdf')}
                      >
                        <Bot className="mr-2 h-4 w-4" />
                        Chat & Ask
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
                        onClick={() => navigate('/tools/edit-pdf-with-ai')}
                      >
                        <Wand2 className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        Edit with AI
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
                        onClick={() => navigate('/tools/summarize-pdf')}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Summarize
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
                        onClick={() => navigate('/tools/redact-pdf')}
                      >
                        <ShieldCheck className="mr-2 h-4 w-4 text-rose-500" />
                        Redact PII
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
                        onClick={() => navigate('/tools/edit-pdf')}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Visual Editor
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 justify-start px-3 text-xs"
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

        {/* 4 Architectural Pillars / Telemetry Bar */}
        <div className="mt-14 grid grid-cols-2 gap-3 border-t border-border/70 pt-8 sm:grid-cols-4 sm:gap-6">
          {[
            { icon: Cpu, label: '100% Client-Side', desc: 'PDFium WebAssembly parses and renders files in sandboxed Web Workers.' },
            { icon: Lock, label: 'Private BYOK', desc: 'Bring your own API key. Keys remain in browser IndexedDB and never leave this device.' },
            { icon: CheckCircle2, label: 'Verifiable Output', desc: 'Redactions destroy underlying pixels and strip the text layer with automated verification.' },
            { icon: Zap, label: 'Zero Toll Gates', desc: 'No artificial page limits, watermarks or mandatory sign-ups for browser processing.' },
          ].map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                data-reveal
                data-reveal-delay={i * 80}
                className="space-y-1"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground">
                  <Icon className="h-4 w-4 text-primary" />
                  <span>{item.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
