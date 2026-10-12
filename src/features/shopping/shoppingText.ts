import { UNIT_LABEL } from '@/domain/shopping';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, Minor, ShoppingUnit } from '@/domain/types';

/** Цена товара: всегда с копейками, как на ценнике: «26,00 с.». */
export const priceText = (minor: Minor, currency: CurrencyCode): string => formatMinor(minor, currency, { fraction: 'always' });

/** Ожидаемая цена: «≈ 18,00 с.». */
export const approxText = (minor: Minor, currency: CurrencyCode): string => `≈ ${priceText(minor, currency)}`;

/** Цена за единицу под ценой отмеченной позиции: «13,00 за л». */
export const perUnitText = (minor: Minor, unit: ShoppingUnit, currency: CurrencyCode): string =>
  `${formatMinor(minor, currency, { fraction: 'always', symbol: false })} за ${UNIT_LABEL[unit]}`;

/** Запомненная цена под названием: «13,00 с./л». */
export const rememberedText = (minor: Minor, unit: ShoppingUnit, currency: CurrencyCode): string =>
  `${priceText(minor, currency)}/${UNIT_LABEL[unit]}`;
