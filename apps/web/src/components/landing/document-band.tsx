/**
 * The page's one deliberate poster moment between the catalog and the pitch:
 * a full-bleed brand strip. The stem artwork is drawn on the same black the
 * section paints, so the plate, the mark and the statement share a single
 * canvas with no seam in either theme. The crop is deliberate: the dot peaks
 * run past the frame edges while the folder and wordmark hold dead centre.
 * No scrim, no credit line; the type sits in the void the plate provides.
 */
export function DocumentBand() {
  return (
    <section aria-label="Private document processing" className="overflow-hidden bg-black">
      <img
        src="/brand/stem-2.png"
        width={1854}
        height={848}
        alt="The PDFShush mark: a blue folder with its wordmark, held between two halftone peaks drawn in white dots on black"
        loading="lazy"
        decoding="async"
        draggable={false}
        className="band-photo block h-[320px] w-full object-cover sm:h-[440px] lg:h-[500px]"
        style={{ objectPosition: '50% 46%' }}
      />
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p
            className="text-balance text-2xl font-semibold leading-snug tracking-tight text-white sm:text-4xl"
            data-reveal
          >
            The tools stay powerful. The document stays yours.
          </p>
          <p
            className="mx-auto mt-4 max-w-xl text-balance text-[15px] leading-relaxed text-white/70 sm:mt-5 sm:text-base"
            data-reveal
            data-reveal-delay="120"
          >
            Every merge, convert, redact and sign runs locally in this tab, so sensitive files
            never touch a server and never leave your control.
          </p>
        </div>
      </div>
    </section>
  );
}
