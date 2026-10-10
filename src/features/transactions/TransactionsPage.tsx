import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { useCategories, useSettings, useTransactions, useWallets } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { useAddLink } from '@/layout/nav';
import { formatDayLabel, monthKey, todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useSyncEnabled } from '@/sync/syncContext';
import { TransactionFilters } from './TransactionFilters';
import { TransactionRow } from './TransactionRow';
import { useCategoryIndex, useWalletIndex } from './txData';
import { dayTotal, toTxFilter, useDebounced, type ListFilters } from './txFilters';

/** Сколько операций показываем сразу (целыми днями) и сколько добавляет «Показать ещё». */
export const PAGE_SIZE = 200;
const SEARCH_DELAY_MS = 300;

const defaultFilters = (): ListFilters => ({
  period: 'this',
  month: monthKey(todayLocal()),
  walletId: '',
  categoryId: '',
  kind: '',
  search: '',
});

/** Список операций: по дням, с итогом дня, фильтрами и поиском. Нажатие на строку открывает правку. */
export default function TransactionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const addLink = useAddLink();
  const syncEnabled = useSyncEnabled();
  const settings = useSettings();
  const walletIndex = useWalletIndex();
  const categoryIndex = useCategoryIndex();
  const wallets = useWallets({ includeArchived: true });
  const categories = useCategories(undefined, { includeArchived: true });

  const [filters, setFilters] = useState<ListFilters>(defaultFilters);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const search = useDebounced(filters.search, SEARCH_DELAY_MS);
  const today = todayLocal();
  const filter = useMemo(() => toTxFilter(filters, search, today), [filters, search, today]);
  const rows = useTransactions(filter);
  const anyRow = useTransactions({}, { limit: 1 });

  const change = (patch: Partial<ListFilters>) => {
    setFilters((cur) => ({ ...cur, ...patch }));
    setLimit(PAGE_SIZE);
  };

  const { groups, shown } = useMemo(() => {
    const byDay = new Map<string, LocalRow<Transaction>[]>();
    for (const t of rows ?? []) byDay.set(t.occurredOn, [...(byDay.get(t.occurredOn) ?? []), t]);
    // дни от новых к старым; день показываем целиком, чтобы его итог не оказался неполным
    const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
    const out: { date: string; items: LocalRow<Transaction>[] }[] = [];
    let count = 0;
    for (const [date, items] of days) {
      if (count >= limit) break;
      out.push({ date, items });
      count += items.length;
    }
    return { groups: out, shown: count };
  }, [rows, limit]);

  const open = (id: string) => navigate(`/edit/${id}`, { state: { background: location } });

  const loading = !rows || !anyRow || !settings || !walletIndex || !categoryIndex || !wallets || !categories;

  return (
    <>
      <PageHeader title="Операции" className="!pb-2 !pt-1 md:!pb-4 md:!pt-0" />
      {loading ? (
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      ) : (
        <>
          {anyRow.length > 0 && (
            <TransactionFilters
              filters={filters}
              onChange={change}
              wallets={wallets}
              categories={categories}
              currentMonth={monthKey(today)}
            />
          )}

          {anyRow.length === 0 ? (
            <EmptyState
              icon="list"
              title="Операций пока нет"
              text="Внесите первый расход или доход — это занимает несколько секунд."
              action={
                <Link {...addLink} className={buttonClasses('primary', 'lg')}>
                  Добавить операцию
                </Link>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="search"
              title="Ничего не найдено"
              text="По выбранным условиям операций нет."
              action={
                <Button variant="secondary" onClick={() => setFilters({ ...defaultFilters(), period: 'all' })}>
                  Показать всё
                </Button>
              }
            />
          ) : (
            <>
              {groups.map((g) => {
                const total = dayTotal(g.items, settings.baseCurrency);
                const label = formatDayLabel(g.date, today);
                return (
                  <section key={g.date} aria-label={label} className="mb-4">
                    <header className="flex items-baseline justify-between gap-2 px-1 pb-1">
                      <h2 className="text-sm font-semibold text-muted">{label}</h2>
                      <span className="text-sm">
                        {total ? (
                          <>
                            {total.excluded > 0 && (
                              <span className="mr-2 text-xs text-muted">
                                без {total.excluded} {pluralRu(total.excluded, 'операции', 'операций', 'операций')} в другой валюте
                              </span>
                            )}
                            <MoneyText minor={total.netMinor} currency={settings.baseCurrency} sign="always" className="font-semibold" />
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </span>
                    </header>
                    <Card padding="none" className="divide-y divide-border overflow-hidden">
                      {g.items.map((tx) => (
                        <TransactionRow
                          key={tx.id}
                          tx={tx}
                          wallets={walletIndex}
                          categories={categoryIndex}
                          syncEnabled={syncEnabled}
                          onOpen={open}
                        />
                      ))}
                    </Card>
                  </section>
                );
              })}
              {shown < rows.length && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Button variant="secondary" fullWidth onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                    Показать ещё
                  </Button>
                  <p className="text-sm text-muted">
                    Показано {shown} из {rows.length}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
