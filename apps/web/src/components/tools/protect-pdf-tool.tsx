import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  PROTECT_DEFAULT_PERMISSIONS,
  PROTECT_LIMITS,
  timeoutForPageCount,
  type InspectOutput,
  type ProtectJobOutput,
  type ProtectPermissions,
} from '@pdfshush/pdf-core';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { JobProgressPanel } from '@/components/tools/job-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useJobRunner } from '@/hooks/use-job-runner';
import { announceCapacityWarning, checkClientCapacity } from '@/lib/client-capacity';
import { downloadBytes } from '@/lib/download';
import { formatBytes } from '@/lib/format';
import { largestBytes, readAsInputFiles, shortName } from '@/lib/files';
import { recordRecent } from '@/tools/recent';

const PERMISSION_OPTIONS: {
  key: keyof ProtectPermissions;
  label: string;
  detail: string;
}[] = [
  {
    key: 'printing',
    label: 'Allow printing',
    detail: 'Includes high-resolution printing.',
  },
  {
    key: 'copying',
    label: 'Allow copying',
    detail: 'Text and images can be copied out.',
  },
  {
    key: 'modifying',
    label: 'Allow editing',
    detail: 'Change the content of existing pages.',
  },
  {
    key: 'annotating',
    label: 'Allow annotations',
    detail: 'Comments, highlights and stamps.',
  },
  {
    key: 'fillingForms',
    label: 'Allow form filling',
    detail: 'Fill existing interactive fields.',
  },
  {
    key: 'documentAssembly',
    label: 'Allow page assembly',
    detail: 'Insert, delete, rotate or reorder pages.',
  },
];

