import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { isStandalone } from '@/components/InstallHint';
import { Sheet } from '@/components/Sheet';
import { readMemory, rememberDismissed, shouldShowInstallPrompt } from './frequency';
import { getDeferredPrompt, runNativePrompt, subscribeInstall } from './installEvent';
import { detectInstallMode, type InstallMode } from './platform';
import { setInstallPromptOpen } from './promptOpen';

/** Пауза после входа: приложение успело нарисоваться, человек увидел «Главную». */
export const SHOW_DELAY_MS = 1500;
const RETRY_MS = 1000;

/** Один раз за загрузку страницы (и когда localStorage недоступен). */
let shownThisSession = false;
/** Только для тестов. */
export const __resetShownThisSession = (): void => {
  shownThisSession = false;
};

function currentMode(): InstallMode {
  return detectInstallMode({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    hasNativePrompt: getDeferredPrompt() !== null,
  });
}

/** Поверх приложения уже что-то есть: заслонка замка или другое окно — не лезем. */
function somethingOnTop(): boolean {
  return document.querySelector('[data-lock-cover], [role="dialog"], [role="alertdialog"]') !== null;
}

const SHARE_STEPS: { icon: IconName; text: string }[] = [
  { icon: 'upload', text: 'Нажмите «Поделиться» (квадрат со стрелкой) внизу экрана' },
  { icon: 'plus', text: 'Прокрутите и выберите «На экран Домой»' },
  { icon: 'check', text: 'Нажмите «Добавить»' },
];

function Why() {
  return (
    <p className="text-sm text-muted">
      Только из установленного приложения работают уведомления, а замок Face ID надёжнее. Заодно Finora открывается
      сразу, как обычное приложение.
    </p>
  );
}

/**
 * Окно «Установить Finora на экран телефона». Рисуется внутри уже вошедшего приложения (не поверх входа и не поверх
 * заслонки замка: её z-index 1000, а у окна 50, и пока заслонка есть, окно ждёт).
 */
export function InstallPrompt({ delayMs = SHOW_DELAY_MS }: { delayMs?: number }) {
  const [mode, setMode] = useState<InstallMode | null>(null);
  // событие beforeinstallprompt может прийти позже таймера — слушаем
  const nativeReady = useSyncExternalStore(subscribeInstall, () => getDeferredPrompt() !== null, () => false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== null || shownThisSession) return;
    let timer: ReturnType<typeof setTimeout>;
    const tryShow = () => {
      if (shownThisSession) return;
      const m = currentMode();
      if (m === 'none' || !shouldShowInstallPrompt(readMemory(), Date.now(), shownThisSession)) return; // 'none' → ждём событие (nativeReady)
      if (somethingOnTop() || document.visibilityState === 'hidden') {
        timer = setTimeout(tryShow, RETRY_MS);
        return;
      }
      shownThisSession = true;
      setMode(m);
    };
    timer = setTimeout(tryShow, delayMs);
    return () => clearTimeout(timer);
  }, [mode, delayMs, nativeReady]);

  useEffect(() => {
    setInstallPromptOpen(mode !== null);
    return () => setInstallPromptOpen(false);
  }, [mode]);

  const later = useCallback(() => {
    rememberDismissed(Date.now());
    setMode(null);
  }, []);

  const install = useCallback(async () => {
    setBusy(true);
    const outcome = await runNativePrompt();
    setBusy(false);
    if (outcome !== 'accepted') rememberDismissed(Date.now()); // отказ в системном окне = «Не сейчас»
    setMode(null); // принял — дальше скажет appinstalled
  }, []);

  if (mode === null) return null;

  return (
    <Sheet
      open
      onClose={later}
      title="Установить Finora на экран телефона"
      footer={
        mode === 'native' ? (
          <div className="flex flex-col gap-2">
            <Button fullWidth size="lg" onClick={install} disabled={busy} data-autofocus>
              Установить
            </Button>
            <Button fullWidth variant="ghost" onClick={later} disabled={busy}>
              Не сейчас
            </Button>
          </div>
        ) : (
          <Button fullWidth variant="secondary" onClick={later}>
            Не сейчас
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {mode === 'native' && (
          <p className="text-base">Значок Finora появится на экране телефона, как у обычного приложения.</p>
        )}
        {mode === 'ios-safari' && (
          <ol className="flex flex-col gap-3" aria-label="Как установить">
            {SHARE_STEPS.map((s, i) => (
              <li key={s.text} className="flex items-center gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
                  aria-hidden="true"
                >
                  <Icon name={s.icon} size={24} />
                </span>
                <span className="min-w-0 text-base">
                  <b>{i + 1}.</b> {s.text}
                </span>
              </li>
            ))}
          </ol>
        )}
        {mode === 'ios-other' && (
          <p className="text-base">
            <b>Откройте эту ссылку в Safari.</b> В этом браузере на iPhone установить приложение нельзя: в Safari нажмите
            «Поделиться» и выберите «На экран Домой».
          </p>
        )}
        <Why />
      </div>
    </Sheet>
  );
}
