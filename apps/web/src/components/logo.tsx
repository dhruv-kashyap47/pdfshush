interface LogoProps {
  className?: string;
}

/**
 * PDFShush mark: a document with a redaction bar. The bar is the "shush" --
 * what you keep private is what the product is about.
 */
export function LogoMark({ className = 'h-8 w-8' }: LogoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ps-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00d486" />
          <stop offset="100%" stopColor="#009d5f" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="8" fill="url(#ps-mark)" />
      <path
        d="M9 7.5A1.5 1.5 0 0 1 10.5 6h7.2c.4 0 .78.16 1.06.44l4.3 4.3c.28.28.44.66.44 1.06V24.5A1.5 1.5 0 0 1 22 26H10.5A1.5 1.5 0 0 1 9 24.5v-17Z"
        fill="#ffffff"
        fillOpacity="0.95"
      />
      <path d="M18 6.4V10.4c0 .55.45 1 1 1h4.1L18 6.4Z" fill="#c7efe0" />
      <rect x="12" y="14" width="8.5" height="2.4" rx="1.2" fill="#059669" />
      <rect x="12" y="18.4" width="6" height="2.4" rx="1.2" fill="#059669" opacity="0.55" />
    </svg>
  );
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark className="h-8 w-8" />
      <span className="text-lg font-bold tracking-tight">
        PDF<span className="text-primary">Shush</span>
      </span>
    </span>
  );
}
