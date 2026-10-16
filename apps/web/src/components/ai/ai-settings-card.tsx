import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AI_PROVIDERS,
  type AiProviderId,
  type AiProviderConfig,
  type AiSettings,
} from '@pdfshush/ai-provider/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { providerUsable } from '@/lib/ai/settings';
import type { AiMode } from '@/lib/ai/mode';

interface AiSettingsCardProps {
  settings: AiSettings;
  /** Persist + adopt the edited settings. */
  onSave(settings: AiSettings): void;
  /** Erase everything stored (key included). Omit to hide the affordance. */
  onForget?(): void;
  /** Current AI mode; omit to hide the mode selector (BYOK-only surface). */
  mode?: AiMode;
  onModeChange?(mode: AiMode): void;
  /** Whether this deployment offers the managed trial. */
  managedAvailable?: boolean;
}

const EMPTY_CONFIG: AiProviderConfig = { apiKey: '', model: '' };

/**
 * AI configuration. Two modes: BYOK (key in this browser, requests go straight
 * to the provider) and the PDFShush managed trial (requests go through our
 * server, which is metered). The key never leaves the device in either case on
 * the BYOK path; managed mode is the one path where text reaches our server.
 */
export function AiSettingsCard({
  settings,
  onSave,
  onForget,
  mode = 'byok',
  onModeChange,
  managedAvailable = false,
}: AiSettingsCardProps) {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [showKey, setShowKey] = useState(false);

  // Adopt external changes (e.g. settings loaded after mount).
  useEffect(() => setDraft(settings), [settings]);

  const providerId = draft.provider;
  const meta = AI_PROVIDERS.find((m) => m.id === providerId);
  const config = draft.providers[providerId] ?? EMPTY_CONFIG;

  const patchConfig = (patch: Partial<AiProviderConfig>) => {
    setDraft((prev) => ({
      ...prev,
      providers: { ...prev.providers, [providerId]: { ...config, ...patch } },
    }));
  };

  const pickProvider = (id: AiProviderId) => setDraft((prev) => ({ ...prev, provider: id }));

  const save = () => {
    onSave(draft);
    toast.success('AI settings saved', { description: 'Your key stays in this browser.' });
  };

  const ready = providerUsable(draft, providerId);
  // "Saved" should mean "nothing pending", not "the config looks usable".
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          <KeyRound className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">AI provider</h3>
          <p className="text-sm text-muted-foreground">
            Bring your own key (the request goes straight from this browser to the provider), or use
            the PDFShush trial.
          </p>
        </div>
      </div>

      {onModeChange ? (
        <div className="mb-5 grid gap-2">
          <Label>Mode</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="AI mode">
            <Button
              type="button"
              size="sm"
              variant={mode === 'byok' ? 'default' : 'outline'}
              onClick={() => onModeChange('byok')}
              data-testid="ai-mode-byok"
            >
              <KeyRound className="mr-1.5 h-4 w-4" /> Use my own key
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'managed' ? 'default' : 'outline'}
              disabled={!managedAvailable}
              onClick={() => onModeChange('managed')}
              data-testid="ai-mode-managed"
              title={managedAvailable ? undefined : 'Not offered by this deployment'}
            >
              <Sparkles className="mr-1.5 h-4 w-4" /> PDFShush trial
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'managed' ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium">Using the PDFShush trial</p>
          <p className="mt-1 text-muted-foreground">
            Requests go through PDFShush and are metered against a daily allowance. This is the one
            mode where the text you ask about reaches our server. Switch to “Use my own key” to keep
            everything in this browser.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={providerId} onValueChange={(value) => pickProvider(value as AiProviderId)}>
                <SelectTrigger id="ai-provider">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                list="ai-model-options"
                value={config.model}
                placeholder={meta?.defaultModel || 'model-id'}
                onChange={(event) => patchConfig({ model: event.target.value })}
              />
              <datalist id="ai-model-options">
                {(meta?.models ?? []).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ai-key">{meta?.needsBaseUrl ? 'API key (optional)' : 'API key'}</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={config.apiKey}
                  placeholder={meta?.keyPlaceholder || 'sk-…'}
                  onChange={(event) => patchConfig({ apiKey: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  onClick={() => setShowKey((shown) => !shown)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {meta?.needsBaseUrl ? (
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="ai-baseurl">Base URL</Label>
                <Input
                  id="ai-baseurl"
                  value={config.baseUrl ?? ''}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => patchConfig({ baseUrl: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Point at any OpenAI-compatible server (OpenAI, Ollama, LM Studio, vLLM…).
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Stored in this browser only — never sent to PDFShush.
            </p>
            <div className="flex items-center gap-2">
              {onForget ? (
                <Button type="button" variant="ghost" size="sm" onClick={onForget} data-testid="ai-forget-key">
                  <Trash2 className="mr-1.5 h-4 w-4" /> Forget key
                </Button>
              ) : null}
              <Button type="button" onClick={save} disabled={!dirty} data-testid="ai-save-settings">
                {dirty ? null : <Check className="mr-1.5 h-4 w-4" />}
                {dirty ? 'Save settings' : ready ? 'Saved' : 'Nothing to save'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
