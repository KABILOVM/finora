import type { Store } from '@/db';

/**
 * Что записал один запуск импорта: по этому списку его можно отменить. Только то, что создано именно этим запуском (id операций,
 * записанных сейчас, и кошельков и категорий, которых до него не было).
 */
export interface ImportJournal {
  txIds: string[];
  walletIds: string[];
  categoryIds: string[];
}

export interface UndoResult {
  removedTxs: number;
  archivedWallets: number;
  archivedCategories: number;
  /** Не удалось убрать (операций) — остались на месте. */
  failed: number;
  /** Кошельки и категории, которые остались, потому что в них уже есть ваши операции. */
  keptInUse: number;
}

const CHUNK = 250;

/**
 * Отмена импорта: операции этого запуска уходят в «удалённые» (как при ручном удалении, синхронизация это подхватит), созданные им
 * кошельки и категории — в архив, если в них не осталось других живых операций (вы могли успеть внести свои). Операции, которые вы
 * после импорта правили или удаляли сами, трогаются так же (правка не снимает операцию с отмены), уже удалённые пропускаются.
 * Повторная загрузка того же файла отменённые строки не вернёт (как и удалённые вручную): для них действует «уже есть, но удалена».
 */
export async function undoImport(store: Store, journal: ImportJournal): Promise<UndoResult> {
  const result: UndoResult = { removedTxs: 0, archivedWallets: 0, archivedCategories: 0, failed: 0, keptInUse: 0 };
  for (let i = 0; i < journal.txIds.length; i += CHUNK) {
    const chunk = journal.txIds.slice(i, i + CHUNK);
    try {
      result.removedTxs += await store.db.transaction('rw', store.db.tables, async () => {
        let n = 0;
        for (const id of chunk) {
          const tx = await store.db.transactions.get(id);
          if (!tx || tx.deletedAt !== null) continue;
          await store.transactions.softDelete(id);
          n++;
        }
        return n;
      });
    } catch (e) {
      console.error('Отмена импорта: порция не прошла, пробуем по одной', e);
      for (const id of chunk) {
        try {
          const tx = await store.db.transactions.get(id);
          if (!tx || tx.deletedAt !== null) continue;
          await store.transactions.softDelete(id);
          result.removedTxs++;
        } catch {
          result.failed++;
        }
      }
    }
  }

  const live = await store.db.transactions.filter((t) => t.deletedAt === null).toArray();
  const usedWallets = new Set(live.flatMap((t) => [t.walletId, t.toWalletId].filter((x): x is string => typeof x === 'string')));
  const usedCategories = new Set(live.map((t) => t.categoryId).filter((x): x is string => typeof x === 'string'));
  for (const id of journal.walletIds) {
    if (usedWallets.has(id)) result.keptInUse++;
    else {
      try {
        await store.wallets.archive(id);
        result.archivedWallets++;
      } catch (e) {
        console.error('Отмена импорта: кошелёк не убран в архив', e);
      }
    }
  }
  for (const id of journal.categoryIds) {
    if (usedCategories.has(id)) result.keptInUse++;
    else {
      try {
        await store.categories.archive(id);
        result.archivedCategories++;
      } catch (e) {
        console.error('Отмена импорта: категория не убрана в архив', e);
      }
    }
  }
  return result;
}
