import { CtaSection } from '@/components/landing/cta';
import { FaqSection } from '@/components/landing/faq';
import { FeaturesSection } from '@/components/landing/features';
import { HeroSection } from '@/components/landing/hero';
import { AllToolsSection, PopularToolsSection } from '@/components/landing/tools-sections';
import { AiShowcase } from '@/components/landing/ai-showcase';

export function HomePage() {
  return (
    <>
      <HeroSection />
      <AiShowcase />
      <PopularToolsSection />
      <AllToolsSection />
      <FeaturesSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
