import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Cpu,
  FileText,
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
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { staggerUI } from '@/lib/motion';
import { useMotionScope } from '@/hooks/use-motion';
import { McpShowcaseButton } from '@/components/landing/mcp-dialog';
import './hero.css';

/* Every link below is a live route. The rail is the catalogue's shortlist, not
   a promise list: eight jobs that cover the traffic this page actually gets. */
interface HeroTool {
  slug: string;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const HERO_TOOLS: HeroTool[] = [
  { slug: 'merge-pdf', label: 'Merge PDF', desc: 'Combine files', icon: Merge },
  { slug: 'split-by-pages', label: 'Split PDF', desc: 'Cut page ranges', icon: Scissors },
  { slug: 'compress-pdf', label: 'Compress PDF', desc: 'Smaller, sharp', icon: Minimize2 },
  { slug: 'edit-pdf', label: 'Edit PDF', desc: 'Type on the page', icon: PenTool },
  { slug: 'pdf-to-jpg', label: 'Convert PDF', desc: 'Pages as images', icon: Upload },
  { slug: 'organize-pdf', label: 'Organize pages', desc: 'Drag to reorder', icon: LayoutGrid },
  { slug: 'fill-sign', label: 'Sign PDF', desc: 'Draw or sign', icon: Signature },
  { slug: 'protect-pdf', label: 'Protect PDF', desc: 'Open password', icon: Lock },
];

/* Verbs offered once a document is actually staged. This replaces the old
   always-on AI tile grid: the same four AI jobs, but shown when they can act
   on a file instead of competing with the dropzone before one exists. */
const STAGED_ACTIONS: Array<{
  label: string;
  slug: string;
  icon: LucideIcon;
  variant: 'default' | 'outline';
  iconClass?: string;
}> = [
  { label: 'Chat & ask', slug: 'chat-with-pdf', icon: Bot, variant: 'default' },
  {
    label: 'Edit with AI',
    slug: 'edit-pdf-with-ai',
    icon: Wand2,
    variant: 'outline',
    iconClass: 'text-emerald-400',
  },
  { label: 'Summarize', slug: 'summarize-pdf', icon: Sparkles, variant: 'outline' },
  {
    label: 'Redact PII',
    slug: 'redact-pdf',
    icon: ShieldCheck,
    variant: 'outline',
    iconClass: 'text-rose-400',
  },
  { label: 'Visual editor', slug: 'edit-pdf', icon: FileText, variant: 'outline' },
  { label: 'Merge / organize', slug: 'merge-pdf', icon: Zap, variant: 'outline' },
];

const PROOF = [
  { icon: Cpu, label: 'Runs on your device', desc: 'Files never leave this tab.' },
  { icon: Lock, label: 'Keys stay local', desc: 'Your API key never leaves the browser.' },
  { icon: CheckCircle2, label: 'Deletion you can verify', desc: 'Redactions wipe the pixels and text.' },
  { icon: Zap, label: 'No toll gates', desc: 'No page limits, watermarks or sign-ups.' },
];

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function HeroSection() {
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const [stagedFile, setStagedFile] = useState<{ name: string; size: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const reducedMotion = useReducedMotion() === true;
  const motionScope = useMotionScope();

  /* ── Anime.js: the headline rises word by word. ──────────────────────────
     CSS hides the words only when scripting is on, so a failed bundle never
     leaves an invisible h1; reduced motion pins them in place. */
  useEffect(() => {
    if (reducedMotion) return;
    const words = titleRef.current?.querySelectorAll('[data-word]');
    if (!words?.length) return;

    motionScope.animate(words, {
      opacity: [0, 1],
      y: [30, 0],
      duration: 860,
      delay: staggerUI(55, { start: 90 }),
      ease: 'outExpo',
    });
  }, [motionScope, reducedMotion]);

  useEffect(() => {
    if (!stagedFile) return;
    // The element that opened the picker may have unmounted with the dropzone.
    // Park focus on the visible Change control so Tab continues into the verbs.
    changeRef.current?.focus({ preventScroll: true });
  }, [stagedFile]);

  /* A file drag that ends outside the window fires no drop and no dragleave on
     the zone. Reset the highlight, and stop the browser from navigating away
     when a PDF is released anywhere else on the page. */
  useEffect(() => {
    const resetDragState = () => {
      dragDepth.current = 0;
      setDragActive(false);
    };
    const blockBrowserOpen = (event: DragEvent) => {
      const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : [];
      if (types.includes('Files')) event.preventDefault();
    };

    window.addEventListener('dragend', resetDragState);
    window.addEventListener('drop', resetDragState);
    window.addEventListener('dragover', blockBrowserOpen);
    window.addEventListener('drop', blockBrowserOpen);

    return () => {
      window.removeEventListener('dragend', resetDragState);
      window.removeEventListener('drop', resetDragState);
      window.removeEventListener('dragover', blockBrowserOpen);
      window.removeEventListener('drop', blockBrowserOpen);
    };
  }, []);

  /* ── Motion: depth on the desk and the ambient plate. ─────────────────── */

  // Scroll: the ambient glow lags behind the copy, which is what makes the
  // stage feel deep without moving any readable text.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const ambienceY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const panelScale = useTransform(scrollYProgress, [0, 0.7], [1, 0.985]);

  // Pointer tilt: ±2.6deg on a 1600px perspective. Enough to feel physical,
  // small enough that 13px tool labels never smear.
  const tiltX = useSpring(0, { stiffness: 160, damping: 20, mass: 0.4 });
  const tiltY = useSpring(0, { stiffness: 160, damping: 20, mass: 0.4 });

  // Magnetic primary: the button leans toward the cursor by at most ~8px.
  const magnetX = useSpring(0, { stiffness: 260, damping: 20, mass: 0.4 });
  const magnetY = useSpring(0, { stiffness: 260, damping: 20, mass: 0.4 });

  const handleDeskPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    spotRef.current?.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    spotRef.current?.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);

    if (reducedMotion || event.pointerType !== 'mouse') return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    tiltY.set(px * 5.2);
    tiltX.set(-py * 3.4);
  };

