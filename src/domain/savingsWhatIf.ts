import { isMinor } from './money';
import type { CategoryAdvice } from './savingsPlan';
import type { Minor, UUID } from './types';

/**
 * «Что если сократить» — ЧИСТЫЕ функции: на сколько раньше накопятся цели, если часть привычных трат категории откладывать сверх плана.
 * База сравнения — план: каждый месяц откладывается ровно месячная потребность. Добавка extra сокращает срок с remaining/monthly до
 * remaining/(monthly+extra) месяцев. Целочисленно (BigInt), месяц — 30,4375 дня (365,25 ÷ 12), вниз: не обещаем больше, чем есть.
 */

/** На сколько процентов предлагаем сократить трату. */
export const WHATIF_PERCENTS = [10, 20, 30] as const;
export type WhatIfPercent = (typeof WHATIF_PERCENTS)[number];

/** Сколько категорий показываем: самые крупные необязательные. */
export const WHATIF_ROWS = 3;

/** Дней, на которые цели накопятся раньше. 0 — нечего считать (нечего копить, нет плана или добавки). */
export function daysEarlier(remainingMinor: Minor, monthlyMinor: Minor, extraMonthlyMinor: Minor): number {
  if (![remainingMinor, monthlyMinor, extraMonthlyMinor].every(isMinor)) return 0;
  if (remainingMinor <= 0 || monthlyMinor <= 0 || extraMonthlyMinor <= 0) return 0;
  const num = BigInt(remainingMinor) * BigInt(extraMonthlyMinor) * 36525n;
  const den = BigInt(monthlyMinor) * (BigInt(monthlyMinor) + BigInt(extraMonthlyMinor)) * 1200n;
  return Number(num / den);
}

export interface WhatIfRow {
  categoryId: UUID;
  percent: number;
  /** Сколько в месяц освободится (процент от привычных трат за месяц, вниз). */
  extraMonthlyMinor: Minor;
  daysEarlier: number;
}

/**
 * Строки «Что если»: необязательные категории с привычными тратами, самые крупные первыми, не больше `limit`. Строка без выигрыша
 * хотя бы в день тоже остаётся (сумма освободится, но срок почти не сдвинется) — это честнее, чем прятать её.
 */
export function whatIfRows(
  categories: readonly Pick<CategoryAdvice, 'categoryId' | 'essential' | 'usualMonthlyMinor'>[],
  percent: number,
  remainingMinor: Minor,
  monthlyNeedMinor: Minor,
  limit: number = WHATIF_ROWS,
): WhatIfRow[] {
  if (remainingMinor <= 0 || monthlyNeedMinor <= 0 || !(percent > 0)) return [];
  return categories
    .filter((c) => !c.essential && c.usualMonthlyMinor > 0)
    .sort((a, b) => b.usualMonthlyMinor - a.usualMonthlyMinor || (a.categoryId < b.categoryId ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((c) => {
      const extra = Number((BigInt(c.usualMonthlyMinor) * BigInt(Math.floor(percent))) / 100n);
      return { categoryId: c.categoryId, percent, extraMonthlyMinor: extra, daysEarlier: daysEarlier(remainingMinor, monthlyNeedMinor, extra) };
    })
    .filter((r) => r.extraMonthlyMinor > 0);
}
