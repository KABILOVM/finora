import { OnlineBadge, useOnline } from '@/components/OnlineBadge';
import { SyncBadge } from '@/components/SyncBadge';
import { useSyncEnabled, useSyncStatus } from '@/sync/syncContext';
import { LocalOnlyBadge } from './LocalOnly';

/**
 * Индикаторы в шапке: полный статус синхронизации (или «Только на устройстве») и «Офлайн».
 * Если движок сам пишет «Без сети…», отдельное «Офлайн» рядом не нужно: два одинаковых сигнала в шапке — лишний шум.
 */
export function HeaderStatus() {
  const enabled = useSyncEnabled();
  const status = useSyncStatus();
  const online = useOnline();
  const syncSaysOffline = enabled && status.phase === 'offline';
  return (
    <>
      {enabled ? <SyncBadge {...status} /> : <LocalOnlyBadge />}
      {!online && !syncSaysOffline && <OnlineBadge />}
    </>
  );
}
