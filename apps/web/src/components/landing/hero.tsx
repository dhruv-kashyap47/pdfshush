import { ArrowRight, Lock, MessageCircle, Sparkles, Star, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function HeroSection() {
  return (
    <section className="landing-hero">
      <div className="landing-hero__grid" aria-hidden="true" />
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          <p className="landing-hero__kicker"><Sparkles aria-hidden="true" /> The private PDF intelligence layer</p>
          <h1>Your PDF has<br />more to say.</h1>
          <p className="landing-hero__lede">Summarize, question and edit documents with AI that shows its work — while your file stays in this browser.</p>
          <div className="landing-hero__actions">
            <Button size="lg" className="h-12 rounded-none px-6 text-base" asChild>
              <Link to="/tools/chat-with-pdf">Talk to a PDF <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Link className="landing-hero__secondary" to="#ai"><MessageCircle aria-hidden="true" /> See the AI layer</Link>
          </div>
        </div>
        <div className="landing-hero__aside">
          <div className="landing-hero__signal"><span className="landing-hero__signal-dot" /> AI tools, grounded in your document</div>
          <p>Read the page. Find the answer. Make the change. Keep control.</p>
          <div className="landing-hero__aside-foot"><span><Lock aria-hidden="true" /> Local by default</span><span><Zap aria-hidden="true" /> Ready in seconds</span><span><Star aria-hidden="true" /> Open source</span></div>
        </div>
      </div>
    </section>
  );
}
