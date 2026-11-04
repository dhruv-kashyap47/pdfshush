/**
 * The standalone redaction verifier (PLAN.md §31.4, bet D2).
 *
 * *"Don't trust us - verify it."* The Redact tool already runs an independent
 * verifier against the serialized bytes before it hands over a file. This page
 * exposes that same function to the user, for a file made here or anywhere
 * else, and produces a digest receipt they can keep.
 *
 * The page is deliberately explicit about the two checks it cannot decide: the
 * marks check needs the original regions, and the page count is read from the
 * same file it would be checking.
 */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Info,
  Loader2,
  Minus,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import {
  formatReceipt,
  verifyUserRedaction,
  type UserCheck,
  type UserVerification,
} from '@/lib/redaction-verify';

function CheckRow({ check }: { check: UserCheck }) {
  const icon =
    check.status === 'pass' ? (
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
    ) : check.status === 'fail' ? (
      <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
    ) : check.status === 'n/a' ? (
      <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : (
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    );

  const label =
    check.status === 'pass'
      ? 'Passed'
      : check.status === 'fail'
        ? 'Failed'
        : check.status === 'n/a'
          ? 'Not checked'
          : 'Information';

  return (
    <li
      className="flex items-start gap-2.5 border-b border-border/60 py-2.5 last:border-0"
      data-testid={`verify-check-${check.name}`}
      data-status={check.status}
    >
      {icon}
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {check.label}
          <span className="sr-only">: {label}.</span>
        </p>
        <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
          {check.detail}
        </p>
      </div>
    </li>
  );
}

function Result({ verification, name }: { verification: UserVerification; name: string }) {
  const receipt = formatReceipt(verification);
  const base = name.replace(/\.pdf$/iu, '');

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error('The clipboard was blocked. Select the text and copy it by hand.');
    }
  };

  return (
    <div className="mt-6 space-y-4" data-testid="verify-result" data-ok={verification.ok ? 'true' : 'false'}>
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${
          verification.ok
            ? 'border-primary/40 bg-primary/5'
            : 'border-amber-500/50 bg-amber-500/10'
        }`}
        data-testid="verify-verdict"
      >
        {verification.ok ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        )}
        <div>
          <p className="text-base font-semibold">
            {verification.ok ? 'Clean.' : `Content remains: ${verification.failed} check${verification.failed === 1 ? '' : 's'} failed.`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {verification.ok
              ? 'No extractable text, annotations, attachments or document metadata were found. The file is rebuilt from page images.'
              : 'The failed rows below are the content that survived. A PDF that has not been through redaction will normally fail here: that is the verifier working, not an error page.'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The file</CardTitle>
          <CardDescription>
            {name} - {formatBytes(verification.byteLength)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Pages</dt>
              <dd className="font-medium tabular-nums">{verification.pageCount ?? 'Unreadable'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Size</dt>
              <dd className="font-medium tabular-nums">{formatBytes(verification.byteLength)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Checks</dt>
              <dd className="font-medium tabular-nums">
                {verification.checks.filter((check) => check.status === 'pass').length} passed,{' '}
                {verification.failed} failed, {verification.notChecked} not checked
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              SHA-256 of the exact bytes
            </p>
            <div className="mt-1 flex flex-wrap items-start gap-2">
              <code
                className="min-w-0 flex-1 break-all rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed"
                data-testid="verify-digest"
              >
                {verification.digest}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copy(verification.digest, 'Digest copied.')}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The digest identifies the file. The same bytes always produce this same digest and the
              same receipt.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-base">What the verifier found</CardTitle>
          <CardDescription>
            The same checks the Redact tool runs before it will export a file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul data-testid="verify-checks">
            {verification.checks.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Two rows are honest exceptions.</span>{' '}
            &ldquo;Marks burned into pixels&rdquo; needs the marked areas, which this page does not
            have, so it is reported as not checked. &ldquo;Page count&rdquo; is read from the same
            file, so it is information rather than evidence.
          </p>
        </CardContent>
      </Card>

      <details
        className="rounded-lg border border-border/70 bg-card p-4"
        data-testid="verify-receipt"
      >
        <summary className="cursor-pointer text-sm font-medium">Receipt</summary>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
          {receipt}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copy(receipt, 'Receipt copied.')}
            data-testid="verify-copy-receipt"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy receipt
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              downloadBytes(
                new TextEncoder().encode(receipt),
                `${base}-verified.txt`,
                'text/plain',
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download .txt
          </Button>
        </div>
      </details>
    </div>
  );
}

export function VerifyPage() {
  const [file, setFile] = useState<File | null>(null);
  const [verification, setVerification] = useState<UserVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (target: File) => {
    setBusy(true);
    setError(null);
    setVerification(null);
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      setVerification(await verifyUserRedaction(bytes, { name: target.name }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
        <Link to="/trust">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Trust
        </Link>
      </Button>

      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Redaction verifier
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Don't trust us. Verify it.</h1>
      <p className="mt-3 text-base text-muted-foreground">
        Drop in a redacted PDF - made here or anywhere else - and this page runs the same independent
        verifier the Redact tool uses before export. It checks the serialized bytes, not the
        intention, and gives you a SHA-256 receipt to keep.
      </p>

      <div className="mt-6">
        <FileDropzone
          files={file ? [file] : []}
          onFiles={(files) => {
            const picked = files[0];
            if (!picked) return;
            setFile(picked);
            void run(picked);
          }}
          multiple={false}
          disabled={busy}
          hint="One PDF at a time. Checked in this tab."
          note="Parsed in this tab by the same engine as the tools; never uploaded."
        />
      </div>

      {busy ? (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Reading the file and running every check.
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium">That file could not be checked.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {verification && file ? <Result verification={verification} name={file.name} /> : null}

      <div className="mt-8 rounded-lg border border-border/70 bg-muted/20 p-4">
        <p className="text-xs font-medium text-foreground">What this verifier does not claim</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            It reads structure and text, not intent. A photograph of a page can contain a secret
            without any extractable text; redaction quality is a separate judgement.
          </li>
          <li>
            It cannot confirm that a mark was drawn over the right area, because it does not receive
            the areas. Use the Redact tool for that check: it verifies its own marks against the
            output pixels before exporting.
          </li>
          <li>
            A normal, unredacted PDF will fail the text checks. That is the correct answer to
            &ldquo;what survived?&rdquo;, not a broken file.
          </li>
        </ul>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Redacting for the first time?{' '}
        <Link className="underline underline-offset-2" to="/tools/redact-pdf">
          Open the Redact tool
        </Link>
        . Every guarantee there is enforced by the same code shown here.
      </p>
    </div>
  );
}
