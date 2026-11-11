import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { InstallHint } from '@/components/InstallHint';
import { PageHeader } from '@/components/PageHeader';
import { useBalances, useSettings, useTransactions, useWallets } from '@/db';
import { parseHome } from '@/domain/homeLayout';
import type { LocalRow, Wallet } from '@/domain/types';
import BudgetsWidget from '@/features/budgets/BudgetsWidget';
import UpcomingWidget from '@/features/recurring/UpcomingWidget';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { useRates } from '@/rates/hooks';
import { useToday } from '@/recurring/useToday';
import { computeWalletsTotal } from '@/rates/walletsTotal';
import AttentionRow from './AttentionRow';
import { RatesCard, WeatherCard } from './GlanceCards';
import MissedDaysCard from './MissedDaysCard';
import { HideAmountsProvider } from './hideAmounts';
import { HomeHero } from './HomeHero';
import type { HomeBlockId } from './layout/blocks';
import { HOME_EDIT_LINK } from './layout/editLink';
import { adviceAnchor, resolveHome, slotsOf, widthOf } from './layout/layout';
import { inMonthlyWindow } from './monthlyWindow';
import { RecentOps } from './RecentOps';
import SaveRemainderCard from './SaveRemainderCard';
import TemplatesRow from './TemplatesRow';
import TripCard from './TripCard';
import { WalletChips } from './WalletChips';
import WeeklyCard from './WeeklyCard';

// Карточка «Запишите первую трату» нужна только тому, у кого нет операций: остальным она в основной файл не грузится
const FirstOperationCard = lazy(() => import('./FirstOperationCard'));
// «Итоги месяца» нужны только в первые дни месяца: в остальные дни их код не грузится
const MonthlyCard = lazy(() => import('./MonthlyCard'));
// «Траты в день» нужны только тому, кто отметил ежедневные категории: расчёт и карточка грузятся отдельным файлом
const DailyHomeCard = lazy(() => import('@/features/daily/DailyHomeCard'));
// Блоки, которых на стандартной главной нет: код грузится, только когда человек вынес блок на главную
const SpendingHomeCard = lazy(() => import('./blocks/SpendingHomeCard'));
const DebtsHomeCard = lazy(() => import('./blocks/DebtsHomeCard'));
const GoalsHomeCard = lazy(() => import('./blocks/GoalsHomeCard'));
const ShoppingHomeCard = lazy(() => import('./blocks/ShoppingHomeCard'));
const ShortcutsRow = lazy(() => import('./blocks/ShortcutsRow'));
// Настройка главной открывается редко: её код в файл главной не входит
const HomeEditor = lazy(() => import('./layout/HomeEditor'));

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

const WIDTH_ATTRS = {
  full: {},
  half: { 'data-size': 'half' },
  'half-wide': { 'data-size': 'half-wide' },
  bento: { 'data-bento': 'half' },
} as const;