  const resetDeskTilt = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  const handleMagnetPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    magnetX.set((event.clientX - (rect.left + rect.width / 2)) * 0.12);
    magnetY.set((event.clientY - (rect.top + rect.height / 2)) * 0.18);
  };

  const resetMagnet = () => {
    magnetX.set(0);
    magnetY.set(0);
  };

  const openPicker = () => fileInputRef.current?.click();

  const isPdf = (file: File) =>
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  const stageFile = (file: File) => {
    if (!isPdf(file)) {
      toast.error('PDF files only', { description: `${file.name} is not a PDF.` });
      return;
    }
    setStagedFile({ name: file.name, size: file.size });
    // On phones the actions can sit below the fold after the picker closes.
    // Bring the pane into view; nearest avoids a jump when it is already there.
    if (window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() => {
        dropRef.current?.scrollIntoView({
          block: 'nearest',
          behavior: reducedMotion ? 'auto' : 'smooth',
        });
      });
    }
  };

  const handleDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes('Files')) return;
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) stageFile(file);
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) stageFile(file);
    // Allow re-picking the same file after "Change".
    event.target.value = '';
  };

  /* Entry choreography for everything that is not the headline. The headline
     is anime's; these blocks are Motion's, on the same easing curve. */
  const enter = (delay: number, distance = 16) => ({
    initial: reducedMotion ? false : { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: reducedMotion ? 0 : 0.62,
      delay: reducedMotion ? 0 : delay,
      ease: EASE_OUT,
    },
  });

  return (
    <section ref={sectionRef} className="hero" aria-labelledby="hero-title">
      <motion.div
        className="hero-ambience"
        aria-hidden="true"
        style={reducedMotion ? undefined : { y: ambienceY }}
      >
        <div className="hero-grid" />
        <div className="hero-noise" />
      </motion.div>

      <div className="hero-shell mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 id="hero-title" ref={titleRef} className="hero-title">
          <span data-word className="hero-word">
            Ask,
          </span>{' '}
          <span data-word className="hero-word">
            edit,
          </span>{' '}
          <span data-word className="hero-word">
            merge,
          </span>{' '}
          <span data-word className="hero-word hero-word--em">
            <em>
              redact.
              <svg
                className="hero-swash"
                viewBox="0 0 220 26"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <motion.path
                  d="M4 19.5C48 8.5 128 3.5 216 11.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.7 }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.95,
                    delay: reducedMotion ? 0 : 0.62,
                    ease: EASE_OUT,
                  }}
                />
              </svg>
            </em>
          </span>
        </h1>

        <motion.p className="hero-lede" {...enter(0.45, 16)}>
          Ask your PDF questions, then edit, merge or redact it. Everything runs in this tab.
          Answers cite the exact page, and your file never leaves the device.
        </motion.p>

        <motion.div className="hero-cta-row" {...enter(0.54, 14)}>
          <motion.div
            className="hero-magnet"
            style={{ x: magnetX, y: magnetY }}
            onPointerMove={handleMagnetPointer}
            onPointerLeave={resetMagnet}
          >
            <Button type="button" onClick={openPicker} className="hero-cta-primary">
              Start with a PDF
              <ArrowRight className="h-4 w-4" />
            </Button>
          </motion.div>
          <Button variant="outline" asChild className="hero-cta-ghost">
            <Link to="/tools/chat-with-pdf">
              <Bot className="h-4 w-4 text-emerald-400" />
              Talk to a PDF
            </Link>
          </Button>
          <McpShowcaseButton className="h-9 border-transparent bg-transparent px-2 text-[13px] font-medium text-muted-foreground shadow-none hover:bg-white/5 hover:text-foreground" />
        </motion.div>

        <motion.div
          data-ui
          className="hero-desk"
          {...enter(0.62, 26)}
          style={{
            rotateX: reducedMotion ? 0 : tiltX,
            rotateY: reducedMotion ? 0 : tiltY,
            scale: reducedMotion ? 1 : panelScale,
            transformPerspective: 1600,
          }}
          onPointerMove={handleDeskPointer}
          onPointerLeave={resetDeskTilt}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div ref={spotRef} className="hero-desk-spot" aria-hidden="true" />

          <div className="hero-desk-bar" aria-hidden="true">
            <span className="hero-desk-dots">
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="hero-desk-body">
            <div ref={dropRef} className="hero-drop-wrap">
              <input
                ref={fileInputRef}
                id="hero-file-input"
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInput}
                aria-label="Choose a PDF from this device"
              />
              <p className="sr-only" role="status">
                {stagedFile ? `${stagedFile.name} is ready. Choose an action.` : ''}
              </p>

              {!stagedFile ? (
                <div
                  className="hero-drop"
                  role="button"
                  tabIndex={0}
                  data-drag={dragActive ? 'true' : undefined}
                  onClick={openPicker}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openPicker();
                    }
                  }}
                >
                  <span className="hero-drop-pulse" aria-hidden="true" />
                  <div className="hero-pages" aria-hidden="true">
                    <span className="hero-page hero-page--3" />
                    <span className="hero-page hero-page--2" />
                    <span className="hero-page hero-page--1">
                      <span className="hero-page-line" style={{ width: '82%' }} />
                      <span className="hero-page-line" style={{ width: '64%' }} />
                      <span className="hero-page-line" style={{ width: '74%' }} />
                      <span className="hero-page-seal" />
                    </span>
                  </div>
                  <p className="hero-drop-title">
                    {dragActive ? 'Release to open it here' : 'Drop a PDF to begin'}
                  </p>
                  <p className="hero-drop-sub">
                    {dragActive
                      ? 'It stays on this device. Nothing is uploaded.'
                      : 'or click to choose one from your disk'}
                  </p>
                </div>
              ) : (
                <motion.div
                  key="staged"
                  initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reducedMotion ? 0 : 0.3, ease: EASE_OUT }}
                >
                  <div className="hero-file">
                    <span className="hero-file-icon">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="hero-file-name">{stagedFile.name}</p>
                      <p className="hero-file-meta">{formatBytes(stagedFile.size)}</p>
                    </div>
                    <button
                      ref={changeRef}
                      type="button"
                      className="hero-file-change"
                      onClick={openPicker}
                    >
                      Change
                    </button>
                  </div>

                  <div className="hero-file-actions">
                    {STAGED_ACTIONS.map((action) => {
                      const Icon = action.icon;
                      return (
                        <Button
                          key={action.slug}
                          variant={action.variant}
                          size="sm"
                          onClick={() => navigate(`/tools/${action.slug}`)}
                        >
                          <Icon
                            className={`h-3.5 w-3.5 ${action.iconClass ?? ''}`}
                            aria-hidden="true"
                          />
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </div>

            <div className="hero-tools-wrap">
              <div className="hero-tool-grid">
                {HERO_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Link key={tool.slug} to={`/tools/${tool.slug}`} className="hero-tool">
                      <span className="hero-tool-icon">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="hero-tool-name">{tool.label}</span>
                        <span className="hero-tool-desc">{tool.desc}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>

              <div className="hero-rail-foot">
                <Link to="/#all-tools">
                  All tools
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div className="hero-proof" {...enter(0.72, 14)}>
          {PROOF.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="hero-proof-item">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <div>
                  <span className="hero-proof-label">{item.label}</span>
                  <span className="hero-proof-desc">{item.desc}</span>
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
