import { KeyRound, ShieldCheck } from 'lucide-react';
import type { AiSettings } from '@pdfshush/ai-provider/browser';
import { AiSettingsCard } from '@/components/ai/ai-settings-card';
import type { AiMode } from '@/lib/ai/mode';

interface AiSetupSectionProps {
  settings: AiSettings;
  mode: AiMode;
  /** Whether this deployment offers the pdfshush trial. */
  managedAvailable: boolean;
  onSave(settings: AiSettings): void;
  onModeChange(mode: AiMode): void;
  /** Erase everything stored (key included). Omit to hide the affordance. */
  onForget?(): void;
}

/**
 * The connect-a-model card that overlaps the frontispiece while no usable
 * model exists. Both AI surfaces render the same card: the studio workspace
 * under its cover, and the editor under its frontispiece.
 */
export function AiSetupSection({
  settings,
  mode,
  managedAvailable,
  onSave,
  onModeChange,
  onForget,
}: AiSetupSectionProps) {
  return (
    <section className="studio-setup" aria-labelledby="studio-setup-title">
      <div className="studio-setup-intro">
        <span className="studio-setup-glyph" aria-hidden>
          <KeyRound className="h-4 w-4" />
        </span>
        <h2 id="studio-setup-title" className="studio-setup-title">
          Connect a model
        </h2>
        <p className="studio-setup-copy">
          Bring your own key, or use the pdfshush trial. Your key stays in this browser.
        </p>
        <p className="studio-setup-note">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          No account. The file is parsed in this tab.
        </p>
      </div>
      <div className="studio-setup-form">
        <AiSettingsCard
          settings={settings}
          onSave={onSave}
          mode={mode}
          onModeChange={onModeChange}
          managedAvailable={managedAvailable}
          surface="plain"
          showHead={false}
          {...(onForget ? { onForget } : {})}
        />
      </div>
    </section>
  );
}
