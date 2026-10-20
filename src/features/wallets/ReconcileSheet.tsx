import { useMemo, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { useBalances, useStore, useTransactions } from '@/db';
import { formatMinor } from '@/domain/money';
import type { LocalRow, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { fxSourceOf } from '@/features/transactions/txForm';
import { todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useRates } from '@/rates/hooks';
import { bankDifference, reconcileWallet, type Reconciliation } from './reconcile';

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

/**
 * «Сверить с банком»: человек вводит, сколько на самом деле, видит разницу и одной кнопкой правит начальный остаток кошелька.
 * Операции не меняются и в доходы с расходами разница не попадает; исправление можно отменить.
 */
function BankCheck({ wallet, totalMinor }: { wallet: LocalRow<Wallet>; totalMinor: number }) {
  const store = useStore();
  const toast = useToast();
  const [actual, setActual] = useState<number | null>(null);
  const [negative, setNegative] = useState(false);
  const [busy, setBusy] = useState(false);
  const { getRate } = useRates();
  const c = wallet.currency;

  let diff: number | null = null;
  let tooBig = false;
  if (actual !== null) {
    try {
      diff = bankDifference(actual, negative, totalMinor);
    } catch {
      tooBig = true;
    }
  }

  const fix = async () => {
    if (diff === null || diff === 0 || busy) return;
    const before = wallet.openingBalanceMinor;
    setBusy(true);
    try {
      await store.wallets.update(wallet.id, { openingBalanceMinor: before + diff });
      setActual(null);
      toastWithUndo(toast, 'Остаток исправлен', () => store.wallets.update(wallet.id, { openingBalanceMinor: before }), 'Остаток возвращён');
    } catch (e) {
      toast.error(humanError(e, 'Не удалось исправить остаток. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

  /** «Корректировка остатка» сегодняшним числом: видна в истории, но не доход и не расход. Отменяется. */
  const adjust = async () => {
    if (diff === null || diff === 0 || busy) return;
    setBusy(true);
    try {
      // настройки читаем здесь, а не из хука: нажатие не должно молча пропадать, пока хук ещё загружается
      const settings = await store.settings.get();
      if (!settings) throw new Error('Настройки ещё не загружены. Попробуйте через секунду.');
      let fx: { rate: number; source: string } | undefined;
      if (c !== settings.baseCurrency) {
        const hit = getRate(c, settings.baseCurrency);
        if (!hit) {
          toast.error(`Нет курса ${c} к ${settings.baseCurrency}: задайте его в Настройках → «Курсы валют» или поправьте начальный остаток.`);
          return;
        }
        fx = { rate: hit.rate, source: fxSourceOf(hit) };
      }
      const row = await store.transactions.createAdjustment({ walletId: wallet.id, deltaMinor: diff, occurredOn: todayLocal(), ...(fx ? { fx } : {}) });
      setActual(null);
      toastWithUndo(toast, 'Корректировка записана', () => store.transactions.softDelete(row.id), 'Корректировка отменена');
    } catch (e) {
      toast.error(humanError(e, 'Не удалось записать корректировку. Попробуйте ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Сверить с банком" className="mb-4 rounded-2xl bg-surface-2/70 p-3" data-testid="bank-check">
      <h3 className="font-semibold">Сверить с банком</h3>
      <p className="mb-2 text-sm text-muted">Введите, сколько сейчас на счёте в банке или в кошельке.</p>
      <AmountInput currency={c} value={actual} onChange={setActual} label="Сколько на самом деле" showKeypad={false} compact />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span id="bank-negative">Минус (я должен банку)</span>
        <Switch checked={negative} onChange={setNegative} labelledBy="bank-negative" />
      </div>
      {tooBig && (
        <Notice tone="danger" className="mt-2">
          Сумма слишком велика для расчёта.
        </Notice>
      )}
      {diff === 0 && (
        <Notice tone="success" className="mt-2">
          Совпадает: в приложении столько же.
        </Notice>
      )}
      {diff !== null && diff !== 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <Notice tone="warning" role="status">
            {diff > 0 ? 'В приложении меньше, чем на самом деле' : 'В приложении больше, чем на самом деле'}:{' '}
            <b data-testid="bank-diff">{formatMinor(Math.abs(diff), c)}</b>. Если все операции внесены верно, поправьте начальный остаток: он станет{' '}
            {formatMinor(wallet.openingBalanceMinor + diff, c)}. Операции, доходы и расходы не изменятся.
          </Notice>
          <Button onClick={() => void fix()} loading={busy}>
            Исправить остаток
          </Button>
          <p className="text-sm text-muted">
            Или запишите разницу сегодняшним числом: «Корректировка остатка» появится в истории операций, но не будет считаться доходом или
            расходом.
          </p>
          <Button variant="secondary" onClick={() => void adjust()} loading={busy}>
            Записать корректировкой
          </Button>
        </div>
      )}
    </section>
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
          <BankCheck wallet={wallet} totalMinor={result.totalMinor} />
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
