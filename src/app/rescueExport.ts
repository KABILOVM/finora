import { LOCAL_USER_ID } from '@/auth/config';
import { exportBackup, openStore } from '@/db';
import { downloadTextFile } from '@/features/settings/download';
import { todayLocal } from '@/lib/dates';
import { readLock } from '@/lock/lockStore';

/**
 * Копия данных с экрана «Что-то пошло не так» (локальный режим): приложение упало, до Настроек не дойти, а записи есть
 * только на этом устройстве. Хранилище открывается заново, в обход упавшего приложения, только для чтения.
 * С включённым замком копию не предлагаем: экран сбоя заменил заслонку, и файл достался бы без Face ID.
 */
export function canRescueExport(): boolean {
  return readLock(LOCAL_USER_ID).kind === 'off';
}

export async function exportLocalBackup(): Promise<void> {
  if (!canRescueExport()) throw new Error('Включён замок приложения: копию можно сохранить в Настройках после разблокировки');
  const store = await openStore(LOCAL_USER_ID);
  try {
    const file = await exportBackup(store);
    downloadTextFile(`sumoima-backup-${todayLocal()}.json`, 'application/json', JSON.stringify(file, null, 2));
  } finally {
    store.close();
  }
}
