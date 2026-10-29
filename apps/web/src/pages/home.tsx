import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { CtaSection } from '@/components/landing/cta';
import { DocumentBand } from '@/components/landing/document-band';
import { FaqSection } from '@/components/landing/faq';
import { FeaturesSection } from '@/components/landing/features';
import { HeroSection } from '@/components/landing/hero';
import { AllToolsSection, PopularToolsSection } from '@/components/landing/tools-sections';
import { AiShowcase } from '@/components/landing/ai-showcase';
import { useReveal } from '@/hooks/use-reveal';

export function HomePage() {
  // Arms the IntersectionObserver that reveals every [data-reveal] block below.
  useReveal();

  const { hash } = useLocation();
  // React Router does not scroll to a URL fragment after a pushState, so the
  // "Browse all tools" links (404 page, planned tool pages) silently landed at
  // the top of the hero instead of at the catalog they promise.
  useEffect(() => {
    if (!hash) return;
    document
      .getElementById(hash.slice(1))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <>
      <HeroSection />
      <AiShowcase />
      <PopularToolsSection />
      <AllToolsSection />
      <DocumentBand />
      <FeaturesSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
