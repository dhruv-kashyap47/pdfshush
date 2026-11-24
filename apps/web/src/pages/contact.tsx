import { InfoPage, InfoSection } from '@/components/layout/info-page';
import { CONTACT_EMAIL, ISSUES_URL, SECURITY_URL } from '@/lib/site-info';

export function ContactPage() {
  return (
    <InfoPage
      eyebrow="Contact"
      title="Tell us what broke."
      summary="pdfshush is maintained by a small independent team. Email is the reliable route; GitHub is best for a reproducible bug or a feature request."
      updated="24 November 2026"
    >
      <InfoSection id="email" title="Email">
        <p>
          Write to{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={`mailto:${CONTACT_EMAIL}`}
          >
            {CONTACT_EMAIL}
          </a>
          . For a privacy question or a data request, use the subject line “Privacy request”. We
          answer on a best-effort basis; there is no live chat or phone support.
        </p>
      </InfoSection>

      <InfoSection id="bugs" title="Bugs and feature requests">
        <p>
          Open an issue at{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={ISSUES_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            github.com/dhruv-kashyap47/pdfshush/issues
          </a>
          . Include the tool, your browser and version, the steps that reproduce it, and what you
          expected. Do not attach a real document. A small synthetic PDF or a screenshot of the
          error is enough.
        </p>
      </InfoSection>

      <InfoSection id="security" title="Security reports">
        <p>
          Do not open a public issue for a vulnerability. Use GitHub’s private security advisory
          form at{' '}
          <a
            className="font-medium text-foreground underline underline-offset-4"
            href={SECURITY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            the private advisory page
          </a>
          , or email {CONTACT_EMAIL} with “Security” in the subject. Please include the affected
          version, a minimal reproduction and the impact you believe it has.
        </p>
      </InfoSection>

      <InfoSection id="limits" title="What we cannot help with">
        <p>
          We cannot recover a document you did not save, read a file you have not shared, or provide
          legal advice about a signature or redaction. The tools show their limits before export;
          keep your own backup of anything important.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
