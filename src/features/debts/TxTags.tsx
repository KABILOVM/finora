import { useLiveQuery } from 'dexie-react-hooks';
import { Badge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { useOptionalStore } from '@/db';
import type { Transaction } from '@/domain/types';
import { txTags } from '@/features/transactions/txDisplay';

/**
 * Имя долга по id. Включая архивные и закрытые: у старой операции метка не должна пропадать. Удалённый долг — null.
 * undefined — ещё читается; null — долга нет (или нет хранилища).
 */
export function useDebtName(debtId: string | null | undefined): string | null | undefined {
  const store = useOptionalStore();
  return useLiveQuery(
    async () => {
      const d = store && debtId ? await store.db.debts.get(debtId) : undefined;
      return d && d.deletedAt === null ? d.counterparty : null; // удалённый долг — как неизвестный: просто «Долг»
    },
    [store, debtId],
  );
}

type Linked = Pick<Transaction, 'debtId'> & { recurringRuleId?: Transaction['recurringRuleId'] | undefined };

/**
 * Метки под строкой операции: «Долг: <имя>» и «Регулярный платёж». Имя долга читается отдельным запросом ТОЛЬКО у операций
 * по долгам (их мало), поэтому остальные строки списка ничего лишнего не спрашивают.
 */
export function TxTags({ tx }: { tx: Linked }) {
  const name = useDebtName(tx.debtId);
  const tags = txTags(tx, name);
  if (tags.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1" data-testid="tx-tags">
      {tags.map((t) => (
        <Badge key={t.key} tone={t.key === 'debt' ? 'brand' : 'neutral'} className="max-w-full">
          <Icon name={t.key === 'debt' ? 'banknote' : 'repeat'} size={12} className="shrink-0" />
          <span className="truncate">{t.text}</span>
        </Badge>
      ))}
    </span>
  );
}
