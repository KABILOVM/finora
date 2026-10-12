import type { IsoDate, LocalRow, Minor, ShoppingItem, ShoppingList, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { isUuid, newId } from './ids';
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
import { optId } from './validate';
import { itemsToJson, parseShoppingListData, type ShoppingListData } from './validateShopping';

export interface ShoppingListInput {
  name: string;
  items?: readonly ShoppingItem[];
  /** Категория расходов для будущего расхода (можно не задавать и выбрать при подтверждении). */
  categoryId?: UUID | null;
}

export interface ShoppingListPatch {
  name?: string;
  items?: readonly ShoppingItem[];
  categoryId?: UUID | null;
}

export interface ShoppingConfirm {
  /** Итог покупки в валюте списка: больше нуля. */
  totalMinor: Minor;
  doneOn: IsoDate;
  /** Созданный расход (id операции). */
  transactionId: UUID;
  /** Товары в том виде, как купили (цены, отметки); не задано — остаются прежними. */
  items?: readonly ShoppingItem[];
  categoryId?: UUID | null;
}

export interface ShoppingListsRepo {
  /** Новый открытый список; валюта цен = основная валюта настроек. */
  create(input: ShoppingListInput): Promise<LocalRow<ShoppingList>>;
  /** Правка открытого списка. Подтверждённый список («чек») не правится. */
  update(id: UUID, patch: ShoppingListPatch): Promise<LocalRow<ShoppingList>>;
  /** Закрыть список как купленный: итог, дата, расход. Повтор с теми же значениями безопасен. */
  confirm(id: UUID, input: ShoppingConfirm): Promise<LocalRow<ShoppingList>>;
  archive(id: UUID): Promise<LocalRow<ShoppingList>>;
  restore(id: UUID): Promise<LocalRow<ShoppingList>>;
  /** Мягкое удаление. Созданный расход остаётся. Повтор безопасен. */
  softDelete(id: UUID): Promise<LocalRow<ShoppingList>>;
}

const DATA_KEYS: readonly (keyof ShoppingListData)[] = [
  'name',
  'itemsJson',
  'status',
  'currency',
  'categoryId',
  'transactionId',
  'totalMinor',
  'doneOn',
  'archivedAt',
];

const dataOf = (l: ShoppingList): ShoppingListData => ({
  name: l.name,
  itemsJson: l.itemsJson,
  status: l.status,
  currency: l.currency,
  categoryId: l.categoryId,
  transactionId: l.transactionId,
  totalMinor: l.totalMinor,
  doneOn: l.doneOn,
  archivedAt: l.archivedAt,
});

function normCategory(raw: unknown): UUID | null {
  const id = optId(raw, 'Категория списка');
  if (id !== null && !isUuid(id)) throw new ValidationError('Категория списка: id должен быть в виде UUID');
  return id === null ? null : id.toLowerCase();
}

export function createShoppingRepo(ctx: RepoContext): ShoppingListsRepo {
  const { db } = ctx;

  async function getLive(id: UUID): Promise<LocalRow<ShoppingList>> {
    const l = await db.shopping_lists.get(id);
    if (!l) throw new ValidationError('Список покупок не найден');
    if (l.deletedAt !== null) throw new ValidationError('Список покупок удалён');
    return l;
  }

  async function checkCategory(categoryId: UUID | null): Promise<void> {
    if (categoryId === null) return;
    const cat = await getLiveCategory(ctx, categoryId);
    if (cat.kind !== 'expense') throw new ValidationError(`Для покупок нужна категория расходов, а «${cat.name}» — для доходов`);
    if (cat.archivedAt !== null) throw new ValidationError(`Категория «${cat.name}» в архиве: верните её или выберите другую`);
  }

  async function write(cur: LocalRow<ShoppingList>, next: ShoppingListData): Promise<LocalRow<ShoppingList>> {
    if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
    const row = withDirtyGroups<LocalRow<ShoppingList>>('shopping_lists', cur, { ...cur, ...next, ...touch(ctx).fields });
    await db.shopping_lists.put(row);
    return row;
  }

  return {
    async create(input) {
      const clean = cleanPatch(input, ['name', 'items', 'categoryId'] as const, 'Список покупок');
      const categoryId = normCategory(clean.categoryId);
      const itemsJson = itemsToJson((clean.items as readonly ShoppingItem[] | undefined) ?? []);
      return writeTx(ctx, [db.shopping_lists, db.categories, db.settings], async () => {
        const settings = await requireSettings(ctx);
        await checkCategory(categoryId);
        const data = parseShoppingListData({
          name: clean.name,
          itemsJson,
          status: 'open',
          currency: settings.baseCurrency,
          categoryId,
          transactionId: null,
          totalMinor: null,
          doneOn: null,
          archivedAt: null,
        });
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<ShoppingList> = {
          id: newId(),
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создан здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.shopping_lists.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, ['name', 'items', 'categoryId'] as const, 'Список покупок');
      const categoryId = clean.categoryId === undefined ? undefined : normCategory(clean.categoryId);
      return writeTx(ctx, [db.shopping_lists, db.categories], async () => {
        const cur = await getLive(id);
        if (cur.status === 'done') throw new ValidationError('Покупка уже подтверждена: список больше не правится');
        if (categoryId !== undefined && categoryId !== cur.categoryId) await checkCategory(categoryId);
        const next = parseShoppingListData({
          ...dataOf(cur),
          ...(clean.name !== undefined ? { name: clean.name } : {}),
          ...(clean.items !== undefined ? { itemsJson: itemsToJson(clean.items as readonly ShoppingItem[]) } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        });
        return write(cur, next);
      });
    },

    async confirm(id, input) {
      const clean = cleanPatch(input, ['totalMinor', 'doneOn', 'transactionId', 'items', 'categoryId'] as const, 'Подтверждение покупки');
      const transactionId = clean.transactionId;
      if (!isUuid(transactionId)) throw new ValidationError('Расход покупки: id должен быть в виде UUID');
      return writeTx(ctx, [db.shopping_lists, db.categories], async () => {
        const cur = await getLive(id);
        const categoryId = clean.categoryId === undefined ? cur.categoryId : normCategory(clean.categoryId);
        if (cur.status === 'done') {
          // повтор (двойное нажатие, повтор после сбоя): тот же расход — вернуть как есть; другой — ошибка
          if (cur.transactionId === transactionId.toLowerCase()) return cur;
          throw new ValidationError('Покупка уже подтверждена другим расходом');
        }
        if (typeof clean.totalMinor !== 'number' || clean.totalMinor <= 0) throw new ValidationError('Итог покупки должен быть больше нуля');
        const next = parseShoppingListData({
          ...dataOf(cur),
          ...(clean.items !== undefined ? { itemsJson: itemsToJson(clean.items as readonly ShoppingItem[]) } : {}),
          categoryId,
          status: 'done',
          totalMinor: clean.totalMinor,
          doneOn: clean.doneOn,
          transactionId: transactionId.toLowerCase(),
        });
        return write(cur, next);
      });
    },

    async archive(id) {
      return writeTx(ctx, [db.shopping_lists], async () => {
        const cur = await getLive(id);
        return write(cur, cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() });
      });
    },

    async restore(id) {
      return writeTx(ctx, [db.shopping_lists], async () => {
        const cur = await getLive(id);
        return write(cur, { ...dataOf(cur), archivedAt: null });
      });
    },

    async softDelete(id) {
      return writeTx(ctx, [db.shopping_lists], async () => {
        const cur = await db.shopping_lists.get(id);
        if (!cur) throw new ValidationError('Список покупок не найден');
        if (cur.deletedAt !== null) return cur;
        const row = withDirtyGroups<LocalRow<ShoppingList>>('shopping_lists', cur, { ...cur, deletedAt: ctx.clock.tick(), ...touch(ctx).fields });
        await db.shopping_lists.put(row);
        return row;
      });
    },
  };
}
