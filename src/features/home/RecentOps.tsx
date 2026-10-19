import { Link, useLocation, useNavigate } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useTransactions } from '@/db';
import type { Category, Wallet } from '@/domain/types';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAddLink } from '@/layout/nav';
import { useSyncEnabled } from '@/sync/syncContext';
import { useHideAmounts } from './hideAmounts';

export interface RecentOpsProps {
  wallets: ReadonlyMap<string, Wallet>;
  categories: ReadonlyMap<string, Category>;
}

/** Последние 5 операций и ссылка на полный список. */
export function RecentOps({ wallets, categories }: RecentOpsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const addLink = useAddLink();
  const syncEnabled = useSyncEnabled();
  const rows = useTransactions({}, { limit: 5 });
  const { hidden } = useHideAmounts();

  return (
    <section aria-labelledby="home-recent">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id="home-recent" className="text-base font-semibold text-muted">
          Последние операции
        </h2>
        {rows && rows.length > 0 && (
          <Link to="/transactions" className="press min-h-[44px] content-center text-base font-semibold text-brand">
            Все операции
          </Link>
        )}
      </div>
      {!rows ? (
        <Card aria-busy="true" role="status" className="space-y-3 !p-4">
          <span className="sr-only">Загрузка…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3" aria-hidden="true">
              <Skeleton className="h-10 w-10 !rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="list"
            title="Операций пока нет"
            text="Внесите первый расход или доход — это занимает несколько секунд."
            className="py-6"
            action={
              <Link {...addLink} className={buttonClasses('primary', 'lg')}>
                Добавить операцию
              </Link>
            }
          />
        </Card>
      ) : (
        <Card padding="none" className="divide-y divide-border overflow-hidden">
          {rows.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              wallets={wallets}
              categories={categories}
              syncEnabled={syncEnabled}
              maskAmounts={hidden}
              onOpen={(id) => navigate(`/edit/${id}`, { state: { background: location } })}
            />
          ))}
        </Card>
      )}
    </section>
  );
}
