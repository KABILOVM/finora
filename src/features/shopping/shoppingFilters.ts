import type { FilterField, FilterValues } from '@/components/filters/filterState';
import { valueOf } from '@/components/filters/filterState';
import { SHOPPING_UNITS, UNIT_LABEL, type ItemView } from '@/domain/shopping';
import type { ShoppingItem, ShoppingUnit } from '@/domain/types';

/**
 * Фильтры списка покупок (чистая логика). Категорий у позиций нет (только название, количество, единица и цена), поэтому
 * фильтруем по состоянию — «В списке» (ещё не в корзине), «В корзине», «Куплено» (прошлые покупки) — и по единице.
 */

export type ShoppingState = 'list' | 'cart' | 'bought';

/** Сколько прошлых покупок показываем под фильтром «Куплено»: история растёт без предела. */
export const BOUGHT_MAX = 100;

const STATE_LABEL: Record<ShoppingState, string> = { list: 'В списке', cart: 'В корзине', bought: 'Куплено' };

/** Купленные позиции, свежие первыми (при равенстве — по id, чтобы порядок не прыгал). */
export function boughtItems<T extends ShoppingItem>(all: readonly T[]): T[] {
  return all
    .filter((i) => i.deletedAt === null && i.purchasedAt !== null)
    .sort((a, b) => ((a.purchasedAt as string) !== (b.purchasedAt as string) ? ((a.purchasedAt as string) < (b.purchasedAt as string) ? 1 : -1) : a.id < b.id ? -1 : 1));
}

/**
 * Поля фильтра: состояние («Куплено» — только когда покупки были) и единица (только те, что есть, и если их больше одной).
 * Нечего выбирать (одна позиция и ни одной покупки) — полей нет.
 */
export function shoppingFilterFields(views: readonly ItemView[], bought: readonly ShoppingItem[]): FilterField[] {
  if (views.length + bought.length < 2) return [];
  const states: ShoppingState[] = bought.length > 0 ? ['list', 'cart', 'bought'] : ['list', 'cart'];
  const units = SHOPPING_UNITS.filter((u) => views.some((v) => v.item.unit === u) || bought.some((b) => b.unit === u));
  const fields: FilterField[] = [{ key: 'state', label: 'Состояние', type: 'chips', anyLabel: 'Все активные', options: states.map((s) => ({ value: s, label: STATE_LABEL[s] })) }];
  if (units.length > 1) fields.push({ key: 'unit', label: 'Единица', type: 'chips', anyLabel: 'Любая', options: units.map((u: ShoppingUnit) => ({ value: u, label: UNIT_LABEL[u] })) });
  return fields;
}

/** Выбрано «Куплено»: вместо списка показываются прошлые покупки. */
export const showsBought = (values: FilterValues): boolean => valueOf(values, 'state') === 'bought';

/** Позиции списка под выбор: состояние «В списке» — не отмечены, «В корзине» — отмечены; единица. «Куплено» к активному списку не относится. */
export function filterViews(views: readonly ItemView[], values: FilterValues): ItemView[] {
  const state = valueOf(values, 'state');
  const unit = valueOf(values, 'unit');
  return views.filter((v) => (state !== 'list' || !v.checked) && (state !== 'cart' || v.checked) && (unit === '' || v.item.unit === unit));
}

/** Прошлые покупки под выбор единицы (порядок сохраняется). */
export function filterBought<T extends ShoppingItem>(bought: readonly T[], values: FilterValues): T[] {
  const unit = valueOf(values, 'unit');
  return unit === '' ? [...bought] : bought.filter((b) => b.unit === unit);
}
