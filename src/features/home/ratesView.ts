import type { CurrencyCode } from '@/domain/types';
import { formatNumber } from '@/features/converter/convert';

/** Какие валюты показываем на «Главной» (к основной валюте): доллар и рубль; если основная — одна из них, на её место встаёт евро. */
const WIDGET_CANDIDATES: readonly CurrencyCode[] = ['USD', 'RUB', 'EUR'];
export const RATES_WIDGET_COUNT = 2;

export function widgetCurrencies(base: CurrencyCode): CurrencyCode[] {
  return WIDGET_CANDIDATES.filter((c) => c !== base).slice(0, RATES_WIDGET_COUNT);
}

/** Сколько единиц валюты брать, чтобы число в курсе читалось: «1 $ = 10,95», но «100 ₽ = 12,10», а не «1 ₽ = 0,1210». */
const UNIT_STEPS: readonly number[] = [10, 100, 1000, 10_000, 100_000];
const MAX_UNITS = 100_000;
const READABLE_FROM = 5;

export interface ScaledRate {
  units: number;
  value: number;
}

export function scaleRate(rate: number): ScaledRate {
  if (!Number.isFinite(rate) || rate <= 0) return { units: 1, value: rate };
  if (rate >= 1) return { units: 1, value: rate };
  for (const units of UNIT_STEPS) {
    if (rate * units >= READABLE_FROM) return { units, value: rate * units };
  }
  return { units: MAX_UNITS, value: rate * MAX_UNITS };
}

/** «1» → «1», «1000» → «1 000» (неразрывный пробел, как в остальном приложении). */
export function formatUnits(units: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(units);
}

/** Число курса на «Главной»: всегда две цифры после запятой. */
export function formatWidgetRate(value: number): string {
  return formatNumber(value, 2);
}

/** ГГГГ-ММ-ДД → «ДД.ММ». Непонятная дата возвращается как есть. */
export function shortAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}` : iso;
}
