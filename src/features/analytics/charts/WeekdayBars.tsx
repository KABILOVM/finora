import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { WEEKDAYS_DATIVE_PLURAL, WEEKDAYS_SHORT_MON_FIRST, type WeekdayPoint } from '../analytics';

const W = 300;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 62;

/** День недели с самым большим средним расходом (раньше в неделе — при равенстве); null — расходов нет. */
export function busiestWeekday(points: readonly WeekdayPoint[]): WeekdayPoint | null {
  let best: WeekdayPoint | null = null;
  for (const p of points) if (p.avgMinor > 0 && (best === null || p.avgMinor > best.avgMinor)) best = p;
  return best;
}

/** Средний расход по дням недели: семь столбиков, самый высокий выделен; число — одной строкой под графиком, таблица — для скринридера. */
export function WeekdayBars({ points, base }: { points: readonly WeekdayPoint[]; base: CurrencyCode }) {
  const best = busiestWeekday(points);
  const scale = Math.max(1, ...points.map((p) => p.avgMinor));
  const groupW = W / 7;
  const barW = Math.min(groupW * 0.56, 28);
  return (
    <div>
      <svg viewBox={`0 0 ${W} 80`} role="img" aria-label="Средний расход по дням недели" className="block h-auto w-full" data-testid="weekday-bars">
        <line x1="0" x2={W} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} className="stroke-border" strokeWidth="1" />
        {points.map((p) => {
          const cx = groupW * p.weekday + groupW / 2;
          const h = p.avgMinor <= 0 ? 0 : Math.max(2, (p.avgMinor / scale) * (PLOT_BOTTOM - PLOT_TOP));
          const top = best !== null && p.weekday === best.weekday;
          return (
            <g key={p.weekday}>
              <rect
                data-testid={`weekday-bar-${p.weekday}`}
                x={cx - barW / 2}
                y={PLOT_BOTTOM - h}
                width={barW}
                height={h}
                rx="4"
                className={top ? 'fill-brand' : 'fill-brand/40'}
              />
              <text x={cx} y="77" textAnchor="middle" fontSize="10" className={top ? 'fill-current font-semibold' : 'fill-muted'}>
                {WEEKDAYS_SHORT_MON_FIRST[p.weekday]}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-sm text-muted" data-testid="weekday-summary">
        {best === null ? (
          'Расходов в этом месяце пока нет.'
        ) : (
          <>
            Больше всего вы тратите по {WEEKDAYS_DATIVE_PLURAL[best.weekday]}: в среднем{' '}
            <span className="money font-semibold text-text">{formatMinor(best.avgMinor, base)}</span> в такой день.
          </>
        )}
      </p>
      <table className="sr-only">
        <caption>Средний расход по дням недели</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.weekday}>
              <th scope="row">{WEEKDAYS_SHORT_MON_FIRST[p.weekday]}</th>
              <td>{formatMinor(p.avgMinor, base)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
