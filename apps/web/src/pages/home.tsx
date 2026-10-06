import { CtaSection } from '@/components/landing/cta';
import { FaqSection } from '@/components/landing/faq';
import { FeaturesSection } from '@/components/landing/features';
import { HeroSection } from '@/components/landing/hero';
import { AllToolsSection, PopularToolsSection } from '@/components/landing/tools-sections';

export function HomePage() {
  return (
    <>
      <HeroSection />
      <PopularToolsSection />
      <AllToolsSection />
      <FeaturesSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
