import { Card } from '@/components/Card';
import { MoneyText } from '@/components/MoneyText';
import { useLiveQuery } from 'dexie-react-hooks';
import { summarizeMonth, useStore, type MonthSummary } from '@/db';
import { addMinor, formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, Minor } from '@/domain/types';
import { MonthSwitcher } from '@/features/transactions/MonthSwitcher';
import { pluralRu } from '@/lib/plural';
import { sharePercent, topCategories } from './homeData';

export interface MonthCardProps {
  month: string;
  currentMonth: string;
  onMonth: (month: string) => void;
  categories: ReadonlyMap<string, Category>;
}

/**
 * Итоги месяца ВМЕСТЕ с валютой, в которой они посчитаны: из одного чтения базы. Если бы валюту брали отдельным запросом,
 * на кадр после смены основной валюты суммы в новой валюте подписались бы старой.
 */
function useMonthTotals(month: string): { base: CurrencyCode; summary: MonthSummary } | null | undefined {
  const store = useStore();
  return useLiveQuery(async () => {
    const settings = await store.settings.get();
    if (!settings) return null;
    const rows = await store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray();
    return { base: settings.baseCurrency, summary: summarizeMonth(rows, month, settings.baseCurrency) };
  }, [store, month]);
}

function Row({ label, children, strong = false }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'text-lg font-bold' : 'font-semibold'}>{children}</dd>
    </div>
  );
}

/** «Этот месяц»: доходы, расходы, разница и расходы по категориям полосками (топ-5 и «ещё»). */
export function MonthCard({ month, currentMonth, onMonth, categories }: MonthCardProps) {
  const totals = useMonthTotals(month);
  const summary = totals?.summary;
  const base = totals?.base ?? 'TJS';

  let diff: Minor | null = null;
  if (summary) {
    try {
      diff = addMinor(summary.incomeMinor, -summary.expenseMinor);
    } catch {
      diff = null; // сумма не помещается в безопасное целое
    }
  }
  const bars = summary ? topCategories(summary.byCategory) : null;

  return (
    <Card padding="lg" aria-label="Итоги месяца">
      <MonthSwitcher month={month} max={currentMonth} onChange={onMonth} />
      {month === currentMonth && <p className="text-center text-xs text-muted">Этот месяц</p>}

      {!summary ? (
        <p role="status" className="py-6 text-center text-muted">
          {totals === null ? 'Настройки ещё не загружены' : 'Считаем…'}
        </p>
      ) : (
        <>
          <dl className="mt-4 flex flex-col gap-2">
            <Row label="Доходы">
              <MoneyText minor={summary.incomeMinor} currency={base} tone="income" sign="always" />
            </Row>
            <Row label="Расходы">
              <MoneyText minor={-summary.expenseMinor} currency={base} tone="expense" />
            </Row>
            <Row label="Разница" strong>
              {diff === null ? '—' : <MoneyText minor={diff} currency={base} tone="auto" sign="always" />}
            </Row>
          </dl>
          {summary.excludedCount > 0 && (
            <p className="mt-3 text-sm font-medium text-warning">
              Не учтено {summary.excludedCount} {pluralRu(summary.excludedCount, 'операция', 'операции', 'операций')}: они внесены в другой
              основной валюте, чем сейчас ({base}).
            </p>
          )}

          <h3 className="mt-5 text-sm font-semibold text-muted">Расходы по категориям</h3>
          {bars && bars.top.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-3">
              {bars.top.map((row) => {
                const cat = row.categoryId === null ? undefined : categories.get(row.categoryId);
                const pct = sharePercent(row.totalMinor, summary.expenseMinor);
                const color = cat && /^#[0-9a-f]{6}$/i.test(cat.color) ? cat.color : 'rgb(var(--brand))';
                return (
                  <li key={row.categoryId ?? 'none'}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <span aria-hidden="true">{cat?.icon ?? '➖'} </span>
                        {cat?.name ?? 'Без категории'}
                      </span>
                      <span className="shrink-0">
                        <span className="money font-semibold">{formatMinor(row.totalMinor, base)}</span>
                        <span className="ml-2 text-muted">{pct}%</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
                    </div>
                  </li>
                );
              })}
              {bars.restCount > 0 && (
                <li className="flex items-baseline justify-between gap-3 text-sm text-muted">
                  <span>
                    ещё {bars.restCount} {pluralRu(bars.restCount, 'категория', 'категории', 'категорий')}
                  </span>
                  <span className="money font-semibold">{formatMinor(bars.restMinor, base)}</span>
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">В этом месяце расходов нет.</p>
          )}
        </>
      )}
    </Card>
  );
}
