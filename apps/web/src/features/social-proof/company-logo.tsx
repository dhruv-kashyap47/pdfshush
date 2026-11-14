import type { LogoEntry } from './socialProof.data';

interface CompanyLogoProps {
  logo: LogoEntry;
}

/**
 * One customer mark: an inline SVG supplied in the data file, or the company
 * name set as a wordmark. Both render at the same optical height, in the muted
 * ink; the optional link is the only thing that lifts to full contrast.
 */
export function CompanyLogo({ logo }: CompanyLogoProps) {
  const content = logo.svg ? (
    <>
      {/* Local, authored SVG from the data file — never remote or user input. */}
      <span
        className="sp-logo__svg"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: logo.svg }}
      />
      <span className="sr-only">{logo.name}</span>
    </>
  ) : (
    <span>{logo.name}</span>
  );

  if (logo.href) {
    return (
      <a className="sp-logo" href={logo.href} target="_blank" rel="noreferrer noopener">
        {content}
      </a>
    );
  }

  return <span className="sp-logo">{content}</span>;
}
