import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { useBalancesState, useSettings, useTransactions, useWallets } from '@/db';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useCategoryIndex, useWalletIndex } from '@/features/transactions/txData';
import { walletOpsQuery } from '@/features/transactions/txFilters';
import { useAddLink } from '@/layout/nav';
import { useSyncEnabled } from '@/sync/syncContext';
import { GoalLine } from './GoalLine';
import { ReconcileSheet } from './ReconcileSheet';
import { useGoals } from './useGoals';
import { WALLET_KIND_LABELS } from './walletUi';
import { WalletSheet } from './WalletSheet';

/** Сколько последних операций показываем; остальные — по ссылке «Все операции». */
export const RECENT_OPS = 5;

/**
 * Экран кошелька: крупный остаток, кнопки «Расход / Доход / Перевод» сразу с этим кошельком, последние операции со ссылкой на все,
 * цель накопления, «Сверка» и «Изменить». Открывается нажатием на строку в «Кошельках».
 */
export default function WalletPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wallets = useWallets({ includeArchived: true });
  const balancesState = useBalancesState();
  const settings = useSettings();
  const goals = useGoals();
  const txs = useTransactions({ walletId: id }, { limit: RECENT_OPS });
  const walletIndex = useWalletIndex();
  const categoryIndex = useCategoryIndex();
  const syncEnabled = useSyncEnabled();
  const expense = useAddLink('expense', id);
  const income = useAddLink('income', id);
  const transfer = useAddLink('transfer', id);
  const [sheet, setSheet] = useState<'edit' | 'reconcile' | null>(null);

  const wallet = wallets?.find((w) => w.id === id);
  const goal = useMemo(() => goals?.find((g) => g.wallet.id === id), [goals, id]);
  const header = <PageHeader back={{ to: '/wallets', label: 'Кошельки' }} title={wallet?.name ?? 'Кошелёк'} />;

  if (wallets === undefined || settings === undefined || balancesState === undefined) {
    return (
      <>
        {header}
        <div role="status" aria-busy="true">
          <span className="sr-only">Загрузка…</span>
          <Skeleton className="h-32 !rounded-card" />
        </div>
      </>
    );
  }
  if (!wallet) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="info"
            title="Такого кошелька нет"
            text="Возможно, он удалён. Откройте список кошельков."
            action={
              <Link to="/wallets" className={buttonClasses('primary')}>
                К кошелькам
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const balance = balancesState.ok ? (balancesState.balances.get(wallet.id) ?? 0) : null;
  const archived = wallet.archivedAt !== null;
  const otherNames = wallets.filter((w) => w.id !== wallet.id).map((w) => w.name);

  return (
    <>
      {header}
      <Card className="mb-4" data-testid="wallet-hero">
        <div className="text-sm font-semibold text-muted">
          {WALLET_KIND_LABELS[wallet.kind]} · {wallet.currency}
          {archived ? ' · в архиве' : ''}
        </div>
        {balance === null ? (
          <p className="text-lg text-muted">Сумма слишком велика для расчёта</p>
        ) : (
          <div className="text-3xl font-bold" data-testid="wallet-balance">
            <MoneyText minor={balance} currency={wallet.currency} tone={balance < 0 ? 'expense' : 'none'} />
          </div>
        )}
        {!archived && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Link {...expense} className={buttonClasses('secondary')}>
              Расход
            </Link>
            <Link {...income} className={buttonClasses('secondary')}>
              Доход
            </Link>
            <Link {...transfer} className={buttonClasses('secondary')}>
              Перевод
            </Link>
          </div>
        )}
        <div className="mt-2 flex gap-2">
          <Button variant="ghost" onClick={() => setSheet('reconcile')}>
            Сверка
          </Button>
          <Button variant="ghost" onClick={() => setSheet('edit')}>
            Изменить
          </Button>
        </div>
      </Card>

      {balancesState.ok === false && (
        <Notice tone="danger" className="mb-4">
          {balancesState.message}. Откройте операции кошелька: среди них есть слишком большая сумма.
        </Notice>
      )}

      {goal && (
        <Card padding="none" className="mb-4">
          <GoalLine item={goal} className="pt-3" />
        </Card>
      )}

      <section aria-labelledby="wallet-ops-h">
        <SectionHeader id="wallet-ops-h" action={<Link to={`/transactions?${walletOpsQuery(wallet.id)}`} className="text-sm font-semibold text-brand">Все операции</Link>}>
          Последние операции
        </SectionHeader>
        <Card padding="none">
          {txs === undefined || walletIndex === undefined || categoryIndex === undefined ? (
            <div className="p-4">
              <Skeleton className="h-16" />
            </div>
          ) : txs.length === 0 ? (
            <p className="p-4 text-muted">По этому кошельку ещё нет операций.</p>
          ) : (
            <ul className="divide-y divide-border" aria-label="Последние операции кошелька">
              {txs.map((tx) => (
                <li key={tx.id}>
                  <TransactionRow
                    tx={tx}
                    wallets={walletIndex}
                    categories={categoryIndex}
                    syncEnabled={syncEnabled}
                    onOpen={(txId) => navigate(`/edit/${txId}`, { state: { background: location } })}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {sheet === 'edit' && settings && (
        <WalletSheet wallet={wallet} defaultCurrency={settings.baseCurrency} otherNames={otherNames} onClose={() => setSheet(null)} />
      )}
      {sheet === 'reconcile' && <ReconcileSheet wallet={wallet} onClose={() => setSheet(null)} />}
    </>
  );
}
