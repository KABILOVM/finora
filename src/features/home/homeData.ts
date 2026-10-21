import { addMinor } from '@/domain/money';
import { summarizeDay } from '@/db/queries';
import { addDays } from '@/lib/dates';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';

/** Чистые расчёты для главной (без React и базы). */

type DayTx = Parameters<typeof summarizeDay>[0][number];

/**
 * Остаток по дням для графика: от сегодняшнего итога назад. За день деньги на руках меняются на «доходы − расходы»
 * плюс движение по долгам (по снимкам суммы в базовой валюте). Возвращает days + 1 точку: от самой старой к сегодняшней.
 * Бросает RangeError, если суммы не помещаются в безопасное целое (экран тогда просто не рисует график).
 */
export function balanceSeries(
  txs: readonly DayTx[],
  endMinor: Minor,
  today: IsoDate,
  days: number,
  base: CurrencyCode,
): Minor[] {
  const byDay = new Map<IsoDate, DayTx[]>();
  for (const t of txs) {
    const list = byDay.get(t.occurredOn);
    if (list) list.push(t);
    else byDay.set(t.occurredOn, [t]);
  }
  const out: Minor[] = [];
  let balance = endMinor;
  for (let i = 0; i <= days; i++) {
    out.unshift(balance);
    const day = summarizeDay(byDay.get(addDays(today, -i)) ?? [], base);
    balance = addMinor(balance, -addMinor(addMinor(day.netMinor, day.debtFlowMinor), day.adjustmentFlowMinor));
  }
  return out;
}

/** Сглаженная линия по точкам для SVG 300×90: путь и высота последней точки (для маркера). */
export function sparkPath(points: readonly number[], width = 300, height = 90): { d: string; lastY: number } {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const pts = points.map((v, i): [number, number] => [
    (i / Math.max(1, points.length - 1)) * width,
    span === 0 ? height / 2 : height - 10 - ((v - min) / span) * (height - 26),
  ]);
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)]!;
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[i + 1]!;
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)]!;
    d += ` C${f(x1 + (x2 - x0) / 6)} ${f(y1 + (y2 - y0) / 6)} ${f(x2 - (x3 - x1) / 6)} ${f(y2 - (y3 - y1) / 6)} ${f(x2)} ${f(y2)}`;
  }
  return { d, lastY: pts[pts.length - 1]![1] };
}