/**
 * Главная собирается из блоков по раскладке из настроек (layout/): человек сам решает, что показывать, в каком порядке и какой ширины.
 * Пока он ничего не настраивал, главная стандартная: «Всего» с приходом и расходом месяца, строка «Требует внимания», курсы и
 * погода, кошельки, «Можно тратить в день», ближайшие платежи, последние операции. Адрес `/?edit=1` открывает настройку главной.
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
  const [params] = useSearchParams();

  const base = settings?.baseCurrency;
  const total = useMemo(
    () => (wallets && balances && base ? computeWalletsTotal(wallets, balances, base, getRate) : undefined),
    [wallets, balances, base, getRate],
  );
  const home = settings?.home ?? null;
  const slots = useMemo(() => slotsOf(resolveHome(parseHome(home))).filter((s) => s.on), [home]);
  // место под строку-совет погоды: отдельная строка под рядом с погодой, когда та стоит половиной (см. adviceAnchor)
  const [adviceSlot, setAdviceSlot] = useState<HTMLElement | null>(null);
  const adviceAt = useMemo(() => adviceAnchor(slots), [slots]);

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

  if (params.get('edit') === '1') {
    return (
      <Suspense
        fallback={
          <p role="status" className="py-10 text-center text-muted">
            Загрузка…
          </p>
        }
      >
        <HomeEditor home={home} />
      </Suspense>
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

  /** half — блок стоит в половину ширины: у блоков с узким видом он включается. */
  const render = (id: HomeBlockId, half: boolean): ReactNode => {
    switch (id) {
      case 'hero':
        return <HomeHero total={total ?? null} base={base} />;
      case 'templates':
        return <TemplatesRow />;
      case 'attention':
        return <AttentionRow />;
      case 'missed':
        return <MissedDaysCard />;
      case 'weekly':
        return <WeeklyCard today={today} categories={categoryIndex} />;
      case 'monthly':
        return inMonthlyWindow(today) ? (
          <Suspense fallback={null}>
            <MonthlyCard today={today} categories={categoryIndex} />
          </Suspense>
        ) : null;
      case 'save':
        return <SaveRemainderCard today={today} />;
      case 'trip':
        return <TripCard />;
      case 'daily':
        return (
          <Suspense fallback={null}>
            <DailyHomeCard />
          </Suspense>
        );
      case 'rates':
        return <RatesCard base={base} />;
      case 'weather':
        return adviceAt < 0 ? <WeatherCard /> : <WeatherCard adviceSlot={adviceSlot} />;
      case 'wallets':
        return <WalletChips wallets={wallets} balances={balances} />;
      case 'budgets':
        return <BudgetsWidget />;
      case 'spending':
        return (
          <Suspense fallback={null}>
            <SpendingHomeCard today={today} base={base} categories={categoryIndex} half={half} />
          </Suspense>
        );
      case 'upcoming':
        return <UpcomingWidget />;
      case 'debts':
        return (
          <Suspense fallback={null}>
            <DebtsHomeCard today={today} half={half} />
          </Suspense>
        );
      case 'goals':
        return (
          <Suspense fallback={null}>
            <GoalsHomeCard half={half} />
          </Suspense>
        );
      case 'shopping':
        return (
          <Suspense fallback={null}>
            <ShoppingHomeCard half={half} />
          </Suspense>
        );
      case 'shortcuts':
        return (
          <Suspense fallback={null}>
            <ShortcutsRow />
          </Suspense>
        );
      case 'recent':
        return <RecentOps wallets={walletIndex} categories={categoryIndex} today={today} base={base} />;
    }
  };

  // «Запишите первую трату» — не блок раскладки: карточка стоит сразу под итогом (или первой, если итог скрыт), пока операций нет
  const first = (
    <div key="first" data-home-block="first">
      <FirstOperation wallets={wallets} />
    </div>
  );
  const nodes: ReactNode[] = slots.some((s) => s.block.id === 'hero') ? [] : [first];
  slots.forEach((slot, i) => {
    const width = widthOf(slot);
    nodes.push(
      <div key={slot.block.id} data-home-block={slot.block.id} {...WIDTH_ATTRS[width]}>
        {render(slot.block.id, width === 'half')}
      </div>,
    );
    if (slot.block.id === 'hero') nodes.push(first);
    // пустое, пока совета нет: пустой блок места не занимает
    if (i === adviceAt) nodes.push(<div key="weather-advice" data-home-block="weather-advice" ref={setAdviceSlot} />);
  });

  return (
    <HideAmountsProvider>
      <InstallHint className="mb-2" />
      <PageHeader title="Главная" className={HEADER_CLASS} />
      <div data-home-grid className="stagger">
        {nodes}
      </div>
      {slots.length === 0 && (
        <EmptyState icon="home" title="На главной пусто" text="Все блоки скрыты. Верните нужные — это занимает пару касаний." className="py-8" />
      )}
      <div className="flex justify-center pt-3">
        <Link
          {...HOME_EDIT_LINK}
          className="press inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold text-muted hover:text-brand"
        >
          <Icon name="sliders" size={18} />
          Настроить главную
        </Link>
      </div>
    </HideAmountsProvider>
  );
}

