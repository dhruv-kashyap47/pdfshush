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
