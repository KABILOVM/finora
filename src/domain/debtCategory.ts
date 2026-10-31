/**
 * Категория долга — короткий свободный текст («Друзья», «Кредит»). Чистые функции: без базы и React.
 * Хранится в Debt.category; '' — без категории. Список категорий для выбора и фильтра собирается из уже заведённых долгов
 * плюс готовые подсказки, отдельной таблицы категорий долгов нет.
 */

/** Не длиннее — иначе строка списка и чип выбора ломают вёрстку (и база отклонит длиннее). */
export const DEBT_CATEGORY_MAX = 40;

/** Готовые подсказки при первом долге: человек выбирает из них или пишет свою. */
export const DEBT_CATEGORY_PRESETS: readonly string[] = ['Друзья', 'Семья', 'Работа', 'Кредит', 'Рассрочка'];

/** Пробелы по краям убираем, внутри схлопываем в один; пусто — ''. Длиннее DEBT_CATEGORY_MAX — обрезаем. */
export function normalizeDebtCategory(raw: string): string {
  const text = raw.replace(/[\s  ]+/g, ' ').trim();
  return Array.from(text).slice(0, DEBT_CATEGORY_MAX).join('').trim();
}

/** Ключ для сравнения: без регистра и «ё» — «Друзья» и «друзья» это одна категория. */
export const debtCategoryKey = (name: string): string => normalizeDebtCategory(name).toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Подходит ли категория долга к выбранному значению фильтра: '' — любая, NO_DEBT_CATEGORY — «без категории». */
export const NO_DEBT_CATEGORY = '__none__';

export function matchesDebtCategory(debtCategory: string, filter: string): boolean {
  if (filter === '') return true;
  if (filter === NO_DEBT_CATEGORY) return normalizeDebtCategory(debtCategory) === '';
  return debtCategoryKey(debtCategory) === debtCategoryKey(filter);
}

/**
 * Категории для выбора и фильтра: сначала те, что уже есть у долгов (чаще встречающиеся выше, при равенстве — по алфавиту),
 * затем готовые подсказки, которых ещё нет. Регистр не различается; первая встреченная запись задаёт написание.
 */
export function debtCategoryOptions(used: readonly string[], presets: readonly string[] = DEBT_CATEGORY_PRESETS): string[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const raw of used) {
    const name = normalizeDebtCategory(raw);
    if (name === '') continue;
    const key = debtCategoryKey(name);
    const cur = count.get(key);
    if (cur) cur.n++;
    else count.set(key, { name, n: 1 });
  }
  const own = [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ru')).map((c) => c.name);
  const rest = presets.filter((p) => !count.has(debtCategoryKey(p)));
  return [...own, ...rest];
}

/** Категории, которые уже есть у долгов (без подсказок) — для фильтра: пустых вариантов в нём быть не должно. */
export function usedDebtCategories(used: readonly string[]): string[] {
  return debtCategoryOptions(used, []);
}
