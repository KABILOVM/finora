import { useState, useSyncExternalStore } from 'react';
import { Glyph } from '@/components/Glyph';
import { Switch } from '@/components/Switch';
import { getDeferredPrompt, runNativePrompt, subscribeInstall } from '@/install/installEvent';
import type { Wants } from './onboardingLogic';
import { WizardFrame } from './WizardFrame';

/** Уже открыто как установленное приложение (иконка на экране). */
export function isInstalledApp(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function Row({ icon, color, title, text, control, extra }: { icon: string; color: string; title: string; text: string; control: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <li className="rounded-3xl border border-border/70 bg-surface/85 px-3 py-1.5 shadow-card">
      <div className="flex items-center gap-3">
        <Glyph value={icon} color={color} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{title}</p>
          <p className="text-sm text-muted">{text}</p>
        </div>
        {control}
      </div>
      {extra}
    </li>
  );
}

/** Шаг 4: необязательные включения. Ничего не включается само: переключатель лишь запоминает «хочу», настройка — в Настройках. */
export function ExtrasStep({ wants, onChange, onBack, onNext }: { wants: Wants; onChange: (w: Wants) => void; onBack: () => void; onNext: () => void }) {
  const installed = isInstalledApp();
  const nativeReady = useSyncExternalStore(subscribeInstall, () => getDeferredPrompt() !== null, () => false);
  const [installNote, setInstallNote] = useState<string | null>(null);

  const setInstall = async (v: boolean) => {
    onChange({ ...wants, install: v });
    setInstallNote(null);
    if (!v) return;
    if (nativeReady) {
      const outcome = await runNativePrompt();
      if (outcome !== 'accepted') onChange({ ...wants, install: false });
    } else {
      setInstallNote('В Safari нажмите «Поделиться» и выберите «На экран Домой». В других браузерах — меню «Установить приложение».');
    }
  };

  return (
    <WizardFrame
      step="extras"
      title="Ещё кое-что"
      lead="Необязательно: всё можно включить позже."
      onBack={onBack}
      onNext={onNext}
    >
      <ul className="flex flex-col gap-2">
        <Row
          icon="i:calendar"
          color="#ea580c"
          title="Напоминания"
          text="О платежах и долгах"
          control={<Switch checked={wants.reminders} onChange={(v) => onChange({ ...wants, reminders: v })} label="Напоминания" />}
        />
        <Row
          icon="i:lock"
          color="#7c3aed"
          title="Замок Face ID"
          text="Закрыть приложение от чужих"
          control={<Switch checked={wants.lock} onChange={(v) => onChange({ ...wants, lock: v })} label="Замок Face ID" />}
        />
        <Row
          icon="i:phone"
          color="#0891b2"
          title="Установить на экран"
          text={installed ? 'Уже установлено' : 'Значок как у обычного приложения'}
          control={installed ? null : <Switch checked={wants.install} onChange={(v) => void setInstall(v)} label="Установить на экран" />}
          extra={installNote && <p className="mt-2 text-sm text-muted">{installNote}</p>}
        />
      </ul>
      {(wants.reminders || wants.lock) && (
        <p className="text-sm text-muted">Эти настройки включаются в «Настройки»: мы подскажем, где, на последнем шаге.</p>
      )}
    </WizardFrame>
  );
}
