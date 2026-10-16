import { Glyph } from '@/components/Glyph';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { InstallHint } from '@/components/InstallHint';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { useBalances, useSettings, useWallets } from '@/db';
import BudgetsWidget from '@/features/budgets/BudgetsWidget';
import DebtsWidget from '@/features/debts/DebtsWidget';
import UpcomingWidget from '@/features/recurring/UpcomingWidget';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { monthKey, todayLocal } from '@/lib/dates';
import { useRates } from '@/rates/hooks';
import { computeHomeTotal } from './homeData';
import GoalsWidget from './GoalsWidget';
import { HomeHero } from './HomeHero';
import { MonthCard } from './MonthCard';
import { RecentOps } from './RecentOps';
import RatesWidget from './RatesWidget';
import WeatherWidget from './WeatherWidget';

/**
 * На телефоне заголовок «Главная» скрыт визуально (остаётся для скринридера): название и так видно внизу в меню,
 * а место нужнее под «Всего», кошельки и итоги месяца. На планшете и ПК он на месте.
 */
const HEADER_CLASS = 'sr-only md:not-sr-only md:!pb-4 md:!pt-2';

/**
 * Главная: «Всего», кошельки, итоги месяца, расходы по категориям, последние операции.
 * Подсказка «как установить» живёт только здесь (на других страницах её нет).
 */
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
        <InstallHint className="mb-3" />
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
      <InstallHint className="mb-2" />
      <PageHeader title="Главная" className={HEADER_CLASS} />
      <div className="stagger flex flex-col gap-3 md:gap-6">
        <HomeHero total={total ?? null} base={base} />

        <section aria-labelledby="home-wallets">
          <div className="-mb-1 -mt-1 flex items-center justify-between gap-3 px-1">
            <h2 id="home-wallets" className="text-lg font-bold">
              Кошельки
            </h2>
            <Link to="/wallets" className="inline-flex min-h-[44px] items-center text-base font-semibold text-brand">
              Все кошельки
            </Link>
          </div>
          {/* Телефон: кошельки в одну строку, которую можно листать пальцем (высота не растёт с числом кошельков). Шире — сетка. */}
          <ul className="scroll-x-quiet -mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {wallets.map((w) => {
              const balance = balances.get(w.id) ?? 0;
              return (
                <li key={w.id} className="min-w-[8.5rem] shrink-0 grow snap-start sm:min-w-0">
                  <Card className="h-full !p-3">
                    <div className="flex items-center gap-2">
                      <Glyph value={w.icon} color={w.color} size={30} />
                      <span className="min-w-0 max-w-[9rem] truncate text-sm font-medium sm:max-w-none">{w.name}</span>
                    </div>
                    <MoneyText
                      minor={balance}
                      currency={w.currency}
                      tone={balance < 0 ? 'expense' : 'none'}
                      className="mt-1 block text-lg font-bold"
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="grid grid-cols-2 gap-3 md:gap-6" data-testid="home-glance">
          <RatesWidget base={base} />
          <WeatherWidget />
        </div>

        <BudgetsWidget />
        <UpcomingWidget />
        <DebtsWidget />
        <GoalsWidget />

        <MonthCard month={month} currentMonth={currentMonth} onMonth={setMonth} categories={categoryIndex} />

        <RecentOps wallets={walletIndex} categories={categoryIndex} />
      </div>
    </>
  );
}
