import { Gauge, Github, Lock, Puzzle, Rocket, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const FEATURES = [
  {
    icon: Lock,
    title: 'Files never leave your device',
    body: 'Parsing and rendering run inside this browser tab, in a Web Worker. There is no upload endpoint for these tools — privacy is enforced by architecture, not by a policy page.',
  },
  {
    icon: Gauge,
    title: 'No limits, no queue',
    body: 'Sejda caps anonymous users at 3 tasks per hour and 200 pages. We process locally, so the only real ceiling is your machine — and we tell you the number up front.',
  },
  {
    icon: Users,
    title: 'Works without an account',
    body: 'Open a tool, drop a file, get your result. Sign-in only becomes useful when you want saved workflows, API keys and team history — never as a toll gate.',
  },
  {
    icon: Rocket,
    title: 'Fast by construction',
    body: 'A bounded worker pool keeps CPU busy without freezing the UI. Output buffers are transferred, not copied, so multi-hundred-page jobs stay snappy.',
  },
  {
    icon: Puzzle,
    title: 'One engine everywhere',
    body: 'The same TypeScript PDF engine runs in your browser today and on the server tomorrow — so features land identically in both, with one test suite.',
  },
  {
    icon: Github,
    title: 'Open source, AGPL-3.0',
    body: 'The entire product is inspectable and self-hostable. If it ever stops being private the way it claims, you can read the code and prove it either way.',
  },
];

export function FeaturesSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-xl font-bold sm:text-2xl">Why PDFShush</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Most online PDF tools ask you to trust a server you cannot see. We removed the server from
          the equation.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="border-border/70 bg-card">
            <CardContent className="p-5">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="h-[18px] w-[18px]" />
              </span>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
