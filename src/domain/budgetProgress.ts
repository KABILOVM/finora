import { addMinor, isMinor } from './money';
import type { CurrencyCode, IsoDateTime, Minor, UUID } from './types';

/**
 * Прогресс бюджетов за месяц — ЧИСТЫЕ функции (без базы, без React, без часов).
 *
 * Потрачено берётся из итогов месяца (db/queries.ts summarizeMonth): уже в базовой валюте, без операций по долгам,
 * с комиссиями переводов отдельной строкой. Бюджет на категорию охватывает её и ПОДКАТЕГОРИИ (parentId, любой глубины).
 * Общий лимит (categoryId = null) — все расходы месяца, включая «Комиссии» и «Без категории».
 *
 * Уровни по целому проценту (дробная часть отбрасывается вниз — «почти 70%» ещё не 70%):
 *   ok < 70 · warn 70–89 · danger 90–99 · over ≥ 100.
 * Проценты и остатки считаются целыми числами (BigInt для произведения), поэтому на больших суммах точность не теряется.
 */

export type BudgetLevel = 'ok' | 'warn' | 'danger' | 'over';

export const WARN_AT = 70;
export const DANGER_AT = 90;
export const OVER_AT = 100;

/** Целый процент «потрачено от лимита», округление вниз. Нет лимита, нет трат или некорректные суммы — 0. */
export function percentOf(spentMinor: Minor, limitMinor: Minor): number {
  if (!isMinor(spentMinor) || !isMinor(limitMinor) || limitMinor <= 0 || spentMinor <= 0) return 0;
  return Number((BigInt(spentMinor) * 100n) / BigInt(limitMinor));
}

/** Уровень по целому проценту. */
export function levelOf(percent: number): BudgetLevel {
  if (percent >= OVER_AT) return 'over';
  if (percent >= DANGER_AT) return 'danger';
  if (percent >= WARN_AT) return 'warn';
  return 'ok';
}

/** Бюджет в том виде, в каком он нужен расчёту (подходит и LocalRow<Budget>). */
export interface BudgetLike {
  id: UUID;
  categoryId: UUID | null;
  amountMinor: Minor;
  currency: CurrencyCode;
  archivedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}

/** Строка расходов месяца (как CategoryTotal из db/queries.ts). */
export interface SpendRow {
  /** null — «без категории» (а при kind === 'fee' — комиссии переводов). */
  categoryId: UUID | null;
  totalMinor: Minor;
  kind?: 'fee';
}

interface ProgressBase {
  id: UUID;
  /** null — общий лимит на все расходы. */
  categoryId: UUID | null;
  limitMinor: Minor;
  currency: CurrencyCode;
}

/**
 * Прогресс одного бюджета. comparable: false — лимит задан в другой валюте, чем сейчас основная: сравнивать
 * его с тратами нельзя, процентов нет (экран просит заново указать сумму), а не «0%».
 */
export type BudgetProgress =
  | (ProgressBase & {
      comparable: true;
      spentMinor: Minor;
      /** Целый процент, округление вниз; может быть больше 100. */
      percent: number;
      level: BudgetLevel;
      /** Сколько ещё можно потратить (0, если лимит исчерпан). */
      remainingMinor: Minor;
      /** На сколько лимит превышен (0, если не превышен). */
      overMinor: Minor;
    })
  | (ProgressBase & { comparable: false });

export interface BudgetsOverview {
  /** Только живые бюджеты не в архиве, в порядке входа. */
  items: BudgetProgress[];
  /** Расходы месяца, которые не попали ни в один лимит по категориям (включая «Комиссии» и «Без категории»). */
  unlimitedMinor: Minor;
  /** Есть ли хотя бы один лимит по категории (без него «Без лимита» показывать незачем: всё и так без лимита). */
  hasCategoryBudgets: boolean;
}

export type BudgetsResult = ({ ok: true } & BudgetsOverview) | { ok: false; error: 'overflow' };

