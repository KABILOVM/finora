import { useState } from 'react';
import { Button } from '@/components/Button';
import { useOnline } from '@/components/OnlineBadge';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { cn } from '@/lib/cn';
import { useSyncEnabled, useSyncNow, useSyncStatus } from '@/sync/syncContext';
import { useRejectedItems } from './rejected';
import { SettingsSection } from './SettingsSection';
import { describeSync, formatDateTime, type SyncTone } from './syncText';

const TONE_CLASS: Record<SyncTone, string> = {
  ok: 'text-income',
  info: 'text-text',
  warn: 'text-warning',
  bad: 'text-danger',
};

/** Синхронизация: честный статус, «Синхронизировать сейчас», записи, которые не принял сервер. */
export function SyncSection() {
  const enabled = useSyncEnabled();
  const status = useSyncStatus();
  const syncNow = useSyncNow();
  const online = useOnline();
  const store = useStore();
  const toast = useToast();
  const rejected = useRejectedItems();
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (!enabled) {
    return (
      <SettingsSection title="Синхронизация">
        <p>
          <strong className="font-semibold">Облако не подключено.</strong> Данные хранятся только на этом устройстве и никуда не
          отправляются. Делайте резервную копию (раздел ниже).
        </p>
      </SettingsSection>
    );
  }

  const d = describeSync(status);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await syncNow();
    } catch (e) {
      console.error('Синхронизация не удалась:', e);
      toast.error('Не удалось запустить синхронизацию. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const n = await store.sync.retryQuarantined();
      toast.success(n > 0 ? 'Записи отправлены на повторную попытку' : 'Нечего повторять');
      await syncNow();
    } catch (e) {
      console.error('Не удалось повторить отправку:', e);
      toast.error('Не удалось повторить отправку. Попробуйте ещё раз.');
    } finally {
      setRetrying(false);
    }
  };

  const working = busy || status.phase === 'syncing';

  return (
    <SettingsSection title="Синхронизация">
      <div role="status" aria-live="polite">
        <p className={cn('text-lg font-semibold', TONE_CLASS[d.tone])}>{d.headline}</p>
        {d.detail && <p className="mt-1 text-muted">{d.detail}</p>}
      </div>
      <p className="text-muted">
        Последняя успешная синхронизация: {status.lastSyncedAt ? formatDateTime(status.lastSyncedAt) : 'ещё не было'}
        {!online && ' · сейчас нет сети'}
      </p>
      <Button variant="secondary" icon="refresh" loading={working} onClick={() => void run()}>
        Синхронизировать сейчас
      </Button>

      {rejected !== undefined && rejected.length > 0 && (
        <div className="mt-2 border-t border-border pt-3">
          <h3 className="font-semibold text-danger">Сервер не принял записи: {rejected.length}</h3>
          <p className="mt-1 text-sm text-muted">
            Они остаются на этом устройстве, остальные данные отправляются как обычно. Если «Повторить» не помогает, запишите причину и
            сообщите владельцу приложения.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {rejected.map((r) => (
              <li key={`${r.table}:${r.id}`} className="rounded-xl bg-danger/5 p-3">
                <div className="font-medium">{r.label}</div>
                <div className="break-words text-sm text-muted">Причина: {r.error || 'не указана'}</div>
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="secondary" loading={retrying} onClick={() => void retry()}>
            Повторить
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
