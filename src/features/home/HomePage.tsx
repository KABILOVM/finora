import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InstallHint } from '@/components/InstallHint';
import { PageHeader } from '@/components/PageHeader';
import { useBalances, useSettings, useWallets } from '@/db';
import BudgetsWidget from '@/features/budgets/BudgetsWidget';
import UpcomingWidget from '@/features/recurring/UpcomingWidget';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { useRates } from '@/rates/hooks';
import { computeHomeTotal } from './homeData';
import AttentionRow from './AttentionRow';
import { GlanceStrip } from './GlanceStrip';
import { HideAmountsProvider } from './hideAmounts';
import { HomeHero } from './HomeHero';
import { RecentOps } from './RecentOps';
import { WalletChips } from './WalletChips';

/**
 * На телефоне заголовок «Главная» скрыт визуально (остаётся для скринридера): название и так видно внизу в меню,
 * а место нужнее под «Всего», кошельки и итоги месяца. На планшете и ПК он на месте.
 */
const HEADER_CLASS = 'sr-only md:not-sr-only md:!pb-4 md:!pt-2';

/**
 * Главная: «Всего» с приходом и расходом месяца, строка «Требует внимания», курсы и погода, кошельки, «Можно тратить в день»,
 * ближайшие платежи, последние операции.
 * Подсказка «как установить» живёт только здесь (на других страницах её нет).
 */
export default function HomePage() {
  const wallets = useWallets();
  const balances = useBalances();
  const settings = useSettings();
  const walletIndex = useWalletIndex();
  const categoryIndex = useCategoryIndex();
  const { getRate } = useRates();

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
            <Link to="/wallets?new=1" className={buttonClasses('primary', 'lg')}>
              Создать кошелёк
            </Link>
          }
        />
      </>
    );
  }

  return (
    <HideAmountsProvider>
      <InstallHint className="mb-2" />
      <PageHeader title="Главная" className={HEADER_CLASS} />
      <div className="stagger flex flex-col gap-3 md:gap-4">
        <HomeHero total={total ?? null} base={base} />
        <AttentionRow />
        <GlanceStrip base={base} />
        <WalletChips wallets={wallets} balances={balances} />
        <BudgetsWidget />
        <UpcomingWidget />
        <RecentOps wallets={walletIndex} categories={categoryIndex} />
      </div>
    </HideAmountsProvider>
  );
}
