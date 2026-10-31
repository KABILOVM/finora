import type { FilterField, FilterValues } from '@/components/filters/filterState';
import { valueOf } from '@/components/filters/filterState';
import type { BudgetProgress } from '@/domain/budgetProgress';
import type { Category, UUID } from '@/domain/types';
import { budgetLabel } from './budgetText';

/**
 * Фильтры списка лимитов (чистая логика, без React): по категории лимита и по уровню. Сводка «В норме / Внимание / Исчерпано»
 * над списком считается по ВСЕМ лимитам, фильтр сужает только сам список.
 */

/** Значение фильтра категории для общего лимита («Все расходы»): у него нет categoryId. */
export const TOTAL_LIMIT = '__total__';

/** Уровни для фильтра: «Внимание» — это и 70–89 %, и «почти исчерпан» (как в сводке); «Другая валюта» — лимит не сравнить с тратами. */
export type LevelBucket = 'ok' | 'warn' | 'over' | 'other';

export const LEVEL_BUCKET_LABEL: Record<LevelBucket, string> = {
  ok: 'В норме',
  warn: 'Внимание',
  over: 'Исчерпано',
  other: 'В другой валюте',
};

const BUCKET_ORDER: readonly LevelBucket[] = ['ok', 'warn', 'over', 'other'];

export function levelBucket(p: BudgetProgress): LevelBucket {
  if (!p.comparable) return 'other';
  if (p.level === 'ok') return 'ok';
  if (p.level === 'over') return 'over';
  return 'warn';
}

export interface FilterableBudget {
  id: UUID;
  categoryId: UUID | null;
}

/**
 * Поля фильтра под нынешние лимиты: в списке категорий только те, у которых есть лимит (плюс «Все расходы» — общий лимит);
 * уровни — «В норме / Внимание / Исчерпано» всегда (+ «В другой валюте», если такой лимит есть). Меньше двух лимитов —
 * фильтровать нечего, полей нет.
 */
export function budgetFilterFields(
  budgets: readonly FilterableBudget[],
  progressById: ReadonlyMap<UUID, BudgetProgress>,
  categories: ReadonlyMap<UUID, Pick<Category, 'name' | 'icon' | 'color'>>,
): FilterField[] {
  if (budgets.length < 2) return [];
  const seen = new Set<string>();
  const categoryOptions: { value: string; label: string }[] = [];
  for (const b of budgets) {
    const value = b.categoryId ?? TOTAL_LIMIT;
    if (seen.has(value)) continue;
    seen.add(value);
    categoryOptions.push({ value, label: budgetLabel(b.categoryId, categories).name });
  }
  // общий лимит первым, остальные по названию
  categoryOptions.sort((a, b) => (a.value === TOTAL_LIMIT ? -1 : b.value === TOTAL_LIMIT ? 1 : a.label.localeCompare(b.label, 'ru')));

  // Три основных уровня есть всегда: уровень меняется с тратами и месяцем, и выбор не должен слетать при смене месяца.
  // «В другой валюте» — только когда такой лимит есть.
  const foreign = budgets.some((b) => {
    const p = progressById.get(b.id);
    return p !== undefined && !p.comparable;
  });
  const levelOptions = BUCKET_ORDER.filter((k) => k !== 'other' || foreign).map((k) => ({ value: k, label: LEVEL_BUCKET_LABEL[k] }));

  const fields: FilterField[] = [];
  if (categoryOptions.length > 1) fields.push({ key: 'category', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: categoryOptions });
  fields.push({ key: 'level', label: 'Состояние лимита', type: 'chips', anyLabel: 'Любое', options: levelOptions });
  return fields;
}

/** Лимиты, подходящие под выбор. Пустой выбор — все; порядок сохраняется. Лимит без расчёта (нет в progressById) по уровню не проходит. */
export function filterBudgets<T extends FilterableBudget>(
  budgets: readonly T[],
  progressById: ReadonlyMap<UUID, BudgetProgress>,
  values: FilterValues,
): T[] {
  const category = valueOf(values, 'category');
  const level = valueOf(values, 'level');
  return budgets.filter((b) => {
    if (category !== '' && (b.categoryId ?? TOTAL_LIMIT) !== category) return false;
    if (level !== '') {
      const p = progressById.get(b.id);
      if (!p || levelBucket(p) !== level) return false;
    }
    return true;
  });
}
