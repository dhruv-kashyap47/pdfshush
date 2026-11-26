import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '@/components/layout/info-page';
import { CONTACT_EMAIL } from '@/lib/site-info';

export function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="Privacy"
      title="Your files stay on your device."
      summary="pdfshush is built so the ordinary PDF tools work without an upload. This page explains the narrow cases where something can leave your browser, what is stored locally, and how to remove it."
      updated="26 November 2026"
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
          call. No account is required. Every page loads Google Tag Manager and Google Analytics to
          count visits and page views; that tag never receives a document, a filename or anything you
          open in a tool. There are no advertising cookies on this deployment.
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
          Accounts and the managed AI panel are live on this deployment, but neither receives a
          document unless you ask it to: signing in stores account details, and the AI panel sends
          the text you select in the editor. Workflows, the REST API and the MCP server belong to the
          archived server tier and do not run here, so there is no other upload endpoint.
        </p>
      </InfoSection>

      <InfoSection id="hosting" title="Hosting metadata">
        <p>
          The site is served as static files by Cloudflare. Like any web host, Cloudflare processes
          ordinary request metadata needed to deliver the page, such as your IP address, user agent
          and the URL requested. That metadata does not include the contents of a PDF you open
          locally. Beyond the measurement tag described below, this site adds no third-party
          analytics, no tracking pixels and no advertising scripts.
        </p>
      </InfoSection>

      <InfoSection id="analytics" title="Analytics">
        <p>
          One Google Tag Manager container (<code>GTM-W5QPVR3Z</code>) sends Google Analytics
          page-view and site-usage events. That is ordinary web measurement: the page you visited,
          an approximate location derived from your IP address, your browser and device, and a cookie
          or device identifier that lets Google tell a returning visit from a new one.
        </p>
        <p>
          <strong>The tag is opt-in in the EEA and the UK.</strong> If your browser is set to a
          European city, nothing is loaded until you choose “Allow measurement” in the panel that
          appears on your first page. Elsewhere the tag loads by default, and you can turn it off at
          any time with the <strong>Privacy settings</strong> link in the footer. Turning it off
          reloads the page so the tag is not loaded again.
        </p>
        <p>
          The tag is on every route, including the tool pages, but it never sees the file you open.
          Its payload is built from page metadata; no document, filename, page image or extracted
          text is added to it, and no tool sends a job or a result through it. You can also block it
          with an extension or your browser’s tracking protection: every tool keeps working, because
          none of them depend on the tag.
        </p>
        <p>
          Google processes this data under its own terms as an independent controller. There is no
          pdfshush analytics server and no separate advertising profile built from it.
        </p>
      </InfoSection>

      <InfoSection id="choices" title="Your choices">
        <ul className="list-disc space-y-2 pl-5">
          <li>Use a private window if you do not want local history or drafts kept.</li>
          <li>Clear site data in your browser to remove local history, drafts and signatures.</li>
          <li>
            Turn page-view measurement off, or back on, with the <strong>Privacy settings</strong>{' '}
            link in the footer.
          </li>
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

      <InfoSection id="ads" title="Advertising">
        <p>
          There is no advertising on this deployment. The PDF tools never show ads, and no ad
          network, retargeting pixel or ad consent platform is loaded on any page. Sponsor cards are
          first-party markup: a name, one line of copy and a logo served from pdfshush.com. A sponsor
          cannot add a script, and no sponsor data reaches the measurement tag.
        </p>
        <p>
          The only third-party script on any page is the measurement tag described above. It is not
          used to select advertising, and no ad cookie exists to read.
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
