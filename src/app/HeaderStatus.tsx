import { OnlineBadge } from '@/components/OnlineBadge';
import { SyncBadge } from '@/components/SyncBadge';
import { useSyncEnabled, useSyncStatus } from '@/sync/syncContext';
import { LocalOnlyBadge } from './LocalOnly';

/** Индикаторы в шапке: полный статус синхронизации (или «Только на устройстве») и «Офлайн». */
export function HeaderStatus() {
  const enabled = useSyncEnabled();
  const status = useSyncStatus();
  return (
    <>
      {enabled ? <SyncBadge {...status} /> : <LocalOnlyBadge />}
      <OnlineBadge hideWhenOnline />
    </>
  );
}
