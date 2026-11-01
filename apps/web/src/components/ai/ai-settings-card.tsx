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
import { cn } from '@/lib/utils';

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
  /**
   * `card` is the standalone surface; `plain` drops the outer chrome when the
   * card is already inside a popover, a setup section or a rail.
   */
  surface?: 'card' | 'plain';
  /** Hide the internal heading when the parent already sets the context. */
  showHead?: boolean;
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
  surface = 'card',
  showHead = true,
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
    <div
      className={cn(
        'studio-settings',
        surface === 'plain' && 'is-plain',
        !showHead && 'is-headless',
      )}
    >
      {showHead ? (
        <div className="studio-settings-head">
          <span className="studio-glyph" aria-hidden>
            <KeyRound className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="studio-settings-title">AI provider</h3>
            <p className="studio-settings-copy">
              Bring your own key. The request goes straight from this browser to the provider, or
              use the PDFShush trial.
            </p>
          </div>
        </div>
      ) : null}

      {onModeChange ? (
        <div className="studio-settings-mode">
          <span className="studio-field-label">Mode</span>
          <div className="studio-segment" role="group" aria-label="AI mode">
            <button
              type="button"
              aria-pressed={mode === 'byok'}
              onClick={() => onModeChange('byok')}
              className={cn('studio-segment-btn', mode === 'byok' && 'is-active')}
              data-testid="ai-mode-byok"
            >
              <KeyRound className="h-3.5 w-3.5" /> Use my own key
            </button>
            <button
              type="button"
              aria-pressed={mode === 'managed'}
              disabled={!managedAvailable}
              onClick={() => onModeChange('managed')}
              className={cn('studio-segment-btn', mode === 'managed' && 'is-active')}
              data-testid="ai-mode-managed"
              title={managedAvailable ? undefined : 'Not offered by this deployment'}
            >
              <Sparkles className="h-3.5 w-3.5" /> PDFShush trial
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'managed' ? (
        <div className="studio-settings-managed">
          <p className="font-medium">Using the PDFShush trial</p>
          <p className="mt-1">
            Requests go through PDFShush and are metered against a daily allowance. This is the one
            mode where the text you ask about reaches our server. Switch to “Use my own key” to keep
            everything in this browser.
          </p>
        </div>
      ) : (
        <>
          <div className="studio-settings-fields">
            <div className="studio-field">
              <Label htmlFor="ai-provider" className="studio-field-label">
                Provider
              </Label>
              <Select
                value={providerId}
                onValueChange={(value) => pickProvider(value as AiProviderId)}
              >
                <SelectTrigger id="ai-provider">
                  <SelectValue placeholder="Choose a provider" />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label}
                      {/* Cost story, declared by the catalog and rendered as-is;
                          the title spells out what the one-word tag means. */}
                      {provider.tier ? (
                        <span
                          title={
                            provider.tier === 'free'
                              ? 'The default model here is free to run; other model ids may be paid.'
                              : 'Pay-as-you-go, far below frontier pricing.'
                          }
                          className={`ml-2 text-[0.65rem] font-normal uppercase tracking-wide ${
                            provider.tier === 'free'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {provider.tier === 'free' ? 'Free' : 'Budget'}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="studio-field">
              <Label htmlFor="ai-model" className="studio-field-label">
                Model
              </Label>
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

            <div className="studio-field studio-field--wide">
              <Label htmlFor="ai-key" className="studio-field-label">
                {meta?.needsBaseUrl ? 'API key (optional)' : 'API key'}
              </Label>
              <div className="flex gap-1.5">
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
                  className="h-9 w-9 shrink-0"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                  onClick={() => setShowKey((shown) => !shown)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {meta?.needsBaseUrl ? (
              <div className="studio-field studio-field--wide">
                <Label htmlFor="ai-baseurl" className="studio-field-label">
                  Base URL
                </Label>
                <Input
                  id="ai-baseurl"
                  value={config.baseUrl ?? ''}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => patchConfig({ baseUrl: event.target.value })}
                />
                <p className="text-[0.7rem] text-muted-foreground">
                  Point at any OpenAI-compatible server (OpenAI, Ollama, LM Studio, vLLM…).
                </p>
              </div>
            ) : null}
          </div>

          <div className="studio-settings-foot">
            <p className="studio-settings-note">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Stored in this browser only; never sent to PDFShush.
            </p>
            <div className="flex items-center gap-1.5">
              {onForget ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={onForget}
                  data-testid="ai-forget-key"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Forget key
                </Button>
              ) : null}
              {/* A disabled save must not keep the primary treatment: at 50% opacity a
                  saturated green button still reads as the page's main action. */}
              <Button
                type="button"
                variant={dirty ? 'default' : 'secondary'}
                size="sm"
                className="h-8"
                onClick={save}
                disabled={!dirty}
                data-testid="ai-save-settings"
              >
                {dirty ? null : <Check className="mr-1.5 h-3.5 w-3.5" />}
                {dirty ? 'Save settings' : ready ? 'Saved' : 'Nothing to save'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
