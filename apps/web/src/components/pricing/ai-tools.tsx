import { Link } from 'react-router-dom';
import { ArrowRight, FileText, MessageSquare, Wand2 } from 'lucide-react';

const AI_TOOLS = [
  {
    slug: 'summarize-pdf',
    name: 'Summarize PDF',
    copy: 'A grounded summary with page citations, so a claim can be checked.',
    icon: FileText,
  },
  {
    slug: 'chat-with-pdf',
    name: 'Chat with PDF',
    copy: 'Ask a question and get an answer tied to the page it came from.',
    icon: MessageSquare,
  },
  {
    slug: 'edit-pdf-with-ai',
    name: 'Edit PDF with AI',
    copy: 'Describe the change in plain language, review it, then apply it.',
    icon: Wand2,
  },
] as const;

/**
 * The AI pitch, with real links to the three tools. It sits between the plans
 * and the comparison table: the visitor has just read what Pro raises, and this
 * is the part that uses it.
 */
export function AiTools() {
  return (
    <section aria-labelledby="ai-heading" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <Wand2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            The AI
          </p>
          <h2 id="ai-heading" className="mt-2 text-xl font-semibold tracking-tight">
            AI that reads the page, not a guess.
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Three messages a day are free. Pro raises that to 500 a month, and a credit pack
            covers the busy month. Your own provider key always works too.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {AI_TOOLS.map((tool) => (
          <Link
            key={tool.slug}
            to={`/tools/${tool.slug}`}
            className="group flex flex-col rounded-2xl border border-border/70 bg-card/50 p-5 transition-colors hover:border-primary/45 hover:bg-card/70"
          >
            <tool.icon className="h-5 w-5 text-primary" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold">{tool.name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{tool.copy}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Open tool
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
