interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`flex items-center ${className ?? ''}`}>
      <img
        src="/pdfshush-wordmark.svg"
        alt=""
        className="h-8 w-auto mix-blend-multiply dark:mix-blend-screen dark:invert"
      />
    </span>
  );
}
