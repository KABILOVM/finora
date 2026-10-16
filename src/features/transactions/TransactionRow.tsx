import { Glyph } from '@/components/Glyph';
import { Badge } from '@/components/Badge';
import { ListRow } from '@/components/ListRow';
import { MoneyText } from '@/components/MoneyText';
import type { Category, LocalRow, Transaction, Wallet } from '@/domain/types';
import { TxTags } from '@/features/debts/TxTags';
import { describeTx } from './txDisplay';

export interface TransactionRowProps {
  tx: LocalRow<Transaction>;
  wallets: ReadonlyMap<string, Wallet>;
  categories: ReadonlyMap<string, Category>;
  /** Метку «ждёт отправки» показываем, только если синхронизация вообще включена: в локальном режиме отправлять нечего. */
  syncEnabled: boolean;
  onOpen: (id: string) => void;
  /** true — суммы скрыты (режим «скрыть суммы» на «Главной»). */
  maskAmounts?: boolean;
}

/**
 * Строка операции: значок категории, название, кошелёк и заметка, сумма цветом, метки синхронизации.
 * Операция по долгу несёт метку «Долг: <имя>», операция по расписанию — «Регулярный платёж».
 */
export function TransactionRow({ tx, wallets, categories, syncEnabled, onOpen, maskAmounts = false }: TransactionRowProps) {
  const v = describeTx(tx, wallets, categories);
  const rejected = tx.syncError !== null;
  const waiting = !rejected && syncEnabled && tx.dirty === 1;
  const linked = Boolean(tx.debtId) || Boolean(tx.recurringRuleId);
  // у движения денег по долгу категории нет по замыслу: «Без категории» звучало бы как недоделка
  const title = tx.debtId && tx.kind !== 'transfer' && tx.categoryId === null ? 'Долг' : v.title;
  return (
    <ListRow
      onClick={() => onOpen(tx.id)}
      leading={
        <Glyph value={v.icon} color={v.color ?? undefined} size={40} />
      }
      title={title}
      subtitle={
        linked ? (
          <>
            {v.subtitle && <span className="block truncate">{v.subtitle}</span>}
            <TxTags tx={tx} />
          </>
        ) : (
          v.subtitle || undefined
        )
      }
      trailing={
        <div className="flex flex-col items-end gap-0.5">
          {maskAmounts ? (
            <span className="money text-base font-semibold text-muted" aria-label="Сумма скрыта">
              ••••
            </span>
          ) : (
            <MoneyText
              minor={v.signedMinor}
              currency={v.currency}
              tone={v.tone}
              sign={v.tone === 'income' ? 'always' : 'auto'}
              className="text-base font-semibold"
            />
          )}
          {v.second && !maskAmounts && <span className="money text-xs text-muted">{v.second}</span>}
          {rejected && <Badge tone="danger">не принято сервером</Badge>}
          {waiting && <span className="text-xs text-muted">ждёт отправки</span>}
        </div>
      }
    />
  );
}
