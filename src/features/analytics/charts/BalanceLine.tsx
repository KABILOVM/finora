import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { sparkPath } from '@/features/home/homeData';
import { monthShort } from '../analytics';
import type { MonthBalance } from '../netWorth';

const W = 300;
const H = 80;

/**
 * Деньги в кошельках по месяцам: плавная линия с заливкой. Рисунок для глаз (role="img"), а те же числа — таблицей для скринридера.
 * Под линией подписаны первый и последний месяц, чтобы было понятно, за какой срок график.
 */
export function BalanceLine({ points, base }: { points: readonly MonthBalance[]; base: CurrencyCode }) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const { d, lastY } = sparkPath(points.map((p) => p.balanceMinor), W, H);
  return (
    <div>
      <div className="relative text-brand">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Деньги в кошельках по месяцам" className="block h-auto w-full overflow-visible" data-testid="balance-line">
          <defs>
            <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${W} ${H} L0 ${H}Z`} fill="url(#balance-fill)" />
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          aria-hidden="true"
          className="absolute right-0 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-current"
          style={{ top: `${(lastY / H) * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{monthShort(first.month)}</span>
        <span className="font-semibold text-text">{monthShort(last.month)}</span>
      </div>
      <table className="sr-only">
        <caption>Деньги в кошельках по месяцам</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <th scope="row">{p.month}</th>
              <td>{formatMinor(p.balanceMinor, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
