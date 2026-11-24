import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '@/components/layout/info-page';
import { CONTACT_EMAIL } from '@/lib/site-info';

export function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="Privacy"
      title="Your files stay on your device."
      summary="pdfshush is built so the ordinary PDF tools work without an upload. This page explains the narrow cases where something can leave your browser, what is stored locally, and how to remove it."
      updated="24 November 2026"
    >
      <InfoSection id="who" title="Who we are">
        <p>
          pdfshush is an independent, open-source project. It is not a hosted account service on
          this deployment, and there is no company sign-up behind the tools. The contact for privacy
          and legal questions is{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </InfoSection>

      <InfoSection id="short-version" title="The short version">
        <p>
          The client-side tools run inside this tab. Your PDF or image is read by a worker in the
          browser, edited there, and written back from the same tab. There is no upload endpoint to
          call. No account is required, and there are no analytics or advertising cookies on this
          deployment.
        </p>
        <p>
          You can verify the local-processing claim yourself on the{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/trust">
            trust page
          </Link>
          . It reads the Content-Security-Policy the browser is actually enforcing and runs a real
          job with page-level network APIs instrumented.
        </p>
      </InfoSection>

      <InfoSection id="local-data" title="What stays on your device">
        <p>The app may keep the following in this browser, using localStorage or IndexedDB:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>recent-tool history, so the home page can show what you used last;</li>
          <li>editor drafts and their source bytes, up to the documented 60 MB cap;</li>
          <li>signature assets you choose to save, and their audit metadata;</li>
          <li>your preferences, such as theme and editor settings;</li>
          <li>the service-worker cache that keeps the app shell available offline.</li>
        </ul>
        <p>
          None of this is sent to us. You can delete it from the relevant tool, or clear this site’s
          data in your browser settings. A private window starts with none of it.
        </p>
      </InfoSection>

      <InfoSection id="leaving-device" title="When data can leave your device">
        <p>
          The AI tools are the exception, and only when you choose to use them. If you configure a
          provider with your own API key, the text or image you ask about is sent directly from your
          browser to that provider. The key is stored in this browser, not on a pdfshush server. The
          provider’s own privacy terms apply to that request.
        </p>
        <p>
          This deployment has no managed-AI endpoint. The server tier — accounts, synced history,
          workflows, the REST API and the MCP server — is switched off here, so there is no pdfshush
          server receiving a document from this site.
        </p>
      </InfoSection>

      <InfoSection id="hosting" title="Hosting metadata">
        <p>
          The site is served as static files by Cloudflare. Like any web host, Cloudflare processes
          ordinary request metadata needed to deliver the page, such as your IP address, user agent
          and the URL requested. That metadata does not include the contents of a PDF you open
          locally. We do not add third-party analytics, tracking pixels or advertising scripts.
        </p>
      </InfoSection>

      <InfoSection id="choices" title="Your choices">
        <ul className="list-disc space-y-2 pl-5">
          <li>Use a private window if you do not want local history or drafts kept.</li>
          <li>Clear site data in your browser to remove local history, drafts and signatures.</li>
          <li>Do not configure an AI provider if you do not want a prompt sent to it.</li>
          <li>
            Email{' '}
            <a
              className="font-medium text-foreground underline underline-offset-4"
              href={`mailto:${CONTACT_EMAIL}`}
            >
              {CONTACT_EMAIL}
            </a>{' '}
            for a privacy question or request.
          </li>
        </ul>
      </InfoSection>

      <InfoSection id="children" title="Children">
        <p>
          pdfshush is a general-purpose document utility, not a service directed to children under
          13. Do not use it to process a child’s personal data without the consent required where
          you live.
        </p>
      </InfoSection>

      <InfoSection id="changes" title="Changes and contact">
        <p>
          If this policy changes, the date at the top changes with it. Questions and requests can go
          to{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          . For a security report, use the process on the{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/contact">
            contact page
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPage>
  );
}
