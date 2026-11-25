import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '@/components/layout/info-page';
import { CONTACT_EMAIL, REPOSITORY_URL } from '@/lib/site-info';

export function AboutPage() {
  return (
    <InfoPage
      eyebrow="About"
      title="PDF tools without the upload."
      summary="pdfshush is an independent, open-source PDF workspace built around one rule: an ordinary document task should not require handing the document to someone else’s server."
      updated="24 November 2026"
    >
      <InfoSection id="why" title="Why it exists">
        <p>
          Most free PDF sites ask you to upload the file, wait for a remote worker, and hope the
          copy is deleted. That is a strange default for a bank statement, a medical letter or a
          signed contract. pdfshush moves the work into the browser: a Web Worker parses the PDF,
          the canvas renders the page, and the result is written back on your device.
        </p>
        <p>
          The catalog is deliberately honest. Fifty-one tools are live; seven are coming soon,
          each with a public reason and a link to the closest live alternative. A tool page exists even
          when the tool does not, so a search result never lands on a fake button.
        </p>
      </InfoSection>

      <InfoSection id="how" title="How it works">
        <p>
          The engine is shared between the browser and the optional Node pipeline: pdf.js for
          rendering, a maintained pdf-lib fork for writing, PDFium for native text edits, and
          Tesseract for local OCR. The editor adds selection, undo, drafts, find-and-replace and an
          export receipt. The main bundle stays engine-free; the heavy code loads only when a tool
          needs it.
        </p>
        <p>
          The service worker keeps the app shell available offline. The{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/trust">
            trust page
          </Link>{' '}
          reads the policy this build is actually running under and runs a local-processing proof.
        </p>
      </InfoSection>

      <InfoSection id="limits" title="What it does not do">
        <p>
          The browser is not a data centre. This deployment has no accounts, no synced history, no
          workflow runner and no REST or MCP backend; those surfaces say so instead of offering a
          control that can only fail. In-browser work is bounded to 100 MB and 500 pages per run,
          and the editor states the narrower limits that apply to a particular document.
        </p>
      </InfoSection>

      <InfoSection id="source" title="Open source and contact">
        <p>
          The source is available under AGPL-3.0-or-later at{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            github.com/dhruv-kashyap47/pdfshush
          </a>
          . For a question, a bug or a privacy request, write to{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>{' '}
          or use the{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/contact">
            contact page
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPage>
  );
}