/** Охватывает ли бюджет категории `budgetCategoryId` расход в категории `spendCategoryId` (сама категория или её потомок). */
export function categoryCovers(
  budgetCategoryId: UUID,
  spendCategoryId: UUID | null,
  parentOf: ReadonlyMap<UUID, UUID | null>,
): boolean {
  const seen = new Set<UUID>(); // защита от петли в данных: A → B → A
  let cur = spendCategoryId;
  while (cur !== null && !seen.has(cur)) {
    if (cur === budgetCategoryId) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

export interface BudgetProgressArgs {
  budgets: readonly BudgetLike[];
  /** Расходы месяца по категориям (summarizeMonth().byCategory). */
  byCategory: readonly SpendRow[];
  /** Все расходы месяца (summarizeMonth().expenseMinor): с комиссиями. */
  expenseMinor: Minor;
  /** Категория → родитель. Нужны ВСЕ категории, в том числе архивные: у старых трат категория могла уйти в архив. */
  parentOf: ReadonlyMap<UUID, UUID | null>;
  /** Основная валюта сейчас: в ней посчитаны траты. */
  base: CurrencyCode;
}

/** Прогресс всех живых бюджетов за месяц. Переполнение сумм — признак ошибки, а не исключение. */
export function computeBudgetProgress(args: BudgetProgressArgs): BudgetsResult {
  const { byCategory, expenseMinor, parentOf, base } = args;
  const active = args.budgets.filter(
    (b) => b.deletedAt === null && b.archivedAt === null && isMinor(b.amountMinor) && b.amountMinor > 0,
  );
  try {
    const items: BudgetProgress[] = active.map((b) => {
      const head: ProgressBase = { id: b.id, categoryId: b.categoryId, limitMinor: b.amountMinor, currency: b.currency };
      if (b.currency !== base) return { ...head, comparable: false };
      let spent: Minor = 0;
      if (b.categoryId === null) spent = expenseMinor;
      else {
        for (const row of byCategory) {
          if (row.kind === 'fee' || row.categoryId === null) continue; // комиссии и «без категории» — только в общем лимите
          if (categoryCovers(b.categoryId, row.categoryId, parentOf)) spent = addMinor(spent, row.totalMinor);
        }
      }
      const percent = percentOf(spent, b.amountMinor);
      return {
        ...head,
        comparable: true,
        spentMinor: spent,
        percent,
        level: levelOf(percent),
        remainingMinor: spent >= b.amountMinor ? 0 : b.amountMinor - spent,
        overMinor: spent > b.amountMinor ? spent - b.amountMinor : 0,
      };
    });

    const categoryBudgets = active.filter((b) => b.categoryId !== null);
    let unlimited: Minor = 0;
    for (const row of byCategory) {
      const covered =
        row.kind !== 'fee' &&
        row.categoryId !== null &&
        categoryBudgets.some((b) => b.categoryId !== null && categoryCovers(b.categoryId, row.categoryId, parentOf));
      if (!covered) unlimited = addMinor(unlimited, row.totalMinor);
    }
    return { ok: true, items, unlimitedMinor: unlimited, hasCategoryBudgets: categoryBudgets.length > 0 };
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: 'overflow' };
    throw e;
  }
}

/** Самые «горячие» бюджеты (по проценту, от большего): только те, что можно сравнить с тратами. Равные — по id. */
export function hottestBudgets(items: readonly BudgetProgress[], limit: number): BudgetProgress[] {
  return items
    .filter((i): i is Extract<BudgetProgress, { comparable: true }> => i.comparable)
    .sort((a, b) => b.percent - a.percent || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, limit));
}

/**
 * Что показать в виджете «Главной»: общий лимит, если он есть (и до двух категорий, которые уже вышли за «в пределах лимита»),
 * а без общего лимита — три самых «горячих» бюджета по категориям.
 */
export function pickWidgetBudgets(items: readonly BudgetProgress[], max = 3): BudgetProgress[] {
  const total = items.find((i) => i.categoryId === null);
  const categories = items.filter((i) => i.categoryId !== null);
  if (!total) return hottestBudgets(categories, max);
  const hot = hottestBudgets(categories, Math.max(0, max - 1)).filter((i) => i.comparable && i.level !== 'ok');
  return [total, ...hot];
}
