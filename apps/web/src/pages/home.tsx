import { useEffect, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CtaSection } from '@/components/landing/cta';
import { DocumentBand } from '@/components/landing/document-band';
import { FaqSection } from '@/components/landing/faq';
import { FeaturesSection } from '@/components/landing/features';
import { HeroSection } from '@/components/landing/hero';
import { SeoHomeContent } from '@/components/landing/seo-content';
import { AllToolsSection, PopularToolsSection } from '@/components/landing/tools-sections';
import { SocialProofSection } from '@/features/social-proof/social-proof';
import { HOME_DESCRIPTION, HOME_FAQS, HOME_KEYWORDS, HOME_TITLE } from '@/seo/home-content';
import { usePageHead } from '@/seo/head';
import { faqPageSchema, organizationSchema, webPageSchema, websiteSchema } from '@/seo/schema';
import { SITE_ORIGIN } from '@/seo/site';

export function HomePage() {
  // Scroll-reveal arming lives at the shell (App.tsx RevealArmer), which covers
  // this page's [data-reveal] blocks plus the shared footer on every route.

  const { hash } = useLocation();
  const [searchParams] = useSearchParams();
  // React Router does not scroll to a URL fragment after a pushState, so the
  // "Browse all tools" links (404 page, planned tool pages) silently landed at
  // the top of the hero instead of at the catalog they promise.
  useEffect(() => {
    if (!hash) return;
    document
      .getElementById(hash.slice(1))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  // The WebSite SearchAction sends `/?q=…`; land on the filtered catalog rather
  // than the hero, so the search the visitor performed is the first thing shown.
  useEffect(() => {
    if (!searchParams.get('q')) return;
    document.getElementById('all-tools')?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [searchParams]);

  const jsonLd = useMemo(
    () => [
      organizationSchema(SITE_ORIGIN),
      websiteSchema(SITE_ORIGIN),
      webPageSchema(
        { name: HOME_TITLE, description: HOME_DESCRIPTION, route: '/', image: '/og/home.png' },
        SITE_ORIGIN,
      ),
      faqPageSchema(HOME_FAQS, SITE_ORIGIN, '/'),
    ],
    [],
  );

  usePageHead({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    route: '/',
    image: '/og/home.png',
    imageAlt: 'PDFShush free online PDF tools – compress, merge, split and edit PDFs',
    keywords: HOME_KEYWORDS,
    jsonLd,
  });

  return (
    <>
      <HeroSection />
      <SocialProofSection />
      <PopularToolsSection />
      <AllToolsSection />
      <SeoHomeContent />
      <DocumentBand />
      <FeaturesSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
