/**
 * Head metadata for the static information routes.
 *
 * The prerenderer emits the same values in the static HTML a crawler receives;
 * this map keeps SPA navigation from leaving the previous page's title in the
 * tab. When one of these strings changes, update both this file and the route
 * entry in `build/prerender.ts` (the SEO audit checks the built output).
 */

export interface StaticPageHead {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  keywords: string[];
  indexable?: boolean;
}

export const STATIC_PAGE_META: Record<string, StaticPageHead> = {
  '/workflows': {
    title: 'PDF Workflows – Automate and Re-Run PDF Tasks | PDFShush',
    description:
      'Chain PDF tools into a saved workflow recipe and re-run it on new files. Workflows are server-run, with a stated quota and a one-hour deletion window.',
    image: '/og/workflows.png',
    imageAlt: 'PDFShush workflows – chain PDF tools and re-run them',
    keywords: ['pdf workflow', 'automate pdf tasks', 'pdf pipeline'],
  },
  '/trust': {
    title: 'How PDFShush Proves Privacy – Live Proof | PDFShush',
    description:
      'The Content-Security-Policy is part of the build, the service worker is versioned, and the trust page runs a live proof with zero body-bearing requests.',
    image: '/og/home.png',
    imageAlt: 'How PDFShush proves that PDF files are not uploaded',
    keywords: ['private pdf tools in browser', 'pdf privacy', 'no upload pdf tools'],
  },
  '/verify': {
    title: 'Verify a Redacted PDF – SHA-256 Receipt | PDFShush',
    description:
      'Run the same independent verifier the Redact tool uses on any PDF and get a SHA-256 receipt of the exact bytes it checked, plus what it could not check.',
    image: '/og/home.png',
    imageAlt: 'PDFShush redaction verifier with a SHA-256 receipt',
    keywords: ['verify redacted pdf', 'pdf redaction verifier', 'sha256 pdf'],
  },
  '/privacy': {
    title: 'Privacy Policy – Files Stay on Your Device | PDFShush',
    description:
      'How PDFShush handles your data: what stays in the browser, the narrow cases where data can leave it, and how to remove local history, drafts and signatures.',
    image: '/og/home.png',
    imageAlt: 'PDFShush privacy policy – PDF tools that run in your browser',
    keywords: ['pdfshush privacy', 'private pdf tools', 'pdf tools no upload'],
  },
  '/terms': {
    title: 'Terms of Use – Free, Open Source PDF Tools | PDFShush',
    description:
      'The plain-language terms for using PDFShush: free, open source, provided as-is, with your documents always staying yours and no account is ever required.',
    image: '/og/home.png',
    imageAlt: 'PDFShush terms of use',
    keywords: ['pdfshush terms', 'free pdf tools terms'],
  },
  '/about': {
    title: 'About PDFShush – Free, Private, Open-Source PDF Tools',
    description:
      'Why PDFShush exists: ordinary PDF tasks should not require uploading the document. An independent, open-source workspace with 51 live client-side tools.',
    image: '/og/home.png',
    imageAlt: 'About PDFShush – an open-source PDF workspace',
    keywords: ['about pdfshush', 'open source pdf tools', 'private pdf workspace'],
  },
  '/contact': {
    title: 'Contact PDFShush – Support and Security | PDFShush',
    description:
      'Email foundersoffice@proton.me, open a GitHub issue for a reproducible bug, or use the private security advisory form for a security vulnerability report.',
    image: '/og/home.png',
    imageAlt: 'Contact PDFShush',
    keywords: ['contact pdfshush', 'pdfshush support'],
  },
  '/status': {
    title: 'Service Status – All Client PDF Tools Online | PDFShush',
    description:
      'The static app and all 51 client-side PDF tools are operational. Accounts, workflows, the REST API and MCP are not deployed on this origin. No login needed.',
    image: '/og/home.png',
    imageAlt: 'PDFShush service status',
    keywords: ['pdfshush status', 'pdf tools status'],
  },
  '/account': {
    title: 'Account – Optional Sync for Free PDF Tools | PDFShush',
    description:
      'Accounts are optional. Every client-side PDF tool works without one; an account only syncs preferences and workflow recipes. No document is ever uploaded.',
    image: '/og/home.png',
    imageAlt: 'Optional PDFShush account',
    keywords: ['pdfshush account'],
    indexable: false,
  },
};
