interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`flex items-center select-none ${className ?? ''}`}>
      <img
        src="/pdfshush-wordmark.svg"
        alt="pdfshush"
        className="h-8 w-auto dark:invert"
        draggable={false}
      />
    </span>
  );
}
