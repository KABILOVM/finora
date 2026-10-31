import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useHasTransactions, useTransactions } from '@/db';
import type { Category, CurrencyCode, IsoDate, LocalRow, Transaction, Wallet } from '@/domain/types';
import { DayHeader } from '@/features/transactions/DayHeader';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { dayTotal } from '@/features/transactions/txFilters';
import { useAddLink } from '@/layout/nav';
import { addDays, formatDayLabel } from '@/lib/dates';
import { useSyncEnabled } from '@/sync/syncContext';
import { useHideAmounts } from './hideAmounts';

export interface RecentOpsProps {
  wallets: ReadonlyMap<string, Wallet>;
  categories: ReadonlyMap<string, Category>;
  /** Сегодняшний день (меняется после полуночи, см. useToday). */
  today: IsoDate;
  /** Основная валюта: в ней считается итог дня. */
  base: CurrencyCode;
}

/**
 * Все операции за сегодня и вчера, по дням, с итогом дня. Лимита нет: список просто идёт вниз вместе с главной.
 * Всё, что старше, лежит по ссылке «Все операции».
 */
export function RecentOps({ wallets, categories, today, base }: RecentOpsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const addLink = useAddLink();
  const syncEnabled = useSyncEnabled();
  const yesterday = addDays(today, -1);
  const rows = useTransactions({ from: yesterday, to: today });
  const anyRow = useHasTransactions();
  const { hidden } = useHideAmounts();

  // Сегодня сверху, вчера ниже; внутри дня порядок тот же, что в «Операциях» (новые сверху). Пустой день не показываем.
  const groups = useMemo(() => {
    const out: { date: IsoDate; items: LocalRow<Transaction>[] }[] = [];
    for (const date of [today, yesterday]) {
      const items = (rows ?? []).filter((t) => t.occurredOn === date);
      if (items.length > 0) out.push({ date, items });
    }
    return out;
  }, [rows, today, yesterday]);

  const loading = !rows || anyRow === undefined;

  return (
    <section aria-labelledby="home-recent">
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id="home-recent" className="text-base font-semibold text-muted">
          Последние операции
        </h2>
        {anyRow && (
          <Link to="/transactions" className="press min-h-[44px] shrink-0 content-center whitespace-nowrap text-base font-semibold text-brand">
            Все операции
          </Link>
        )}
      </div>
      {loading ? (
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
      ) : !anyRow ? (
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
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="list"
            title="За сегодня и вчера операций нет"
            text="Старые операции — по ссылке «Все операции»."
            className="py-6"
            action={
              <Link {...addLink} className={buttonClasses('primary', 'lg')}>
                Добавить операцию
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const label = formatDayLabel(g.date, today);
            return (
              <section key={g.date} aria-label={label}>
                <DayHeader label={label} total={dayTotal(g.items, base)} base={base} level={3} />
                <Card padding="none" className="divide-y divide-border overflow-hidden">
                  {g.items.map((tx) => (
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
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
