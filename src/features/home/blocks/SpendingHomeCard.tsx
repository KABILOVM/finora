import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { summarizeDay, summarizeMonth, useStore } from '@/db';
import type { Category, CurrencyCode, IsoDate, LocalRow } from '@/domain/types';
import { cn } from '@/lib/cn';
import { monthKey } from '@/lib/dates';
import { HomeMoney } from '../hideAmounts';
import { blockCardClass, BlockBusy, BlockEmpty, BlockTitle, MiniBar } from './BlockParts';
import { topSpending } from './spending';

/** Сколько статей расходов показываем: во всю ширину и в половину. */
export const SPENDING_ROWS = 3;
export const SPENDING_ROWS_HALF = 1;

export interface SpendingHomeCardProps {
  today: IsoDate;
  base: CurrencyCode;
  categories: ReadonlyMap<string, LocalRow<Category>>;
  /** Блок стоит в половину ширины: одна главная статья вместо трёх. */
  half?: boolean;
}

/**
 * Блок «Расходы за месяц» на «Главной» (по умолчанию скрыт, включается в настройке главной): сколько потрачено в этом месяце и
 * сегодня и на что ушло больше всего (категории вместе с подкатегориями). Суммы — по снимкам в основной валюте, как в капсулах
 * «Всего». Заголовок ведёт в «Аналитику».
 */
export default function SpendingHomeCard({ today, base, categories, half = false }: SpendingHomeCardProps) {
  const store = useStore();
  const month = monthKey(today);
  const data = useLiveQuery(async () => {
    const rows = await store.db.transactions.where('occurredOn').between(`${month}-01`, `${month}-31`, true, true).toArray();
    try {
      const m = summarizeMonth(rows, month, base);
      const day = summarizeDay(
        rows.filter((t) => t.occurredOn === today),
        base,
      );
      return { expenseMinor: m.expenseMinor, todayMinor: day.expenseMinor, rows: topSpending(m.byCategory, categories, SPENDING_ROWS) };
    } catch (e) {
      if (e instanceof RangeError) return null; // суммы не помещаются в расчёт: честно скажем об этом
      throw e;
    }
  }, [store, month, today, base, categories]);

  const rows = data?.rows.slice(0, half ? SPENDING_ROWS_HALF : SPENDING_ROWS) ?? [];
  return (
    <Card aria-labelledby="home-spending" data-testid="spending-card" className={blockCardClass(half)}>
      <BlockTitle id="home-spending" to="/analytics" icon="expense" tone="bg-expense/10 text-expense" label="Расходы за месяц: открыть аналитику" half={half}>
        {half ? 'Расходы' : 'Расходы за месяц'}
      </BlockTitle>
      {data === undefined ? (
        <BlockBusy />
      ) : data === null ? (
        <p className="mt-1.5 text-sm text-muted">Суммы слишком большие, проверьте данные.</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span
              data-testid="spending-month"
              className={cn('min-w-0 max-w-full truncate font-extrabold leading-tight tracking-tight', half ? 'text-[clamp(1.125rem,5.4vw,1.5rem)]' : 'text-[clamp(1.375rem,6.5vw,1.75rem)]')}
            >
              <HomeMoney minor={data.expenseMinor} currency={base} tone="none" animated />
            </span>
            <span data-testid="spending-today" className="text-sm text-muted">
              сегодня <HomeMoney minor={data.todayMinor} currency={base} tone="none" className="font-semibold text-text" />
            </span>
          </p>
          {rows.length === 0 ? (
            <BlockEmpty text="В этом месяце расходов пока нет." to="/transactions" action="Все операции" />
          ) : (
            <ul className="mt-2 flex flex-col gap-2" aria-label="На что ушло больше всего">
              {rows.map((r, i) => (
                <li key={r.key} style={{ '--i': i } as React.CSSProperties} className="pop-spring" data-testid="spending-row">
                  <div className="flex items-center gap-2">
                    <Glyph value={r.icon} color={r.color ?? undefined} size={24} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-muted">{r.percent}%</span>
                    {!half && <HomeMoney minor={r.totalMinor} currency={base} tone="none" className="shrink-0 text-sm font-semibold" />}
                  </div>
                  <MiniBar percent={r.percent} color={r.color} className="mt-1.5" />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
