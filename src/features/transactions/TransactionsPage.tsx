import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { exportTransactionsCsv, useCategories, useHasTransactions, useSettings, useStore, useTransactions, useWallets, ValidationError } from '@/db';
import type { LocalRow, Transaction } from '@/domain/types';
import { useToast } from '@/components/Toast';
import { downloadTextFile } from '@/features/settings/download';
import { useAddLink } from '@/layout/nav';
import { formatMinor } from '@/domain/money';
import { formatDayLabel, todayLocal } from '@/lib/dates';
import { pluralRu } from '@/lib/plural';
import { useSyncEnabled } from '@/sync/syncContext';
import { BulkCategorySheet } from './BulkCategorySheet';
import { BulkSelectionBar } from './BulkSelectionBar';
import { categoryEligibility, deleteMany, restoreMany, revertCategories, setCategoryMany } from './bulkActions';
import { DayHeader } from './DayHeader';
import { TransactionFilters } from './TransactionFilters';
import { TransactionRow } from './TransactionRow';
import { toastWithUndo } from './txActions';
import { useCategoryIndex, useWalletIndex } from './txData';
import { dayTotal, matchesAmountRange, matchesSearch, matchesSource, toTxFilter, totalsByCurrency } from './txFilters';
import { useListFilters } from './useListFilters';

/** Сколько операций показываем сразу (целыми днями) и сколько добавляет «Показать ещё». */
export const PAGE_SIZE = 200;

