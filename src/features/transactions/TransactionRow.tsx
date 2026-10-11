import { Badge } from '@/components/Badge';
import { ListRow } from '@/components/ListRow';
import { MoneyText } from '@/components/MoneyText';
import type { Category, LocalRow, Transaction, Wallet } from '@/domain/types';
import { describeTx } from './txDisplay';

export interface TransactionRowProps {
  tx: LocalRow<Transaction>;
  wallets: ReadonlyMap<string, Wallet>;
  categories: ReadonlyMap<string, Category>;
  /** Метку «ждёт отправки» показываем, только если синхронизация вообще включена: в локальном режиме отправлять нечего. */
  syncEnabled: boolean;
  onOpen: (id: string) => void;
}

/** Строка операции: значок категории, название, кошелёк и заметка, сумма цветом, метки синхронизации. */
export function TransactionRow({ tx, wallets, categories, syncEnabled, onOpen }: TransactionRowProps) {
  const v = describeTx(tx, wallets, categories);
  const rejected = tx.syncError !== null;
  const waiting = !rejected && syncEnabled && tx.dirty === 1;
  return (
    <ListRow
      onClick={() => onOpen(tx.id)}
      leading={
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-xl"
          style={v.color ? { backgroundColor: `${v.color}26` } : undefined}
        >
          {v.icon}
        </span>
      }
      title={v.title}
      subtitle={v.subtitle || undefined}
      trailing={
        <div className="flex flex-col items-end gap-0.5">
          <MoneyText
            minor={v.signedMinor}
            currency={v.currency}
            tone={v.tone}
            sign={v.tone === 'income' ? 'always' : 'auto'}
            className="text-base font-semibold"
          />
          {v.second && <span className="money text-xs text-muted">{v.second}</span>}
          {rejected && <Badge tone="danger">не принято сервером</Badge>}
          {waiting && <span className="text-xs text-muted">ждёт отправки</span>}
        </div>
      }
    />
  );
}
