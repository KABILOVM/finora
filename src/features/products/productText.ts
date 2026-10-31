import { formatMinor } from '@/domain/money';
import type { ProductStats } from '@/domain/products/stats';
import { UNIT_LABEL } from '@/domain/shopping';
import type { CurrencyCode, Minor, ShoppingUnit } from '@/domain/types';

/** «12,00 с.» — цена с копейками, как на ценнике. */
export const moneyText = (minor: Minor, currency: CurrencyCode): string => formatMinor(minor, currency, { fraction: 'always' });

/** Строка под названием продукта: «Последняя 12,00 с. · средняя 11,00 с. за кг» или «Цены пока нет · за кг». */
export function priceLine(stats: ProductStats | null, unit: ShoppingUnit, currency: CurrencyCode): string {
  if (stats === null) return `Цены пока нет · за ${UNIT_LABEL[unit]}`;
  return `Последняя ${moneyText(stats.lastUnitMinor, currency)} · средняя ${moneyText(stats.avgUnitMinor, currency)} за ${UNIT_LABEL[stats.unit]}`;
}

/** Пояснение к средней цене: по чему она посчитана. */
export function averageBasisText(stats: ProductStats): string {
  return stats.avgBasis === 'days'
    ? `по покупкам за последние 90 дней (${stats.avgCount})`
    : `по последним покупкам (${stats.avgCount}): за 90 дней покупок не было`;
}

/** «31 окт.» / «31 окт. 2025» — дата покупки из метки времени. */
export function purchaseDate(at: string, now = new Date()): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
