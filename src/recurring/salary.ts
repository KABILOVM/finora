import type { Category, RecurringRule } from '@/domain/types';
import type { RuleFormState } from './ruleForm';

/** «Быстро завести ЗП»: чистая логика (без React и без базы). */

/** Название заготовки: попадает в заметку платежа и операций. */
export const SALARY_NOTE = 'Зарплата';

/**
 * «Зарплата», «Зарплата за октябрь», «ЗП», «зп аванс» — но не «Зарплатомер» и не «зпт». Границу слова задаём сами:
 * \b в JS не понимает кириллицу.
 */
const SALARY_NOTE_RE = /^\s*(?:зарплат[а-яё]*|зп)(?![а-яёa-z0-9])/i;

/** Категория дохода «Зарплата» из стартового набора. Её могли переименовать, убрать или отправить в архив — тогда null. */
export function findSalaryCategoryId(categories: Iterable<Pick<Category, 'id' | 'kind' | 'name' | 'deletedAt' | 'archivedAt'>>): string | null {
  for (const c of categories) {
    if (c.kind === 'income' && c.deletedAt === null && c.archivedAt === null && c.name.trim().toLowerCase() === SALARY_NOTE.toLowerCase()) return c.id;
  }
  return null;
}

/** Есть ли уже действующий регулярный доход, похожий на зарплату: в категории «Зарплата» или с заметкой «Зарплата» / «ЗП». */
export function hasSalaryRule(
  rules: readonly Pick<RecurringRule, 'kind' | 'categoryId' | 'note' | 'archivedAt' | 'deletedAt'>[],
  salaryCategoryId: string | null,
): boolean {
  return rules.some(
    (r) =>
      r.kind === 'income' &&
      r.deletedAt === null &&
      r.archivedAt === null &&
      ((salaryCategoryId !== null && r.categoryId === salaryCategoryId) || SALARY_NOTE_RE.test(r.note)),
  );
}

/**
 * Поля формы «Новый регулярный платёж» для ЗП: доход раз в месяц, категория «Зарплата» (если она есть). Остаётся ввести сумму и
 * выбрать день. «Проводить само» выключено: так платёж ждёт в «Предстоящих», и при проведении можно поправить сумму с причиной.
 */
export function salaryPrefill(categoryId: string | null): Partial<RuleFormState> {
  return { kind: 'income', categoryId, note: SALARY_NOTE, frequency: 'monthly', intervalText: '1', autoPost: false };
}
