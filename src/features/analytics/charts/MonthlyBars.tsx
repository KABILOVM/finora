import { MoneyText } from '@/components/MoneyText';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { monthTitle } from '@/lib/dates';
import { monthShort, type MonthPoint } from '../analytics';

const W = 300;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 76;

export interface MonthlyBarsProps {
  points: readonly MonthPoint[];
  base: CurrencyCode;
  /** Нажатие на подпись месяца под столбиками: показать этот месяц (то же, что стрелки над экраном). */
  onSelect?: (month: string) => void;
}

/**
 * Доходы и расходы по месяцам: у каждого месяца два столбика (доход — зелёный, расход — красный). Выбранный месяц (последний) ярче и
 * подписан числами под графиком (на телефоне по столбикам цифр не прочесть); месяцы под графиком — кнопки по 44 px, нажатие
 * переключает месяц. Рисунок для глаз (role="img"), а те же числа лежат таблицей для скринридера.
 */
export function MonthlyBars({ points, base, onSelect }: MonthlyBarsProps) {
  const n = Math.max(points.length, 1);
  const selected = points[points.length - 1];
  const scale = Math.max(1, ...points.flatMap((p) => [p.incomeMinor, p.expenseMinor]));
  const groupW = W / n;
  const barW = Math.min(groupW * 0.3, 22);
  const height = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / scale) * (PLOT_BOTTOM - PLOT_TOP)));
  return (
    // -mx-2: при 320 px в карточке остаётся 256 px, на шесть кнопок по 42,7 — меньше 44; расширяем ряд (и столбики над ним) на поля карточки
    <div className="-mx-2">
      <svg viewBox={`0 0 ${W} 80`} role="img" aria-label="Доходы и расходы по месяцам" className="block h-auto w-full" data-testid="monthly-bars">
        <line x1="0" x2={W} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} className="stroke-border" strokeWidth="1" />
        {points.map((p, i) => {
          const cx = groupW * i + groupW / 2;
          const last = i === points.length - 1;
          const hi = height(p.incomeMinor);
          const he = height(p.expenseMinor);
          return (
            <g key={p.month} opacity={last ? 1 : 0.55}>
              <rect data-testid={`bar-income-${p.month}`} x={cx - barW - 1} y={PLOT_BOTTOM - hi} width={barW} height={hi} rx="3" className="fill-income" />
              <rect data-testid={`bar-expense-${p.month}`} x={cx + 1} y={PLOT_BOTTOM - he} width={barW} height={he} rx="3" className="fill-expense" />
            </g>
          );
        })}
      </svg>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="group" aria-label="Месяцы">
        {points.map((p, i) => {
          const last = i === points.length - 1;
          return (
            <button
              key={p.month}
              type="button"
              aria-pressed={last}
              aria-label={monthTitle(p.month)}
              onClick={() => onSelect?.(p.month)}
              className={`min-h-[44px] rounded-control text-xs transition-colors hover:bg-surface-2 ${last ? 'font-semibold text-text' : 'text-muted'}`}
            >
              {monthShort(p.month)}
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="mt-1 text-sm text-muted" data-testid="monthly-selected">
          {monthTitle(selected.month)}: доходы <MoneyText minor={selected.incomeMinor} currency={base} tone="income" /> · расходы{' '}
          <MoneyText minor={selected.expenseMinor} currency={base} tone="expense" /> · разница{' '}
          <MoneyText minor={selected.netMinor} currency={base} tone="auto" sign="always" />
        </p>
      )}
      <div className="mt-1 flex items-center justify-center gap-4 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-income" /> Доходы
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-expense" /> Расходы
        </span>
      </div>
      <table className="sr-only">
        <caption>Доходы и расходы по месяцам</caption>
        <thead>
          <tr>
            <th scope="col">Месяц</th>
            <th scope="col">Доходы</th>
            <th scope="col">Расходы</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{p.month}</th>
              <td>{formatMinor(p.incomeMinor, base)}</td>
              <td>{formatMinor(p.expenseMinor, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