const STRENGTH = [
  { label: 'Too short', bar: 'bg-destructive', text: 'text-destructive' },
  { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  { label: 'Good', bar: 'bg-primary', text: 'text-primary' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
] as const;

/**
 * Protect PDF: real AES-256 encryption, done in the browser worker. The card is
 * explicit about the distinction the industry usually blurs: an open password
 * decrypts the file, while the permission switches are advisory controls that
 * mainstream readers honour but encryption cannot enforce after decryption.
 */
export function ProtectPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<InspectOutput['documents'][number] | null>(null);
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [permissions, setPermissions] = useState<ProtectPermissions>({
    ...PROTECT_DEFAULT_PERMISSIONS,
  });

  const inspectRunner = useJobRunner<InspectOutput>('inspect');
  const runner = useJobRunner<ProtectJobOutput>('protect');
  const inspecting = inspectRunner.state.status === 'running';
  const protecting = runner.state.status === 'running';
  const running = inspecting || protecting;

  const passwordTooShort =
    password.length > 0 && password.length < PROTECT_LIMITS.minPasswordLength;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ownerTooShort =
    advanced && ownerPassword.length > 0 && ownerPassword.length < PROTECT_LIMITS.minPasswordLength;
  const ownerMatches = advanced && ownerPassword.length > 0 && ownerPassword === password;
  const strength = password.length > 0 ? passwordStrength(password) : null;
  const canRun =
    file !== null &&
    sourceWarning === null &&
    !running &&
    password.length >= PROTECT_LIMITS.minPasswordLength &&
    password === confirm &&
    !ownerTooShort &&
    !ownerMatches;

  const handleFiles = async (incoming: File[]) => {
    if (incoming.length === 0) {
      setFile(null);
      setInspect(null);
      setSourceWarning(null);
      return;
    }
    const candidate = incoming[0]!;
    const verdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      largestFileBytes: largestBytes([candidate]),
    });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    announceCapacityWarning(verdict);
    inspectRunner.reset();
    setFile(candidate);
    setInspect(null);
    setSourceWarning(null);

    const outcome = await inspectRunner.run(await readAsInputFiles([candidate]));
    if (!outcome.ok) {
      if (outcome.aborted) return;
      if (/password protected|incorrect password|encrypted/i.test(outcome.message)) {
        setSourceWarning('This PDF is already password protected.');
      } else {
        toast.error(outcome.message);
        setFile(null);
      }
      return;
    }
    const doc = outcome.result.documents[0];
    if (!doc) return;
    setInspect(doc);

    const pageVerdict = checkClientCapacity({
      fileCount: 1,
      totalBytes: candidate.size,
      pageCount: doc.pageCount,
    });
    if (!pageVerdict.ok) toast.error(pageVerdict.message);
  };

  const run = async () => {
    if (!file || !canRun) return;
    const outcome = await runner.run(
      await readAsInputFiles([file]),
      {
        userPassword: password,
        ...(advanced && ownerPassword.length > 0 ? { ownerPassword } : {}),
        permissions,
      },
      { timeoutMs: timeoutForPageCount(inspect?.pageCount ?? 60) },
    );
    if (!outcome.ok) {
      if (!outcome.aborted) toast.error(outcome.message);
      return;
    }
    setPassword('');
    setConfirm('');
    setOwnerPassword('');
    void recordRecent({
      toolSlug: 'protect-pdf',
      toolName: 'Protect PDF',
      fileName: outcome.result.fileName,
      pageCount: outcome.result.pageCount,
      sizeBytes: outcome.result.data.byteLength,
    });
  };

  if (runner.state.status === 'done') {
    const { result } = runner.state;
    return (
      <ResultPanel
        fileName={result.fileName}
        pageCount={result.pageCount}
        sizeBytes={result.data.byteLength}
        onDownload={() => downloadBytes(result.data, result.fileName)}
        onReset={() => {
          runner.reset();
          setFile(null);
          setInspect(null);
          setSourceWarning(null);
          setPassword('');
          setConfirm('');
          setOwnerPassword('');
          setAdvanced(false);
          setPermissions({ ...PROTECT_DEFAULT_PERMISSIONS });
        }}
        footerNote={
          result.ownerPasswordGenerated
            ? 'AES-256 encrypted. We generated a separate owner key, so the permission switches stay protected. Keep the open password safe — there is no recovery.'
            : 'AES-256 encrypted. Keep both passwords safe — there is no recovery.'
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" /> AES-256
            </span>
            <span className="text-muted-foreground">Open password required</span>
            <span className="text-muted-foreground">Permissions protected</span>
          </div>
          <p className="text-xs text-muted-foreground">{summarizePermissions(result.permissions)}</p>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            Permissions are honoured by mainstream PDF readers. They do not stop screenshots or
            someone who already has the open password.
          </p>
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        files={file ? [file] : []}
        onFiles={(next) => void handleFiles(next)}
        multiple={false}
        disabled={running}
        hint="one PDF; encrypted on this device"
      />

      {file && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <LockKeyhole className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{shortName(file.name)}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
                {inspect ? ` · ${inspect.pageCount.toLocaleString()} pages` : ''}
                {inspecting ? ' · reading document…' : ''}
              </p>
            </div>
          </div>

          {sourceWarning && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {sourceWarning} <Link to="/tools/unlock-pdf" className="underline">Unlock it first</Link>{' '}
                so you do not double-lock the document, then protect the clean copy.
              </p>
            </div>
          )}

          {!sourceWarning && (
            <>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <PasswordField
                  id="protect-password"
                  label="Open password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={running}
                  autoComplete="new-password"
                  placeholder={`At least ${PROTECT_LIMITS.minPasswordLength} characters`}
                  error={
                    passwordTooShort
                      ? `Use at least ${PROTECT_LIMITS.minPasswordLength} characters.`
                      : undefined
                  }
                />
                <PasswordField
                  id="protect-confirm"
                  label="Confirm password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  disabled={running}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  error={mismatch ? 'The passwords do not match.' : undefined}
                />
              </div>

              {strength && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span className="flex gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((step) => (
                      <span
                        key={step}
                        className={`h-1.5 w-6 rounded-full ${
                          step <= strength.score ? strength.bar : 'bg-muted'
                        }`}
                      />
                    ))}
                  </span>
                  <span className={strength.text}>{strength.label}</span>
                  <span className="text-muted-foreground">
                    A memorable phrase beats a short puzzle.
                  </span>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (advanced) setOwnerPassword('');
                  setAdvanced((value) => !value);
                }}
                aria-expanded={advanced}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advanced ? 'rotate-180' : ''}`}
                />
                {advanced ? 'Hide owner password' : 'Owner password (optional)'}
              </button>

              {advanced && (
                <div className="mt-3 max-w-md">
                  <PasswordField
                    id="protect-owner"
                    label="Owner password"
                    value={ownerPassword}
                    onChange={(event) => setOwnerPassword(event.target.value)}
                    disabled={running}
                    autoComplete="new-password"
                    placeholder="Optional; leave blank to generate one"
                    hint="Lets you change these permissions later. It must differ from the open password. Leave it blank and we generate a random owner key; your open password can still remove protection with Unlock."
                    error={
                      ownerTooShort
                        ? `Use at least ${PROTECT_LIMITS.minPasswordLength} characters, or leave it blank.`
                        : ownerMatches
                          ? 'Use a different password from the open password.'
                          : undefined
                    }
                  />
                </div>
              )}

              <div className="mt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">Permissions</p>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setPermissions({ ...PROTECT_DEFAULT_PERMISSIONS })}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {PERMISSION_OPTIONS.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-start gap-2 rounded-lg border border-border p-2.5"
                    >
                      <Checkbox
                        id={`protect-permission-${option.key}`}
                        checked={permissions[option.key]}
                        disabled={running}
                        onCheckedChange={(value) =>
                          setPermissions((current) => ({
                            ...current,
                            [option.key]: value === true,
                          }))
                        }
                      />
                      <div className="min-w-0">
                        <Label
                          htmlFor={`protect-permission-${option.key}`}
                          className="text-sm font-medium"
                        >
                          {option.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{option.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Accessibility extraction is always allowed. These switches are honoured by
                  mainstream readers, but they cannot prevent screenshots or someone who has the
                  open password from viewing the file.
                </p>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  AES-256 · password never leaves this tab
                </p>
                <Button size="lg" disabled={!canRun} onClick={() => void run()}>
                  {protecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Encrypting…
                    </>
                  ) : inspecting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading pages…
                    </>
                  ) : (
                    <>
                      <LockKeyhole className="mr-1.5 h-4 w-4" /> Protect PDF
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {runner.state.status === 'running' && (
        <JobProgressPanel progress={runner.state.progress} onCancel={runner.cancel} />
      )}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
  placeholder,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  autoComplete: string;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const descriptionId = `${id}-description`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          disabled={disabled}
          autoComplete={autoComplete}
          placeholder={placeholder}
          spellCheck={false}
          maxLength={PROTECT_LIMITS.maxPasswordLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? descriptionId : undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {(error || hint) && (
        <p
          id={descriptionId}
          className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function passwordStrength(password: string): (typeof STRENGTH)[number] & { score: number } {
  if (password.length < PROTECT_LIMITS.minPasswordLength) {
    return { ...STRENGTH[0]!, score: 1 };
  }
  let score = 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const index = Math.min(3, Math.max(0, score));
  return { ...STRENGTH[index]!, score: index + 1 };
}

function summarizePermissions(permissions: ProtectPermissions): string {
  const allowed: string[] = [];
  if (permissions.printing) allowed.push('printing');
  if (permissions.copying) allowed.push('copying');
  if (permissions.modifying) allowed.push('editing');
  if (permissions.annotating) allowed.push('annotations');
  if (permissions.fillingForms) allowed.push('form filling');
  if (permissions.documentAssembly) allowed.push('page assembly');
  if (allowed.length === 0) {
    return 'No printing, copying, editing, annotations, form filling or page assembly allowed.';
  }
  return `Allowed: ${allowed.join(', ')}.`;
}
