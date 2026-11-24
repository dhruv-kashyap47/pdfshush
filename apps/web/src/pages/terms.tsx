import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '@/components/layout/info-page';
import { CONTACT_EMAIL } from '@/lib/site-info';

export function TermsPage() {
  return (
    <InfoPage
      eyebrow="Terms"
      title="Free, open source, and provided as-is."
      summary="These are the plain-language terms for using pdfshush. They are intentionally short: the product is a local document tool, not a hosted service with a subscription."
      updated="24 November 2026"
    >
      <InfoSection id="using" title="Using pdfshush">
        <p>
          You may use the tools for personal or business documents you have the right to process.
          Do not use the site to break the law, to process material you do not have permission to
          handle, or to attack the service or another person.
        </p>
        <p>
          The client-side tools are free and do not require an account. There is no service-level
          agreement, no uptime guarantee and no promise that a particular tool will always be
          available.
        </p>
      </InfoSection>

      <InfoSection id="files" title="Your files and your rights">
        <p>
          You keep ownership of your documents. Because the ordinary tools run in your browser, we
          do not receive a copy and claim no licence over your content. You are responsible for
          keeping your own backups and for checking an exported file before you rely on it.
        </p>
        <p>
          pdfshush is licensed under the GNU Affero General Public License, version 3 or later. The
          source is available on{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href="https://github.com/dhruv-kashyap47/pdfshush"
            target="_blank"
            rel="noreferrer noopener"
          >
            GitHub
          </a>
          , and the licence — not this page — governs copying, modification and redistribution.
        </p>
      </InfoSection>

      <InfoSection id="ai" title="AI features">
        <p>
          AI output can be wrong, incomplete or based on a provider’s own model and retention
          policy. If you use an AI tool with your own provider key, the request goes directly to
          that provider and their terms apply. Review any proposed change before you export it.
        </p>
      </InfoSection>

      <InfoSection id="liability" title="No warranty and limitation of liability">
        <p>
          The software is provided “as is” and “as available”, without warranties of any kind,
          express or implied, including fitness for a particular purpose. To the extent permitted by
          law, the operator is not liable for indirect, incidental or consequential loss arising
          from use of the site, including a lost or corrupted document.
        </p>
        <p>
          Nothing on this page limits rights that mandatory consumer law gives you and that cannot
          be waived.
        </p>
      </InfoSection>

      <InfoSection id="law" title="Governing law">
        <p>
          These terms are governed by the laws that apply to the operator, without regard to
          conflict-of-law rules. If you are a consumer, you keep the mandatory protections of the
          country where you live. Before starting a formal dispute, please contact us so we can try
          to resolve it.
        </p>
      </InfoSection>

      <InfoSection id="changes" title="Changes and contact">
        <p>
          We may update these terms as the product changes; the date at the top records the current
          version. Questions can go to{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          . The{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/privacy">
            privacy policy
          </Link>{' '}
          explains what stays on your device.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
