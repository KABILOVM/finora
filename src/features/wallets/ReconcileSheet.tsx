import { useMemo } from 'react';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useBalances, useTransactions } from '@/db';
import type { LocalRow, Wallet } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { reconcileWallet, type Reconciliation } from './reconcile';

function Line({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <div className="min-w-0">
        <div>{label}</div>
        {count !== undefined && (
          <div className="text-sm text-muted">
            {count} {pluralRu(count, 'операция', 'операции', 'операций')}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right text-lg font-semibold">{children}</div>
    </div>
  );
}

/** «Сверка»: из чего складывается остаток кошелька. Чтобы человек мог сам проверить цифру. */
export function ReconcileSheet({ wallet, onClose }: { wallet: LocalRow<Wallet>; onClose: () => void }) {
  const txs = useTransactions({ walletId: wallet.id });
  const balances = useBalances();

  const result = useMemo<Reconciliation | 'overflow' | null>(() => {
    if (!txs) return null;
    try {
      return reconcileWallet(wallet, txs);
    } catch (e) {
      if (e instanceof RangeError) return 'overflow';
      throw e;
    }
  }, [txs, wallet]);

  const c = wallet.currency;
  const shown = balances?.get(wallet.id);

  return (
    <Sheet open onClose={onClose} title={`Сверка: ${wallet.name}`}>
      {result === null && <p className="py-6 text-center text-muted">Считаем…</p>}
      {result === 'overflow' && (
        <p role="alert" className="py-4 font-medium text-danger">
          Суммы слишком велики для расчёта. Проверьте операции этого кошелька.
        </p>
      )}
      {result !== null && result !== 'overflow' && (
        <div>
          <p className="mb-2 text-muted">
            Остаток = начальный остаток + доходы − расходы + переводы на кошелёк − переводы с кошелька. Удалённые операции не считаются.
          </p>
          <div className="divide-y divide-border">
            <Line label="Начальный остаток">
              <MoneyText minor={result.openingMinor} currency={c} tone="none" />
            </Line>
            <Line label="+ Доходы" count={result.incomeCount}>
              <MoneyText minor={result.incomeMinor} currency={c} tone="income" sign="always" />
            </Line>
            <Line label="− Расходы" count={result.expenseCount}>
              <MoneyText minor={-result.expenseMinor} currency={c} tone="expense" />
            </Line>
            <Line label="+ Переводы на кошелёк" count={result.transferInCount}>
              <MoneyText minor={result.transferInMinor} currency={c} tone="income" sign="always" />
            </Line>
            <Line label="− Переводы с кошелька" count={result.transferOutCount}>
              <MoneyText minor={-result.transferOutMinor} currency={c} tone="expense" />
            </Line>
            <Line label="= Остаток">
              <MoneyText minor={result.totalMinor} currency={c} tone="none" />
            </Line>
          </div>
          {shown !== undefined && (
            <Notice tone={shown === result.totalMinor ? 'success' : 'danger'} role="status" className="mt-3 font-medium">
              {shown === result.totalMinor
                ? 'Совпадает с остатком на экране «Кошельки».'
                : 'Не совпадает с остатком на экране «Кошельки», так быть не должно. Записи на месте: сохраните резервную копию (Настройки → «Резервная копия») и перезапустите приложение — остатки пересчитаются заново.'}
            </Notice>
          )}
          {result.skipped > 0 && (
            <Notice tone="warning" role="alert" className="mt-3">
              Пропущено операций с некорректной суммой: {result.skipped}. В остаток они не входят. Найти их можно в «Операциях»: период
              «Всё время», в «Фильтрах» — этот кошелёк. Откройте такую операцию и введите верную сумму или удалите её.
            </Notice>
          )}
        </div>
      )}
    </Sheet>
  );
}
