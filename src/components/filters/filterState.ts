/**
 * Чистая логика универсальных фильтров списков (бюджеты, долги, регулярные платежи, кошельки…): без React и без базы.
 * Фильтр — набор полей; значение поля — строка, '' значит «любой». Так одно состояние подходит и для чипов, и для списка.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterField {
  /** Ключ в наборе значений. */
  key: string;
  label: string;
  /** 'chips' — когда вариантов мало (до 5-6), 'select' — когда много (категории, люди). */
  type: 'chips' | 'select';
  /** Подпись варианта «любой»: «Все категории». */
  anyLabel: string;
  options: readonly FilterOption[];
  /** Короткая подсказка под полем. */
  hint?: string;
}

/** Значения фильтров: ключ поля → выбранное значение, '' (или отсутствие) — «любой». */
export type FilterValues = Readonly<Record<string, string>>;

/** Пустой набор для данных полей: всё «любое». */
export function emptyFilters(fields: readonly FilterField[]): FilterValues {
  return Object.fromEntries(fields.map((f) => [f.key, '']));
}

/** Значение поля; неизвестное или пустое — ''. */
export const valueOf = (values: FilterValues, key: string): string => values[key] ?? '';

/** Сколько полей включено. Считаются только поля из `fields`: лишние ключи в значениях игнорируются. */
export function countFilters(fields: readonly FilterField[], values: FilterValues): number {
  let n = 0;
  for (const f of fields) if (valueOf(values, f.key) !== '') n++;
  return n;
}

/**
 * Значения, у которых выбранный вариант больше не существует (категорию удалили, человека закрыли), считаются «любым»:
 * иначе список остался бы пустым без видимой причины.
 */
export function pruneFilters(fields: readonly FilterField[], values: FilterValues): FilterValues {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = valueOf(values, f.key);
    out[f.key] = v !== '' && f.options.some((o) => o.value === v) ? v : '';
  }
  return out;
}

/** Короткие названия включённых фильтров для строки «Карта · Расходы · Еда» (в порядке полей). */
export function filterLabels(fields: readonly FilterField[], values: FilterValues): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = valueOf(values, f.key);
    if (v === '') continue;
    out.push(f.options.find((o) => o.value === v)?.label ?? f.label);
  }
  return out;
}

/** Пустой ли выбор целиком. */
export const isEmptyFilter = (fields: readonly FilterField[], values: FilterValues): boolean => countFilters(fields, values) === 0;
