interface LogoProps {
  className?: string;
}

/**
 * The PDFShush wordmark, drawn inline so it inherits the theme's ink colour:
 * deep charcoal on ivory in light mode, warm white on black in dark mode.
 * The artwork is the brand's own file (public/pdfshush-wordmark.svg) — the
 * paths and letterforms are unchanged, only the way they are filled moved
 * from a flattened image to live text.
 */
export function Logo({ className }: LogoProps) {
  return (
    <span className={`brand-mark flex items-center select-none ${className ?? ''}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 820 320"
        role="img"
        aria-label="pdfshush"
        className="h-8 w-auto"
        fill="currentColor"
      >
        <text x="105" y="205" fontFamily="Inter, Helvetica Neue, Arial, sans-serif" fontSize="142" fontWeight="300" letterSpacing="-7">
          pdf
        </text>
        <text x="306" y="205" fontFamily="Inter, Helvetica Neue, Arial, sans-serif" fontSize="142" fontWeight="750" letterSpacing="-7">
          shush
        </text>
        <path d="M745 76 C750 94 757 101 775 106 C757 111 750 118 745 136 C740 118 733 111 715 106 C733 101 740 94 745 76 Z" />
      </svg>
    </span>
  );
}
