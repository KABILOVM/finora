import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InstallHint } from '@/components/InstallHint';
import { PageHeader } from '@/components/PageHeader';
import { useBalances, useSettings, useTransactions, useWallets } from '@/db';
import type { LocalRow, Wallet } from '@/domain/types';
import BudgetsWidget from '@/features/budgets/BudgetsWidget';
import UpcomingWidget from '@/features/recurring/UpcomingWidget';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { useRates } from '@/rates/hooks';
import { useToday } from '@/recurring/useToday';
import { computeWalletsTotal } from '@/rates/walletsTotal';
import AttentionRow from './AttentionRow';
import MissedDaysCard from './MissedDaysCard';
import { GlanceStrip } from './GlanceStrip';
import { HideAmountsProvider } from './hideAmounts';
import { HomeHero } from './HomeHero';
import { RecentOps } from './RecentOps';
import SaveRemainderCard from './SaveRemainderCard';
import TemplatesRow from './TemplatesRow';
import TripCard from './TripCard';
import { WalletChips } from './WalletChips';
import WeeklyCard from './WeeklyCard';

// Карточка «Запишите первую трату» нужна только тому, у кого нет операций: остальным она в основной файл не грузится
const FirstOperationCard = lazy(() => import('./FirstOperationCard'));

/** Затвор: карточку подгружаем, только когда операций нет совсем. */
function FirstOperation({ wallets }: { wallets: readonly LocalRow<Wallet>[] }) {
  const rows = useTransactions({}, { limit: 1 });
  if (!rows || rows.length > 0) return null;
  return (
    <Suspense fallback={null}>
      <FirstOperationCard wallets={wallets} />
    </Suspense>
  );
}

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
  const today = useToday();

  const base = settings?.baseCurrency;
  const total = useMemo(
    () => (wallets && balances && base ? computeWalletsTotal(wallets, balances, base, getRate) : undefined),
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
        <FirstOperation wallets={wallets} />
        <TemplatesRow />
        <AttentionRow />
        <MissedDaysCard />
        <WeeklyCard today={today} categories={categoryIndex} />
        <SaveRemainderCard today={today} />
        <TripCard />
        <GlanceStrip base={base} />
        <WalletChips wallets={wallets} balances={balances} />
        <BudgetsWidget />
        <UpcomingWidget />
        <RecentOps wallets={walletIndex} categories={categoryIndex} today={today} base={base} />
      </div>
    </HideAmountsProvider>
  );
}
