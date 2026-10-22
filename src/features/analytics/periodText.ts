import type { IsoDate } from '@/domain/types';
import { ruDate } from '@/features/transactions/txForm';
import { quarterOf, type Period } from './periods';

/** «2026 год», «3-й квартал 2026», «01.03.2026 — 15.04.2026». Идущий год и квартал — «по сегодня». */
export function periodTitle(p: Period): string {
  if (p.kind === 'year') return `${p.from.slice(0, 4)} год`;
  if (p.kind === 'quarter') return `${quarterOf(p.from).quarter}-й квартал ${p.from.slice(0, 4)}`;
  return `${ruDate(p.from)} — ${ruDate(p.to)}`;
}

/** Даты периода: «01.01.2026 — 15.10.2026». */
export const rangeText = (r: { from: IsoDate; to: IsoDate }): string => `${ruDate(r.from)} — ${ruDate(r.to)}`;

/**
 * Изменение в процентах от прежнего значения, целым; null — сравнивать не с чем (прежнего нет или ноль).
 * Округление «от нуля»: 12,5% → 13%.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(previous) || previous <= 0) return null;
  const diff = BigInt(current) - BigInt(previous);
  const t = BigInt(previous);
  const p = diff * 100n;
  const half = t / 2n;
  return Number(p >= 0n ? (p + half) / t : -((-p + half) / t));
}

/** «▲ +12%», «▼ −8%», «без изменений»; null — сравнивать не с чем. */
export function changeText(current: number, previous: number): string | null {
  const pct = percentChange(current, previous);
  if (pct === null) return null;
  if (pct === 0) return 'без изменений';
  return pct > 0 ? `▲ +${pct}%` : `▼ −${-pct}%`;
}
