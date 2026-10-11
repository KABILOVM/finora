import { createContext, useContext } from 'react';
import { LOCAL_USER_ID } from '@/auth/config';
import { exportBackup, importBackup, type ImportResult, type Store } from '@/db';
import { withoutSettings } from '@/features/settings/backupAccount';
import type { SessionDeps } from './deps';

/**
 * Данные локального режима (учёт без входа) на устройстве, где потом подключили облако.
 * Приложение открывает базу вошедшего пользователя, а локальная остаётся рядом нетронутой, но невидимой.
 * Здесь: сколько там записей (чтобы сказать об этом человеку) и перенос их в аккаунт.
 */

/** Ключ в store.sync.getMeta/setMeta: true, когда человек перенёс записи или отказался от переноса — больше не спрашиваем. */
export const META_LOCAL_DATA_HANDLED = 'localModeHandled';

const LocalDataContext = createContext<{ count: number }>({ count: 0 });
export const LocalDataProvider = LocalDataContext.Provider;
/** Сколько записей локального режима предложить перенести (0 — нечего предлагать). */
export const useLocalData = (): { count: number } => useContext(LocalDataContext);

/** Сколько записей предложить перенести этому аккаунту на этом устройстве. Никогда не бросает: это подсказка, а не условие запуска. */
export async function localDataToOffer(deps: SessionDeps, store: Store): Promise<number> {
  try {
    if (!deps.countLocalModeData) return 0;
    if ((await store.sync.getMeta(META_LOCAL_DATA_HANDLED)) === true) return 0;
    return await deps.countLocalModeData();
  } catch {
    return 0;
  }
}

/** Запоминает, что вопрос закрыт. Не вышло — не страшно: спросим снова при следующем запуске. */
export async function markLocalDataHandled(store: Store): Promise<void> {
  try {
    await store.sync.setMeta(META_LOCAL_DATA_HANDLED, true);
  } catch {
    // спросим снова
  }
}

/**
 * Переносит записи локального режима в аккаунт: копия базы локального режима загружается как копия «из другого аккаунта»
 * (у записей новые id, производные от этого аккаунта; стартовые кошелёк и категории совпадают со стартовыми аккаунта).
 * Локальная база не удаляется и не меняется. Повтор безопасен: те же записи не плодятся. Ошибка — ничего не загружено.
 */
export async function transferLocalData(deps: SessionDeps, store: Store): Promise<ImportResult> {
  const local = await deps.openStore(LOCAL_USER_ID);
  try {
    const backup = await exportBackup(local);
    return await importBackup(store, withoutSettings(backup), { sourceUserId: LOCAL_USER_ID });
  } finally {
    local.close();
  }
}
