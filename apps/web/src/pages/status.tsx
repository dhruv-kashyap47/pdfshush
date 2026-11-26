import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '@/components/layout/info-page';

export function StatusPage() {
  return (
    <InfoPage
      eyebrow="Status"
      title="The static app and its client tools are operational."
      summary="This page describes the deployment honestly. It is a static status note, not a live monitoring dashboard, and it does not claim an uptime guarantee."
      updated="26 November 2026"
    >
      <InfoSection id="operational" title="Operational now">
        <ul className="list-disc space-y-2 pl-5">
          <li>The app shell, prerendered tool pages, sitemap and robots file are served over HTTPS.</li>
          <li>All 48 live client-side tools run in the browser.</li>
          <li>The editor, redaction, OCR, signatures and offline app shell are available.</li>
          <li>The redaction verifier is available for any exported PDF.</li>
          <li>The optional Worker answers `/api/health` and `/api/capabilities` from Cloudflare.</li>
        </ul>
      </InfoSection>

      <InfoSection id="not-deployed" title="Not deployed on this origin">
        <p>
          Workflow recipes, the public REST API and the MCP server are archived with the
          Express/BullMQ server tier. Their permanent pages explain that instead of offering a
          broken button. Accounts, cloud sync and the managed AI trial are Worker features: they
          appear once the deployment has Google and OpenRouter secrets, and stay hidden until then.
        </p>
      </InfoSection>

      <InfoSection id="monitoring" title="How to check for yourself">
        <p>
          The{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/trust">
            trust page
          </Link>{' '}
          reports the live Content-Security-Policy and the service-worker state. The{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/verify">
            verifier
          </Link>{' '}
          can check a redacted export. If a tool fails, the error names the likely cause and the
          next step; a browser reload is the first thing to try.
        </p>
        <p>
          There is no incident history recorded on this page because the deployment has no server
          tier and no on-call rotation. For a persistent problem, use the{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/contact">
            contact page
          </Link>
          .
        </p>
      </InfoSection>
    </InfoPage>
  );
}
