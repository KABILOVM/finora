import type { FilterField, FilterValues } from '@/components/filters/filterState';
import { valueOf } from '@/components/filters/filterState';
import type { Category, RecurringRule, TxKind, Wallet } from '@/domain/types';

/**
 * Фильтры регулярных платежей (чистая логика): по виду, категории и кошельку. Действуют на все списки экрана
 * (просроченные, сегодня, скоро, пропущенные, все правила, архив) и на итог «В месяц».
 */

/** Значения фильтра категории сверх id: платежи без категории и платежи по долгам (у них своей категории нет). */
export const NO_CATEGORY = '__none__';
export const DEBT_RULES = '__debt__';

type FilterableRule = Pick<RecurringRule, 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'debtId'>;

const KIND_LABELS: Record<TxKind, string> = { expense: 'Расходы', income: 'Доходы', transfer: 'Переводы' };
const KIND_ORDER: readonly TxKind[] = ['expense', 'income', 'transfer'];

/** Категория, под которую попадает правило при фильтре: id категории, «по долгу» или «без категории»; у перевода категории нет (null). */
function categoryKeyOf(rule: FilterableRule): string | null {
  if (rule.kind === 'transfer') return null;
  if (rule.categoryId !== null) return rule.categoryId;
  return rule.debtId !== null ? DEBT_RULES : NO_CATEGORY;
}

/**
 * Поля фильтра по правилам: в вариантах только то, что у правил есть (категории, кошельки — включая принимающий в переводе).
 * Поле с одним вариантом не показывается: выбирать не из чего.
 */
export function ruleFilterFields(
  rules: readonly FilterableRule[],
  categories: ReadonlyMap<string, Pick<Category, 'name' | 'archivedAt'>>,
  wallets: ReadonlyMap<string, Pick<Wallet, 'name' | 'archivedAt'>>,
): FilterField[] {
  const kinds = KIND_ORDER.filter((k) => rules.some((r) => r.kind === k));

  const categoryIds = new Set<string>();
  let hasNone = false;
  let hasDebt = false;
  for (const r of rules) {
    const key = categoryKeyOf(r);
    if (key === null) continue;
    if (key === NO_CATEGORY) hasNone = true;
    else if (key === DEBT_RULES) hasDebt = true;
    else categoryIds.add(key);
  }
  const categoryOptions = [...categoryIds]
    .map((id) => {
      const c = categories.get(id);
      return { value: id, label: c ? (c.archivedAt === null ? c.name : `${c.name} (в архиве)`) : 'Категория удалена' };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  if (hasDebt) categoryOptions.push({ value: DEBT_RULES, label: 'По долгам' });
  if (hasNone) categoryOptions.push({ value: NO_CATEGORY, label: 'Без категории' });

  const walletIds = new Set<string>();
  for (const r of rules) {
    walletIds.add(r.walletId);
    if (r.toWalletId !== null) walletIds.add(r.toWalletId);
  }
  const walletOptions = [...walletIds]
    .map((id) => {
      const w = wallets.get(id);
      return { value: id, label: w ? (w.archivedAt === null ? w.name : `${w.name} (в архиве)`) : 'Кошелёк удалён' };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  const fields: FilterField[] = [];
  if (kinds.length > 1) fields.push({ key: 'kind', label: 'Вид платежа', type: 'chips', anyLabel: 'Все виды', options: kinds.map((k) => ({ value: k, label: KIND_LABELS[k] })) });
  if (categoryOptions.length > 1) fields.push({ key: 'category', label: 'Категория', type: 'select', anyLabel: 'Все категории', options: categoryOptions });
  if (walletOptions.length > 1) fields.push({ key: 'wallet', label: 'Кошелёк', type: 'select', anyLabel: 'Все кошельки', options: walletOptions, hint: 'Для перевода — и откуда, и куда.' });
  return fields;
}

/** Подходит ли правило под выбор. Пустой выбор — подходит всё. Перевод проходит по кошельку, из которого или в который идёт. */
export function matchesRuleFilter(rule: FilterableRule, values: FilterValues): boolean {
  const kind = valueOf(values, 'kind');
  const category = valueOf(values, 'category');
  const wallet = valueOf(values, 'wallet');
  if (kind !== '' && rule.kind !== kind) return false;
  if (category !== '' && categoryKeyOf(rule) !== category) return false;
  if (wallet !== '' && rule.walletId !== wallet && rule.toWalletId !== wallet) return false;
  return true;
}