/** Список операций: по дням, с итогом дня, фильтрами и поиском. Нажатие на строку открывает правку. */
export default function TransactionsPage() {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const addLink = useAddLink();
  const syncEnabled = useSyncEnabled();
  const settings = useSettings();
  const walletIndex = useWalletIndex();
  const categoryIndex = useCategoryIndex();
  const wallets = useWallets({ includeArchived: true });
  const categories = useCategories(undefined, { includeArchived: true });

  const today = todayLocal();
  const { filters, search, change, showAll } = useListFilters(today);
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Поиск (заметка, категория, кошелёк, сумма) считаем здесь, а не в запросе к базе: названия лежат в справочниках, не в операции.
  const filter = useMemo(() => toTxFilter(filters, '', today, categories ?? []), [filters, today, categories]);
  const found = useTransactions(filter);
  const anyRow = useHasTransactions();
  const { amountFrom, amountTo, source } = filters;
  const rows = useMemo(() => {
    if (!found) return found;
    const bySource = source === '' ? found : found.filter((t) => matchesSource(t, source));
    const needSearch = search.trim() !== '';
    const needAmount = amountFrom !== '' || amountTo !== '';
    if (!needSearch && !needAmount) return bySource;
    // сумма сравнивается в валюте кошелька операции, поиск смотрит и в названия: пока справочники не загрузились, списка нет
    if (!walletIndex || (needSearch && !categoryIndex)) return undefined;
    const currencyOf = (id: string) => walletIndex.get(id)?.currency;
    const look = {
      walletName: (id: string) => walletIndex.get(id)?.name,
      categoryName: (id: string) => categoryIndex?.get(id)?.name,
      currencyOf,
    };
    return bySource.filter(
      (t) => matchesAmountRange(t, amountFrom, amountTo, currencyOf) && (!needSearch || matchesSearch(t, search, look)),
    );
  }, [found, search, source, amountFrom, amountTo, walletIndex, categoryIndex]);

  // другой список (фильтр, поиск, вкладка «Операции», «Показать всё») — снова с первой страницы
  const filterKey = JSON.stringify(filter);
  useEffect(() => setLimit(PAGE_SIZE), [filterKey, search, source, amountFrom, amountTo]);

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

  const periodTotals = useMemo(
    () => (rows && walletIndex ? totalsByCurrency(rows, (id) => walletIndex.get(id)?.currency, filters.walletId) : []),
    [rows, walletIndex, filters.walletId],
  );

  // Выделение: «Выбрать» включает режим, где нажатие на строку отмечает её, а не открывает правку. Отмечать можно только показанное.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const shownItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // сменился список (фильтр, поиск, удаление): выделенным остаётся только то, что ещё на экране, — невидимое не удаляем
  useEffect(() => {
    setPicked((cur) => {
      if (cur.size === 0) return cur;
      const visible = new Set(shownItems.map((t) => t.id));
      const next = new Set([...cur].filter((id) => visible.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [shownItems]);
  const pickedItems = useMemo(() => shownItems.filter((t) => picked.has(t.id)), [shownItems, picked]);
  const allSelected = shownItems.length > 0 && pickedItems.length === shownItems.length;
  const eligibility = useMemo(() => categoryEligibility(pickedItems), [pickedItems]);
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleAll = () => setPicked(allSelected ? new Set() : new Set(shownItems.map((t) => t.id)));

  const guarded = async (act: () => Promise<void>) => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      await act();
    } finally {
      setBulkBusy(false);
    }
  };
  const deleteSelected = () =>
    guarded(async () => {
      const res = await deleteMany(store, pickedItems.map((t) => t.id));
      setConfirmOpen(false);
      if (res.done.length === 0) {
        toast.error(res.error ?? 'Не удалось удалить операции. Ничего не изменилось.');
        return;
      }
      stopSelecting();
      const partial = res.failed > 0 ? ` Не удалось удалить: ${res.failed}.` : '';
      toastWithUndo(
        toast,
        `Удалено операций: ${res.done.length}.${partial}`,
        async () => {
          const back = await restoreMany(store, res.done);
          if (back.failed > 0) throw new ValidationError(`Вернулось ${back.done.length} из ${res.done.length}. ${back.error ?? ''}`.trim());
        },
        'Операции возвращены',
      );
    });
  const applyCategory = (categoryId: string) =>
    guarded(async () => {
      const res = await setCategoryMany(store, pickedItems.map((t) => ({ id: t.id, categoryId: t.categoryId })), categoryId);
      setCategoryOpen(false);
      if (res.done.length === 0) {
        toast.error(res.error ?? 'Не удалось сменить категорию. Ничего не изменилось.');
        return;
      }
      stopSelecting();
      const partial = res.failed > 0 ? ` Не удалось: ${res.failed}.` : '';
      toastWithUndo(
        toast,
        `Категория изменена у операций: ${res.done.length}.${partial}`,
        async () => {
          const back = await revertCategories(store, res.previous);
          if (back.failed > 0) throw new ValidationError(`Вернулось ${back.done.length} из ${res.done.length}. ${back.error ?? ''}`.trim());
        },
        'Прежние категории возвращены',
      );
    });

  const open = (id: string) => navigate(`/edit/${id}`, { state: { background: location } });

  // «Выгрузить список»: в файл идёт ровно то, что под текущими фильтрами и поиском (все найденные операции, а не только показанные страницей)
  const [exporting, setExporting] = useState(false);
  const exportList = async () => {
    if (!rows || rows.length === 0 || exporting) return;
    setExporting(true);
    try {
      const csv = await exportTransactionsCsv(store, rows);
      downloadTextFile(`sumoima-operations-${todayLocal()}.csv`, 'text/csv', csv);
      toast.success(`Выгружено ${rows.length} ${pluralRu(rows.length, 'операция', 'операции', 'операций')}`);
    } catch (e) {
      console.error('Не удалось выгрузить список операций:', e);
      toast.error('Не удалось выгрузить список. Ничего не изменилось — попробуйте ещё раз.');
    } finally {
      setExporting(false);
    }
  };

  const loading = !rows || anyRow === undefined || !settings || !walletIndex || !categoryIndex || !wallets || !categories;

  return (
    <>
      <PageHeader
        title="Операции"
        className="!pb-2 !pt-1 md:!pb-4 md:!pt-0"
        actions={
          selecting ? (
            <Button variant="secondary" onClick={stopSelecting}>
              Готово
            </Button>
          ) : rows && rows.length > 0 ? (
            <>
              <IconButton icon="check" label="Выбрать операции" onClick={() => setSelecting(true)} />
              <IconButton icon="download" label="Выгрузить список в CSV" disabled={exporting} onClick={() => void exportList()} />
            </>
          ) : undefined
        }
      />
      {loading ? (
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      ) : (
        <>
          {anyRow && (
            <TransactionFilters
              filters={filters}
              onChange={change}
              wallets={wallets}
              categories={categories}
              today={today}
            />
          )}

          {!anyRow ? (
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
                <Button variant="secondary" onClick={showAll}>
                  Показать всё
                </Button>
              }
            />
          ) : (
            <>
              {periodTotals && periodTotals.length > 0 && (
                <Card className="mb-4 flex flex-col gap-1.5" data-testid="period-totals" role="group" aria-labelledby="period-totals-title">
                  <h2 id="period-totals-title" className="text-caption font-semibold text-muted">
                    Итого за период
                  </h2>
                  {periodTotals.map((t) => (
                    <div key={t.currency} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-semibold text-muted">{t.currency}</span>
                        <span className="flex gap-3">
                          {t.incomeMinor > 0 && <MoneyText minor={t.incomeMinor} currency={t.currency} tone="income" sign="always" />}
                          {t.expenseMinor > 0 && <MoneyText minor={-t.expenseMinor} currency={t.currency} tone="expense" />}
                        </span>
                      </div>
                      {t.feeMinor > 0 && (
                        <p className="text-right text-caption text-muted">
                          в расходах комиссии переводов: {formatMinor(t.feeMinor, t.currency)}
                        </p>
                      )}
                    </div>
                  ))}
                </Card>
              )}
              {groups.map((g) => {
                const total = dayTotal(g.items, settings.baseCurrency, filters.walletId);
                const label = formatDayLabel(g.date, today);
                return (
                  <section key={g.date} aria-label={label} className="mb-4">
                    <DayHeader label={label} total={total} base={settings.baseCurrency} />
                    <Card padding="none" className="divide-y divide-border overflow-hidden">
                      {g.items.map((tx) => (
                        <TransactionRow
                          key={tx.id}
                          tx={tx}
                          wallets={walletIndex}
                          categories={categoryIndex}
                          syncEnabled={syncEnabled}
                          onOpen={selecting ? toggle : open}
                          {...(selecting ? { selection: { selected: picked.has(tx.id) } } : {})}
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
              {selecting && (
                <BulkSelectionBar
                  count={pickedItems.length}
                  allSelected={allSelected}
                  onToggleAll={toggleAll}
                  categoryReason={eligibility.ok ? null : eligibility.reason}
                  onCategory={() => setCategoryOpen(true)}
                  onDelete={() => setConfirmOpen(true)}
                  busy={bulkBusy}
                />
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen && pickedItems.length > 0}
        danger
        loading={bulkBusy}
        title={`Удалить выбранные операции (${pickedItems.length})?`}
        message="Они пропадут из списка, остатки кошельков пересчитаются (и остатки долгов, если среди них есть операции по долгам). Сразу после удаления их можно вернуть кнопкой «Отменить»."
        confirmLabel="Удалить"
        onConfirm={() => void deleteSelected()}
        onCancel={() => setConfirmOpen(false)}
      />
      {categoryOpen && eligibility.ok && categories && (
        <BulkCategorySheet
          kind={eligibility.kind}
          count={pickedItems.length}
          categories={categories}
          saving={bulkBusy}
          onApply={(id) => void applyCategory(id)}
          onClose={() => setCategoryOpen(false)}
        />
      )}
    </>
  );
}
