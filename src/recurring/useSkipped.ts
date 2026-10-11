import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '@/db';
import type { IsoDate, LocalRow, RecurringRule, Transaction } from '@/domain/types';
import { addDays } from '@/lib/dates';

/** За сколько последних дней показываем пропущенные платежи. */
export const SKIPPED_DAYS = 90;
/** Сколько пропущенных показываем (самые свежие). */
export const SKIPPED_MAX = 30;

export interface SkippedItem {
  tx: LocalRow<Transaction>;
  /** true — «Пропустить» (строка создана сразу удалённой); false — операцию провели и потом удалили. */
  skipped: boolean;
}

/**
 * Строка создана «пропуском» (transactions.skipOccurrence): её создали сразу удалённой и после этого не правили, поэтому метка
 * последней правки равна метке создания. Метку удаления для этого не берём: сервер при приёме зажимает метки создания и правки
 * до «сейчас + 5 минут», а метку удаления не трогает — у телефона с убежавшими вперёд часами они расходятся, и пропуск стал бы
 * «Удалён из операций». Операция, которую провели и потом удалили, правилась позже создания (метки разные).
 */
export const wasSkipped = (tx: Pick<Transaction, 'createdAt' | 'clientUpdatedAt' | 'deletedAt'>): boolean =>
  tx.deletedAt !== null && Date.parse(tx.clientUpdatedAt) === Date.parse(tx.createdAt);

/**
 * Пропущенные (и удалённые после проведения) платежи по живым правилам за последние SKIPPED_DAYS дней, свежие первыми.
 * Их можно «вернуть»: это transactions.restore той же операции (id тот же), и платёж записывается в операции.
 * Правило к строке подбирает экран по tx.recurringRuleId (так название не устаревает после правки правила).
 */
export function useSkipped(rules: readonly LocalRow<RecurringRule>[], today: IsoDate): SkippedItem[] | undefined {
  const store = useStore();
  const ids = rules.filter((r) => r.deletedAt === null && r.archivedAt === null).map((r) => r.id);
  const key = ids.join(',');
  const since = addDays(today, -SKIPPED_DAYS);
  return useLiveQuery(async () => {
    const rows = await store.db.transactions
      .where('recurringRuleId')
      .anyOf(key === '' ? [] : key.split(','))
      .filter((t) => t.deletedAt !== null && t.occurredOn >= since)
      .toArray();
    return rows
      .sort((a, b) => (a.occurredOn !== b.occurredOn ? (a.occurredOn < b.occurredOn ? 1 : -1) : a.id < b.id ? -1 : 1))
      .slice(0, SKIPPED_MAX)
      .map((tx): SkippedItem => ({ tx, skipped: wasSkipped(tx) }));
  }, [store, key, since]);
}
