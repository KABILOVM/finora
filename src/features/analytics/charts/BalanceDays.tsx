import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import type { CalendarDay } from '@/domain/cashCalendar';
import { monthShort } from '../analytics';

const W = 300;
const H = 90;

/**
 * Ступенчатая линия: остаток держится ровно до дня следующего события и тогда скачет. Сглаживать нельзя — кривая заходила бы ниже
 * настоящего минимума и рисовала бы волны там, где деньги просто лежат. Шкала по высоте та же, что у sparkPath (поля 10 и 16).
 */
function stepPath(values: readonly number[], min: number, max: number): { d: string; lastY: number } {
  const span = max - min;
  const y = (v: number) => (span === 0 ? H / 2 : H - 10 - ((v - min) / span) * (H - 26));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(x(0))} ${f(y(values[0]!))}`;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1]) d += ` H${f(x(i))} V${f(y(values[i]!))}`;
  }
  d += ` H${f(W)}`;
  return { d, lastY: y(values[values.length - 1]!) };
}

/** '2026-10-15' → «15 окт». */
export const shortDay = (date: string): string => `${Number(date.slice(8, 10))} ${monthShort(date.slice(0, 7))}`;

/**
 * Деньги на руках по дням: линия, под ней заливка; если остаток уходит в минус — пунктиром нулевая черта. Рисунок для глаз
 * (role="img"), те же числа — таблицей для скринридера.
 */
export function BalanceDays({ days, base }: { days: readonly CalendarDay[]; base: CurrencyCode }) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  const values = days.map((d) => d.balanceMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const { d, lastY } = stepPath(values, min, max);
  // та же шкала, что у sparkPath: нулевая черта на своём месте, только когда ноль внутри диапазона
  const zeroY = min < 0 && max >= 0 && max !== min ? H - 10 - ((0 - min) / (max - min)) * (H - 26) : null;
  const negative = min < 0;
  return (
    <div>
      <div className={`relative ${negative ? 'text-expense' : 'text-brand'}`}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Деньги на руках по дням" className="block h-auto w-full overflow-visible" data-testid="balance-days">
          <defs>
            <linearGradient id="days-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.26" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {zeroY !== null && <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="stroke-muted" strokeWidth="1" strokeDasharray="4 4" data-testid="zero-line" />}
          <path d={`${d} L${W} ${H} L0 ${H}Z`} fill="url(#days-fill)" />
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span aria-hidden="true" className="absolute right-0 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-current" style={{ top: `${(lastY / H) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{shortDay(first.date)}</span>
        <span>{shortDay(last.date)}</span>
      </div>
      <table className="sr-only">
        <caption>Деньги на руках по дням</caption>
        <tbody>
          {days.map((x) => (
            <tr key={x.date}>
              <th scope="row">{x.date}</th>
              <td>{formatMinor(x.balanceMinor, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
