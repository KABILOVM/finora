import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconButton } from '@/components/IconButton';
import { MoneyText } from '@/components/MoneyText';
import type { DebtIssue, DebtPayment } from '@/domain/debts';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, LocalRow, Transaction, UUID, Wallet } from '@/domain/types';
import { MISSING_WALLET } from '@/features/transactions/txDisplay';
import { formatDayLabel } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { ruDateShort } from './debtText';

/** Строка списка: кнопка на всю ширину (открывает операцию), а если открывать нечем — просто блок. */
function Row({ label, onOpen, className, children }: { label: string; onOpen?: () => void; className?: string; children: ReactNode }) {
  const base = cn('flex min-h-[56px] min-w-0 flex-1 items-center gap-2 py-1 text-left', className);
  if (!onOpen) return <div className={base}>{children}</div>;
  // имя кнопки — видимое содержимое (дата, кошелёк, сумма) с пояснением «что будет» впереди, а не подмена его одной подписью
  return (
    <button type="button" onClick={onOpen} className={cn(base, 'transition-colors hover:bg-surface-2 active:bg-border/60')}>
      <span className="sr-only">{label}: </span>
      {children}
    </button>
  );
}

export interface PaymentsListProps {
  /** Платежи по порядку: старые первыми (как отдаёт computeDebtState); на экране новые сверху. */
  payments: readonly DebtPayment[];
  currency: CurrencyCode;
  txs: ReadonlyMap<UUID, LocalRow<Transaction>>;
  wallets: ReadonlyMap<UUID, LocalRow<Wallet>>;
  today: IsoDate;
  /** Нельзя менять (долг в архиве): кнопок удаления нет. */
  readOnly?: boolean;
  onDelete: (payment: DebtPayment) => void;
  /** Открыть операцию платежа (правка даты, суммы, заметки). */
  onOpen?: (txId: UUID) => void;
}

/** Платежи по долгу: дата, кошелёк, заметка, сумма; строка открывает операцию, кнопка «Удалить» — мягкое удаление с подтверждением и «Отменить». */
export function PaymentsList({ payments, currency, txs, wallets, today, readOnly = false, onDelete, onOpen }: PaymentsListProps) {
  const rows = [...payments].reverse();
  return (
    <section aria-labelledby="debt-payments-title">
      <h2 id="debt-payments-title" className="mb-2 mt-6 text-lg font-bold">
        Платежи
      </h2>
      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">Платежей пока нет. Когда деньги вернутся, нажмите «Добавить платёж».</p>
        </Card>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border" aria-label="Платежи по долгу">
            {rows.map((p) => {
              const tx = txs.get(p.txId);
              const wallet = tx ? wallets.get(tx.walletId) : undefined;
              const note = tx?.note.trim() ?? '';
              const sub = [wallet?.name ?? MISSING_WALLET, note].filter((x) => x !== '').join(' · ');
              const label = `${ruDateShort(p.occurredOn)} на ${formatMinor(p.amountMinor, currency)}`;
              return (
                <li key={p.txId} className="flex items-center pr-2">
                  <Row label="Открыть платёж" onOpen={onOpen ? () => onOpen(p.txId) : undefined} className="pl-4">
                    <div className="min-w-0 flex-1 py-2">
                      <p className="font-medium">{formatDayLabel(p.occurredOn, today)}</p>
                      <p className="truncate text-sm text-muted">{sub}</p>
                    </div>
                    <MoneyText minor={p.amountMinor} currency={currency} tone="none" className="shrink-0 font-semibold" />
                  </Row>
                  {!readOnly && <IconButton icon="trash" variant="danger" label={`Удалить платёж от ${label}`} onClick={() => onDelete(p)} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

export interface EntriesListProps {
  /** Выдачи и пополнения по порядку: старые первыми (как отдаёт computeDebtState). */
  entries: readonly DebtPayment[];
  currency: CurrencyCode;
  txs: ReadonlyMap<UUID, LocalRow<Transaction>>;
  wallets: ReadonlyMap<UUID, LocalRow<Wallet>>;
  today: IsoDate;
  /** Открыть операцию (правка даты, суммы, заметки). */
  onOpen?: (txId: UUID) => void;
}

/**
 * «Выдачи и пополнения»: исходная операция и каждое «добавить ещё». Показывается, только когда пополнения были (операций две и
 * больше): у обычного долга с одной выдачей отдельный список ничего не добавил бы. Удалить отсюда нельзя — операции открываются в журнале.
 */
export function EntriesList({ entries, currency, txs, wallets, today, onOpen }: EntriesListProps) {
  if (entries.length < 2) return null;
  const rows = [...entries].reverse();
  return (
    <section aria-labelledby="debt-entries-title">
      <h2 id="debt-entries-title" className="mb-2 mt-6 text-lg font-bold">
        Выдачи и пополнения
      </h2>
      <Card padding="none">
        <ul className="divide-y divide-border" aria-label="Выдачи и пополнения долга">
          {rows.map((e) => {
            const tx = txs.get(e.txId);
            const wallet = tx ? wallets.get(tx.walletId) : undefined;
            const note = tx?.note.trim() ?? '';
            const sub = [wallet?.name ?? MISSING_WALLET, note].filter((x) => x !== '').join(' · ');
            return (
              <li key={e.txId} className="flex items-center pr-4">
                <Row label="Открыть операцию" onOpen={onOpen ? () => onOpen(e.txId) : undefined} className="pl-4">
                  <div className="min-w-0 flex-1 py-2">
                    <p className="font-medium">{formatDayLabel(e.occurredOn, today)}</p>
                    <p className="truncate text-sm text-muted">{sub}</p>
                  </div>
                  <MoneyText minor={e.amountMinor} currency={currency} tone="none" className="shrink-0 font-semibold" />
                </Row>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

export interface IssuesNoticeProps {
  issues: readonly DebtIssue[];
  txs: ReadonlyMap<UUID, LocalRow<Transaction>>;
  wallets: ReadonlyMap<UUID, LocalRow<Wallet>>;
  onOpen: (txId: UUID) => void;
}

/** Честное предупреждение: операции долга, которые не вошли в остаток (другая валюта, неизвестный кошелёк, перевод), и как их поправить. */
export function IssuesNotice({ issues, txs, wallets, onOpen }: IssuesNoticeProps) {
  if (issues.length === 0) return null;
  return (
    <section
      aria-labelledby="debt-issues-title"
      role="alert"
      className="mt-4 rounded-2xl border border-warning/60 bg-warning/10 p-4"
      data-testid="debt-issues"
    >
      <h2 id="debt-issues-title" className="font-bold text-warning">
        Часть операций не вошла в остаток
      </h2>
      <p className="mt-1 text-sm text-text">
        Остаток посчитан без них, чтобы не складывать деньги разных валют. Откройте операцию и исправьте кошелёк.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {issues.map((i) => {
          const tx = txs.get(i.txId);
          const wallet = tx ? wallets.get(tx.walletId) : undefined;
          // сумма без валюты ничего не значит: у неизвестного кошелька её не показываем
          const what = tx
            ? [ruDateShort(tx.occurredOn), wallet?.name ?? MISSING_WALLET, wallet ? formatMinor(tx.amountMinor, wallet.currency) : '']
                .filter((x) => x !== '')
                .join(' · ')
            : 'Операция';
          return (
            <li key={i.txId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{what}</span>
                <span className="block text-muted">{i.message}</span>
              </span>
              <Button variant="secondary" aria-label={`Открыть операцию: ${what}`} onClick={() => onOpen(i.txId)}>
                Открыть
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

