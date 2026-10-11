import type { Budget, LocalRow, Minor, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { defaultId, isUuid } from './ids';
import {
  cleanPatch,
  getLiveCategory,
  requireSettings,
  sameFields,
  touch,
  withDirtyGroups,
  writeTx,
  type RepoContext,
} from './repoContext';
import { optId, reqPositiveMinor } from './validate';
import { parseBudgetData, type BudgetData } from './validatePlans';

export interface BudgetInput {
  /** Категория расходов; не задана или null — общий лимит на все расходы. */
  categoryId?: UUID | null;
  /** Лимит на месяц в БАЗОВОЙ валюте настроек: от 1 до 1e15 минимальных единиц. */
  amountMinor: Minor;
}

export interface BudgetsRepo {
  /**
   * Лимит на категорию (или общий). id детерминирован — defaultId(userId, 'budget:' + (categoryId ?? 'total')): повторное создание
   * лимита на ту же категорию (и на другом устройстве) ОБНОВЛЯЕТ существующий бюджет, а не заводит второй; бюджет из архива
   * при этом возвращается. Валюта = базовая валюта настроек.
   */
  create(input: BudgetInput): Promise<LocalRow<Budget>>;
  /** Меняется только сумма: категория задаёт сам id бюджета. Валюта снова берётся из настроек. */
  update(id: UUID, patch: { amountMinor: Minor }): Promise<LocalRow<Budget>>;
  /** В архив (бюджет перестаёт учитываться). Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<Budget>>;
  restore(id: UUID): Promise<LocalRow<Budget>>;
}

const INPUT_KEYS = ['categoryId', 'amountMinor'] as const;
const DATA_KEYS: readonly (keyof BudgetData)[] = ['categoryId', 'amountMinor', 'currency', 'period', 'archivedAt'];

const dataOf = (b: Budget): BudgetData => ({
  categoryId: b.categoryId,
  amountMinor: b.amountMinor,
  currency: b.currency,
  period: b.period,
  archivedAt: b.archivedAt,
});

/** Slug детерминированного id бюджета (вечный, менять нельзя). */
export const budgetSlug = (categoryId: UUID | null): string => `budget:${categoryId ?? 'total'}`;

export function createBudgetsRepo(ctx: RepoContext): BudgetsRepo {
  const { db } = ctx;

  async function getLiveBudget(id: UUID): Promise<LocalRow<Budget>> {
    const b = await db.budgets.get(id);
    if (!b) throw new ValidationError('Бюджет не найден');
    if (b.deletedAt !== null) throw new ValidationError('Бюджет удалён');
    return b;
  }

  async function write(cur: LocalRow<Budget>, next: BudgetData): Promise<LocalRow<Budget>> {
    if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
    const row = withDirtyGroups<LocalRow<Budget>>('budgets', cur, { ...cur, ...next, ...touch(ctx).fields });
    await db.budgets.put(row);
    return row;
  }

  return {
    async create(input) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Бюджет');
      const amountMinor = reqPositiveMinor(clean.amountMinor, 'Лимит бюджета');
      const rawCategory = optId(clean.categoryId, 'Категория бюджета');
      if (rawCategory !== null && !isUuid(rawCategory)) throw new ValidationError('Категория бюджета: id должен быть в виде UUID');
      const categoryId = rawCategory === null ? null : rawCategory.toLowerCase();
      const id = await defaultId(ctx.userId, budgetSlug(categoryId));
      return writeTx(ctx, [db.budgets, db.categories, db.settings], async () => {
        const settings = await requireSettings(ctx);
        if (categoryId !== null) {
          const cat = await getLiveCategory(ctx, categoryId);
          if (cat.kind !== 'expense') throw new ValidationError(`Лимит можно поставить только на категорию расходов, а «${cat.name}» — для доходов`);
          if (cat.archivedAt !== null) throw new ValidationError(`Категория «${cat.name}» в архиве: верните её или выберите другую`);
        }
        const data = parseBudgetData({
          categoryId,
          amountMinor,
          currency: settings.baseCurrency,
          period: 'month',
          archivedAt: null,
        });
        const existing = await db.budgets.get(id);
        if (existing) {
          // тот же бюджет: обновляем сумму, возвращаем из архива и «оживляем» удалённый (на другом устройстве мог быть удалён)
          if (existing.deletedAt === null) return write(existing, data);
          const row = withDirtyGroups<LocalRow<Budget>>('budgets', existing, { ...existing, ...data, deletedAt: null, ...touch(ctx).fields });
          await db.budgets.put(row);
          return row;
        }
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<Budget> = {
          id,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создан здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.budgets.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, ['amountMinor'] as const, 'Бюджет');
      return writeTx(ctx, [db.budgets, db.settings], async () => {
        const cur = await getLiveBudget(id);
        const settings = await requireSettings(ctx);
        const next = parseBudgetData({
          ...dataOf(cur),
          ...(clean.amountMinor !== undefined ? { amountMinor: clean.amountMinor } : {}),
          currency: settings.baseCurrency,
        });
        return write(cur, next);
      });
    },

    async archive(id) {
      return writeTx(ctx, [db.budgets], async () => {
        const cur = await getLiveBudget(id);
        return write(cur, cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() });
      });
    },

    async restore(id) {
      return writeTx(ctx, [db.budgets], async () => {
        const cur = await getLiveBudget(id);
        return write(cur, { ...dataOf(cur), archivedAt: null });
      });
    },
  };
}
