import { KeyRound, ShieldCheck } from 'lucide-react';

/**
 * Trust notes for the AI tools. These differ from the default footer on purpose:
 * the file really is parsed in this tab, but the *text you ask about* leaves it
 * for the provider you chose (or PDFShush, in the managed trial). Saying
 * "nothing is uploaded" here would be false, so this says what actually happens.
 */
export function AiTrustNotes() {
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Your key, your provider.</span> With a bring-
          your-own key, the file is parsed in this tab and your question goes straight from this
          browser to the provider you picked. The key is stored in this browser only.
        </p>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3.5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">You choose what leaves.</span> The header shows
          the mode in use. BYOK never reaches PDFShush; the managed trial is the one path where the
          text you ask about reaches our server, and no file is ever uploaded in either mode.
        </p>
      </div>
    </div>
  );
}
