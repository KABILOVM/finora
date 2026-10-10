import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { useBalances, useSettings, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { ruDate } from '@/features/transactions/txForm';
import { monthKey, todayLocal } from '@/lib/dates';
import { useRates } from '@/rates/hooks';
import { computeHomeTotal } from './homeData';
import { MonthCard } from './MonthCard';
import { RecentOps } from './RecentOps';

/** Главная: «Всего», кошельки, итоги месяца, расходы по категориям, последние операции. */
export default function HomePage() {
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const walletIndex = useWalletIndex();
  const categoryIndex = useCategoryIndex();
  const { getRate } = useRates();
  const currentMonth = monthKey(todayLocal());
  const [month, setMonth] = useState(currentMonth);

  const base = settings?.baseCurrency;
  const total = useMemo(
    () => (wallets && balances && base ? computeHomeTotal(wallets, balances, base, getRate) : undefined),
    [wallets, balances, base, getRate],
  );

  if (!wallets || !balances || settings === undefined || !walletIndex || !categoryIndex) {
    return (
      <>
        <PageHeader title="Главная" />
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      </>
    );
  }

  if (settings === null || !base) {
    return (
      <>
        <PageHeader title="Главная" />
        <EmptyState icon="cloud" title="Данные ещё загружаются" text="Подождите немного: после первой загрузки здесь появится сводка." />
      </>
    );
  }

  if (wallets.length === 0) {
    return (
      <>
        <PageHeader title="Главная" />
        <EmptyState
          icon="wallet"
          title="Начните с кошелька"
          text="Деньги учитываются по кошелькам: например, «Наличные» или «Карта». Создайте первый — и можно вносить операции."
          action={
            <Link to="/wallets" className={buttonClasses('primary', 'lg')}>
              Создать кошелёк
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Главная" />
      <div className="flex flex-col gap-6">
        <Card padding="lg" aria-label="Всего денег" data-testid="home-total">
          <p className="text-sm text-muted">Всего</p>
          {total ? (
            <>
              <p className="mt-1 text-4xl font-bold tracking-tight">
                {total.approximate && <span title="Приблизительно: часть денег пересчитана по курсу">≈ </span>}
                <MoneyText minor={total.totalMinor} currency={base} tone={total.totalMinor < 0 ? 'expense' : 'none'} />
              </p>
              {total.approximate && total.missing.length === 0 && (
                <p className="mt-1 text-sm text-muted">Остатки в других валютах пересчитаны по курсу.</p>
              )}
              {total.missing.length > 0 && (
                <p className="mt-2 text-sm font-medium text-warning">
                  Не вошло в итог — нет курса:{' '}
                  {total.missing.map((m) => formatMinor(m.balanceMinor, m.currency)).join(', ')}.
                </p>
              )}
              {total.stale.length > 0 && (
                <p className="mt-2 text-sm font-medium text-warning">
                  Курс устарел ({total.stale.map((s) => `${s.currency} на ${ruDate(s.asOf)}`).join(', ')}) — итог может быть неточным.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-4xl font-bold">—</p>
          )}
        </Card>

        <section aria-labelledby="home-wallets">
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 id="home-wallets" className="text-lg font-bold">
              Кошельки
            </h2>
            <Link to="/wallets" className="min-h-[44px] content-center text-base font-semibold text-brand">
              Все кошельки
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {wallets.map((w) => {
              const balance = balances.get(w.id) ?? 0;
              return (
                <li key={w.id}>
                  <Card className="h-full">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-xl">
                        {w.icon}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">{w.name}</span>
                    </div>
                    <MoneyText
                      minor={balance}
                      currency={w.currency}
                      tone={balance < 0 ? 'expense' : 'none'}
                      className="mt-2 block text-lg font-bold"
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <MonthCard month={month} currentMonth={currentMonth} onMonth={setMonth} categories={categoryIndex} />

        <RecentOps wallets={walletIndex} categories={categoryIndex} />
      </div>
    </>
  );
}
