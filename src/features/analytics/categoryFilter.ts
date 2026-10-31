import type { FilterOption } from '@/components/filters/filterState';
import { categoryCovers } from '@/domain/budgetLevels';
import type { UUID } from '@/domain/types';

/**
 * Фильтр «Аналитики» по категории расходов (чистая логика). Он сужает только списки, где категория что-то значит:
 * «Категории: сравнение с прошлым месяцем» и «Самые крупные расходы». Сводка месяца, темп, график по месяцам и дни недели
 * остаются по всем расходам. Выбранная категория охватывает и свои подкатегории (как лимит в «Бюджетах»).
 */

type SpendRow = { categoryId: UUID | null; kind?: 'fee' };

/** Категория, которой можно фильтровать: известная (живая или архивная — у старых трат), иначе фильтра нет (null). */
export function effectiveCategory(asked: string | null, known: ReadonlySet<UUID>): UUID | null {
  return asked !== null && known.has(asked) ? asked : null;
}

/**
 * Подходит ли расход в категории `categoryId` под фильтр `filterId`. Без фильтра — любой. Комиссии переводов и «без категории»
 * (categoryId === null) при включённом фильтре не подходят.
 */
export function inCategoryFilter(filterId: UUID | null, categoryId: UUID | null, parentOf: ReadonlyMap<UUID, UUID | null>): boolean {
  if (filterId === null) return true;
  return categoryId !== null && categoryCovers(filterId, categoryId, parentOf);
}

/** Строки расходов по категориям под фильтром (комиссии при включённом фильтре отбрасываются). Без фильтра — как есть. */
export function filterSpendRows<T extends SpendRow>(rows: readonly T[], filterId: UUID | null, parentOf: ReadonlyMap<UUID, UUID | null>): T[] {
  if (filterId === null) return [...rows];
  return rows.filter((r) => r.kind !== 'fee' && inCategoryFilter(filterId, r.categoryId, parentOf));
}

/**
 * Варианты выбора: категории, по которым были расходы в этом или прошлом месяце, по названию. Выбранная категория остаётся в списке,
 * даже если трат по ней нет (ссылка или смена месяца), иначе выбор исчез бы молча.
 */
export function categoryFilterOptions(
  spendRows: readonly SpendRow[],
  names: ReadonlyMap<UUID, { name: string }>,
  selected: UUID | null,
): FilterOption[] {
  const ids = new Set<UUID>();
  for (const r of spendRows) if (r.kind !== 'fee' && r.categoryId !== null) ids.add(r.categoryId);
  if (selected !== null) ids.add(selected);
  return [...ids]
    .map((id) => ({ value: id, label: names.get(id)?.name ?? 'Категория удалена' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru') || (a.value < b.value ? -1 : 1));
}
