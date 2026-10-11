/** Сортировка русских текстов — только через Intl.Collator('ru') (ё, регистр, цифры в названиях учитываются правильно). */
const collator = new Intl.Collator('ru', { numeric: true });

export const compareRu = (a: string, b: string): number => collator.compare(a, b);

/** По полю sortOrder, при равенстве — по названию, при равенстве названий — по id (порядок определён полностью). */
export function sortByOrderThenName<T extends { sortOrder: number; name: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const byName = compareRu(a.name, b.name);
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
