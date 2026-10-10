import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './Button';

/**
 * Новая версия приложения скачана и ждёт. Применяется ТОЛЬКО после нажатия «Обновить»
 * (registerType: 'prompt' в vite.config.ts) — чтобы страница не перезагрузилась посреди ввода операции.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (e) => console.error('Не удалось зарегистрировать service worker:', e),
  });
  const [busy, setBusy] = useState(false);

  if (!needRefresh) return null;

  const update = async () => {
    setBusy(true);
    try {
      await updateServiceWorker(true);
    } catch (e) {
      console.error('Не удалось обновить приложение:', e);
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[55] mx-auto flex max-w-md animate-pop-in items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-float"
    >
      <div className="min-w-0 flex-1 pl-1">
        <p className="font-semibold">Доступна новая версия</p>
        <p className="text-sm text-muted">Приложение перезагрузится, записи не потеряются.</p>
      </div>
      <Button variant="ghost" onClick={() => setNeedRefresh(false)} disabled={busy}>
        Позже
      </Button>
      <Button onClick={update} loading={busy}>
        Обновить
      </Button>
    </div>
  );
}
