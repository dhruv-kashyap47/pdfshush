import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, FileText, LockKeyhole, MessageCircle, Sparkles, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const MODES = [
  {
    id: 'summarize',
    label: 'Summarize',
    title: 'A clean brief, with receipts.',
    copy: 'Turn a long document into a useful first read. Every point stays attached to its source page.',
    href: '/tools/summarize-pdf',
    icon: Sparkles,
    result: 'Decision summary',
    detail: 'Three priorities surfaced from 24 pages',
  },
  {
    id: 'chat',
    label: 'Chat',
    title: 'Ask the document directly.',
    copy: 'Find the clause, number or deadline you need without hunting through page after page.',
    href: '/tools/chat-with-pdf',
    icon: MessageCircle,
    result: 'Answer found',
    detail: 'The renewal window is 30 days [p. 18]',
  },
  {
    id: 'edit',
    label: 'Edit with AI',
    title: 'Describe the change. Review it first.',
    copy: 'Ask for a highlight, rewrite or page change. Nothing is applied until you approve the plan.',
    href: '/tools/edit-pdf-with-ai',
    icon: Wand2,
    result: 'Edit plan ready',
    detail: 'Highlight 4 dates · review before applying',
  },
] as const;

export function AiShowcase() {
  const [active, setActive] = useState(0);
  const mode = MODES[active] ?? MODES[0]!;

  useEffect(() => {
    const timer = window.setInterval(() => setActive((value) => (value + 1) % MODES.length), 6500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section id="ai" className="ai-board mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="ai-board__intro">
        <p className="ai-board__kicker">The intelligent layer</p>
        <h2>Make the PDF<br />answer back.</h2>
        <p className="ai-board__lede">PDFShush gives your documents a useful interface — grounded in their text, transparent in its work, and private by default.</p>
        <div className="ai-board__proof">
          <span><LockKeyhole aria-hidden="true" /> Your key stays in this browser</span>
          <span><Check aria-hidden="true" /> Page citations included</span>
        </div>
      </div>

      <div className="ai-console" data-ui>
        <div className="ai-console__chrome">
          <div className="ai-console__file"><FileText aria-hidden="true" /><span>contract-2026.pdf</span><span className="ai-console__pages">24 pages</span></div>
          <span className="ai-console__status"><span className="ai-console__pulse" /> Local AI ready</span>
        </div>

        <div className="ai-console__body">
          <div className="ai-console__document">
            <div className="ai-doc-page">
              <div className="ai-doc-page__heading">SERVICE AGREEMENT</div>
              <div className="ai-doc-page__meta">Northstar Systems · 2026</div>
              <div className="ai-doc-page__line ai-doc-page__line--wide" />
              <div className="ai-doc-page__line" />
              <div className="ai-doc-page__line ai-doc-page__line--short" />
              <div className="ai-doc-page__highlight">The renewal window is thirty days before the current term ends.</div>
              <div className="ai-doc-page__line ai-doc-page__line--wide" />
              <div className="ai-doc-page__line" />
              <div className="ai-doc-page__line ai-doc-page__line--short" />
              <span className="ai-doc-page__citation">p. 18</span>
            </div>
            <div className="ai-console__rail"><span className="is-active" /><span /><span /><span /><span /></div>
          </div>

          <div className="ai-console__assistant">
            <div className="ai-console__assistant-head"><span><Sparkles aria-hidden="true" /> PDFShush AI</span><span className="ai-console__model">grounded</span></div>
            <div className="ai-console__answer" key={mode.id}>
              <p className="ai-console__result">{mode.result}</p>
              <p className="ai-console__detail">{mode.detail}</p>
              <span className="ai-console__cite">[page 18]</span>
            </div>
            <div className="ai-console__input">Ask about this document <ArrowUpRight aria-hidden="true" /></div>
          </div>
        </div>

        <div className="ai-console__modes" role="tablist" aria-label="AI capabilities">
          {MODES.map((item, index) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)} className={index === active ? 'is-active' : ''}>
                <Icon aria-hidden="true" /> {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ai-board__caption">
        <div><span className="ai-board__caption-title">{mode.title}</span><span>{mode.copy}</span></div>
        <Link to={mode.href}>Try {mode.label.toLowerCase()} <ArrowUpRight aria-hidden="true" /></Link>
      </div>
    </section>
  );
}
