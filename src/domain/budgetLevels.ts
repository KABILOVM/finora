/**
 * Уровни бюджетов за месяц — ЧИСТЫЕ функции без импортов (ни базы, ни React, ни часов).
 * Этот файл один на приложение и серверную функцию send-reminders: его дословно копируют в supabase/functions/send-reminders/index.ts
 * (блок SHARED:budgetLevels; совпадение проверяет src/push-server/edge.test.ts), поэтому здесь нельзя ничего импортировать.
 * Правила те же, что у экрана «Бюджеты» (budgetProgress.ts + db/queries.ts → summarizeMonth): тест
 * budgetLevels.differential.test.ts сравнивает оба пути на случайных данных.
 *
 * Уровни по целому проценту (дробная часть отбрасывается вниз — «почти 70%» ещё не 70%):
 *   ok < 70 · warn 70–89 · danger 90–99 · over ≥ 100.
 */

export type BudgetLevel = 'ok' | 'warn' | 'danger' | 'over';

export const WARN_AT = 70;
export const DANGER_AT = 90;
export const OVER_AT = 100;

/** Целый процент «потрачено от лимита», округление вниз. Нет лимита, нет трат или некорректные суммы — 0. */
export function percentOf(spentMinor: number, limitMinor: number): number {
  if (!Number.isSafeInteger(spentMinor) || !Number.isSafeInteger(limitMinor) || limitMinor <= 0 || spentMinor <= 0) return 0;
  return Number((BigInt(spentMinor) * 100n) / BigInt(limitMinor));
}

/** Уровень по целому проценту. */
export function levelOf(percent: number): BudgetLevel {
  if (percent >= OVER_AT) return 'over';
  if (percent >= DANGER_AT) return 'danger';
  if (percent >= WARN_AT) return 'warn';
  return 'ok';
}

/** Охватывает ли бюджет категории `budgetCategoryId` расход в категории `spendCategoryId` (сама категория или её потомок). */
export function categoryCovers(budgetCategoryId: string, spendCategoryId: string | null, parentOf: ReadonlyMap<string, string | null>): boolean {
  const seen = new Set<string>(); // защита от петли в данных: A → B → A
  let cur = spendCategoryId;
  while (cur !== null && !seen.has(cur)) {
    if (cur === budgetCategoryId) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

/** Бюджет: живой, не в архиве (отбор — на вызывающем). categoryId null — общий лимит на все расходы. */
export interface LevelBudget {
  id: string;
  categoryId: string | null;
  amountMinor: number;
  currency: string;
}

/** Операция месяца в том виде, как она нужна расчёту: baseAmountMinor — снимок суммы в основной валюте (у перевода — комиссия). */
export interface LevelTx {
  kind: string;
  categoryId: string | null;
  debtId: string | null;
  baseCurrency: string;
  baseAmountMinor: number;
}

export interface BudgetLevelRow {
  id: string;
  categoryId: string | null;
  /** Целый процент, округление вниз; может быть больше 100. */
  percent: number;
  level: BudgetLevel;
}

export interface BudgetLevelsArgs {
  budgets: readonly LevelBudget[];
  /** Живые операции ОДНОГО месяца (отбор месяца и удалённых — на вызывающем). */
  txs: readonly LevelTx[];
  /** Категория → родитель. Нужны ВСЕ категории, в том числе архивные: у старых трат категория могла уйти в архив. */
  parentOf: ReadonlyMap<string, string | null>;
  /** Основная валюта сейчас: в ней посчитаны снимки сумм. */
  base: string;
}

/**
 * Уровни всех бюджетов за месяц. Потрачено — по снимкам суммы в основной валюте: расходы без операций по долгам; у перевода в расход
 * идёт только комиссия (baseAmountMinor > 0) и только в общий лимит; операции со снимком в другой валюте пропускаются.
 * Бюджет в валюте, отличной от основной, не сравнивается с тратами и в результат не попадает. Суммы — BigInt: переполнения нет.
 */
export function budgetLevelsOf(args: BudgetLevelsArgs): BudgetLevelRow[] {
  const { budgets, txs, parentOf, base } = args;
  let expense = 0n;
  const byCategory = new Map<string | null, bigint>();
  for (const t of txs) {
    if (!Number.isSafeInteger(t.baseAmountMinor) || t.baseCurrency !== base) continue;
    if (t.kind === 'transfer') {
      if (t.baseAmountMinor > 0) expense += BigInt(t.baseAmountMinor); // комиссия перевода: только в общий лимит
      continue;
    }
    if (t.debtId !== null || t.kind === 'income') continue;
    expense += BigInt(t.baseAmountMinor);
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0n) + BigInt(t.baseAmountMinor));
  }
  const out: BudgetLevelRow[] = [];
  for (const b of budgets) {
    if (b.currency !== base || !Number.isSafeInteger(b.amountMinor) || b.amountMinor <= 0) continue;
    let spent = 0n;
    if (b.categoryId === null) spent = expense;
    else {
      for (const [categoryId, total] of byCategory) {
        if (categoryId !== null && categoryCovers(b.categoryId, categoryId, parentOf)) spent += total;
      }
    }
    const percent = spent <= 0n ? 0 : Number((spent * 100n) / BigInt(b.amountMinor));
    out.push({ id: b.id, categoryId: b.categoryId, percent, level: levelOf(percent) });
  }
  return out;
}
