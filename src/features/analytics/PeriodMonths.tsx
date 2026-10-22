import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { monthTitle } from '@/lib/dates';
import { monthShort, type MonthPoint } from './analytics';

const W = 300;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 76;

/** Подписывать каждый N-й месяц (считая от последнего, он подписан всегда), чтобы подписи не слипались: до 6 месяцев — все, до 12 — через один, дальше — около пяти подписей. */
export const labelStep = (n: number): number => (n <= 6 ? 1 : n <= 12 ? 2 : Math.ceil(n / 5));

/** Подпись месяца: «янв»; в периоде длиннее года — с годом («янв ’26»): иначе не понять, какой это январь. */
export const monthLabel = (month: string, n: number): string => (n > 12 ? `${monthShort(month)} ’${month.slice(2, 4)}` : monthShort(month));

export interface PeriodMonthsProps {
  points: readonly MonthPoint[];
  base: CurrencyCode;
}

/**
 * Доходы и расходы по месяцам периода: у каждого месяца два столбика. Неподвижная картинка (role="img") с таблицей для скринридера;
 * без кнопок под столбиками — их было бы не уместить, когда месяцев больше шести. Крайние месяцы могут быть неполными.
 */
export function PeriodMonths({ points, base }: PeriodMonthsProps) {
  const n = Math.max(points.length, 1);
  const step = labelStep(n);
  const scale = Math.max(1, ...points.flatMap((p) => [p.incomeMinor, p.expenseMinor]));
  const groupW = W / n;
  const barW = Math.min(groupW * 0.3, 22);
  const height = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / scale) * (PLOT_BOTTOM - PLOT_TOP)));
  return (
    <div data-testid="period-months">
      <svg viewBox={`0 0 ${W} 80`} role="img" aria-label="Доходы и расходы по месяцам периода" className="block h-auto w-full">
        <line x1="0" x2={W} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} className="stroke-border" strokeWidth="1" />
        {points.map((p, i) => {
          const cx = groupW * i + groupW / 2;
          const hi = height(p.incomeMinor);
          const he = height(p.expenseMinor);
          return (
            <g key={p.month}>
              <rect x={cx - barW - 0.5} y={PLOT_BOTTOM - hi} width={barW} height={hi} rx="2" className="fill-income" />
              <rect x={cx + 0.5} y={PLOT_BOTTOM - he} width={barW} height={he} rx="2" className="fill-expense" />
            </g>
          );
        })}
      </svg>
      <div aria-hidden="true" className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {points.map((p, i) => (
          <span key={p.month} className="flex justify-center whitespace-nowrap text-xs text-muted">
            {(n - 1 - i) % step === 0 ? monthLabel(p.month, n) : ''}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-income" /> Доходы
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-expense" /> Расходы
        </span>
      </div>
      {/* sr-only на обёртке, а не на самой таблице: ширину таблицы с абсолютным положением «1px» не ограничивает, и она раздвигала страницу */}
      <div className="sr-only">
        <table>
          <caption>Доходы и расходы по месяцам периода</caption>
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
                <th scope="row">{monthTitle(p.month)}</th>
                <td>{formatMinor(p.incomeMinor, base)}</td>
                <td>{formatMinor(p.expenseMinor, base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
