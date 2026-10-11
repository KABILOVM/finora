import { Link, useLocation, useNavigate } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTransactions } from '@/db';
import type { Category, Wallet } from '@/domain/types';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAddLink } from '@/layout/nav';
import { useSyncEnabled } from '@/sync/syncContext';

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

  return (
    <section aria-labelledby="home-recent">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id="home-recent" className="text-lg font-bold">
          Последние операции
        </h2>
        {rows && rows.length > 0 && (
          <Link to="/transactions" className="min-h-[44px] content-center text-base font-semibold text-brand">
            Все операции
          </Link>
        )}
      </div>
      {!rows ? (
        <p role="status" className="py-6 text-center text-muted">
          Загрузка…
        </p>
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
              onOpen={(id) => navigate(`/edit/${id}`, { state: { background: location } })}
            />
          ))}
        </Card>
      )}
    </section>
  );
}
