import { KeyRound, ShieldCheck } from 'lucide-react';

/**
 * Trust notes for the AI tools. These differ from the default footer on purpose:
 * the file really is parsed in this tab, but the *text you ask about* leaves it
 * for the provider you chose (or pdfshush, in the managed trial). Saying
 * "nothing is uploaded" here would be false, so this says what actually happens.
 *
 * Set as a footnote, not two more cards: the studio has enough chrome, and the
 * honest sentence is stronger when it reads as a caption under the work.
 */
export function AiTrustNotes() {
  return (
    <div className="studio-trust mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
      <p>
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Your key, your provider.</span> With a
          bring-your-own key, the file is parsed in this tab and your question goes straight from
          this browser to the provider you picked. The key is stored in this browser only.
        </span>
      </p>
      <p>
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        <span>
          <span className="font-medium text-foreground">You choose what leaves.</span> The provider
          settings show the mode in use. BYOK never reaches pdfshush; the managed trial is the one
          path where the text you ask about reaches our server, and no file is ever uploaded in
          either mode.
        </span>
      </p>
    </div>
  );
}
