import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import type { TxKind } from '@/domain/types';
import { formatDayLabel } from '@/lib/dates';
import type { SyncTableName } from '@/sync/tables';

export interface RejectedItem {
  table: SyncTableName;
  id: string;
  /** Что это за запись, по-человечески. */
  label: string;
  /** Текст ошибки от сервера (как есть). */
  error: string;
}

const KIND_LABEL: Record<TxKind, string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

/** Записи, которые сервер отверг (карантин): живой список, обновляется сам. */
export function useRejectedItems(): RejectedItem[] | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const { db } = store;
    const [settings, wallets, categories, txs] = await Promise.all([
      db.settings.filter((r) => r.syncError !== null && r.syncError !== undefined).toArray(),
      db.wallets.toArray(),
      db.categories.filter((r) => r.syncError !== null && r.syncError !== undefined).toArray(),
      db.transactions.filter((r) => r.syncError !== null && r.syncError !== undefined).toArray(),
    ]);
    const walletById = new Map(wallets.map((w) => [w.id, w]));
    const out: RejectedItem[] = [];
    for (const r of settings) out.push({ table: 'settings', id: r.id, label: 'Настройки', error: r.syncError ?? '' });
    for (const r of wallets) {
      if (r.syncError) out.push({ table: 'wallets', id: r.id, label: `Кошелёк «${r.name}»`, error: r.syncError });
    }
    for (const r of categories) out.push({ table: 'categories', id: r.id, label: `Категория «${r.name}»`, error: r.syncError ?? '' });
    for (const r of txs) {
      const w = walletById.get(r.walletId);
      const amount = w ? formatMinor(r.amountMinor, w.currency) : String(r.amountMinor);
      out.push({
        table: 'transactions',
        id: r.id,
        label: `${KIND_LABEL[r.kind]} ${amount}, ${formatDayLabel(r.occurredOn)}${r.deletedAt ? ' (удалена)' : ''}`,
        error: r.syncError ?? '',
      });
    }
    return out;
  }, [store]);
}
