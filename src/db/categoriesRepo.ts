import type { Category, CategoryKind, LocalRow, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import {
  cleanPatch,
  getLiveCategory,
  nextSortOrder,
  sameFields,
  touch,
  writeTx,
  type RepoContext,
} from './repoContext';
import { parseCategoryData, reqId, type CategoryData } from './validate';

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  parentId?: UUID | null;
}

export type CategoryPatch = Partial<CategoryInput & { sortOrder: number }>;

export interface CategoriesRepo {
  /** opts.id — только для затравки (детерминированный id). */
  create(input: CategoryInput, opts?: { id?: UUID }): Promise<LocalRow<Category>>;
  update(id: UUID, patch: CategoryPatch): Promise<LocalRow<Category>>;
  archive(id: UUID): Promise<LocalRow<Category>>;
  restore(id: UUID): Promise<LocalRow<Category>>;
}

const INPUT_KEYS = ['name', 'kind', 'color', 'icon', 'parentId'] as const;
const PATCH_KEYS = [...INPUT_KEYS, 'sortOrder'] as const;
const DATA_KEYS: readonly (keyof CategoryData)[] = [
  'name',
  'kind',
  'parentId',
  'color',
  'icon',
  'sortOrder',
  'archivedAt',
];
const MAX_DEPTH = 8;

function dataOf(c: Category): CategoryData {
  return {
    name: c.name,
    kind: c.kind,
    parentId: c.parentId,
    color: c.color,
    icon: c.icon,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt,
  };
}

export function createCategoriesRepo(ctx: RepoContext): CategoriesRepo {
  const { db } = ctx;

  /** Родитель: существует, того же вида, и цепочка вверх не приводит обратно к самой категории (без циклов). */
  async function checkParent(selfId: UUID, data: CategoryData): Promise<void> {
    if (data.parentId === null) return;
    if (data.parentId === selfId) throw new ValidationError('Категория не может быть родителем самой себе');
    let parent = await getLiveCategory(ctx, data.parentId, 'Родительская категория');
    if (parent.kind !== data.kind) {
      throw new ValidationError('Родительская категория должна быть того же вида (расход/доход)');
    }
    for (let depth = 0; parent.parentId !== null; depth++) {
      if (parent.parentId === selfId || depth > MAX_DEPTH) {
        throw new ValidationError('Вложенность категорий образует цикл или слишком глубока');
      }
      const up = await db.categories.get(parent.parentId);
      if (!up) break;
      parent = up;
    }
  }

  async function save(id: UUID, change: (c: LocalRow<Category>) => CategoryData): Promise<LocalRow<Category>> {
    return writeTx(ctx, [db.categories, db.transactions], async () => {
      const cur = await getLiveCategory(ctx, id);
      const next = change(cur);
      if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
      if (next.kind !== cur.kind) {
        const used = await db.transactions
          .where('categoryId')
          .equals(id)
          .filter((t) => t.deletedAt === null)
          .count();
        if (used > 0) {
          throw new ValidationError(`Нельзя менять вид категории «${cur.name}»: по ней уже есть операции`);
        }
        const children = await db.categories
          .filter((c) => c.parentId === id && c.deletedAt === null)
          .count();
        if (children > 0) throw new ValidationError(`Нельзя менять вид категории «${cur.name}»: у неё есть подкатегории`);
      }
      // родителя проверяем, только если его меняют: переименовать/архивировать можно и категорию, чей родитель потом удалён
      if (next.parentId !== cur.parentId || next.kind !== cur.kind) await checkParent(id, next);
      const row: LocalRow<Category> = { ...cur, ...next, ...touch(ctx).fields };
      await db.categories.put(row);
      return row;
    });
  }

  return {
    async create(input, opts) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Категория');
      const id = opts?.id;
      if (id !== undefined) reqId(id, 'Категория: id');
      return writeTx(ctx, [db.categories], async () => {
        const data = parseCategoryData({
          parentId: null,
          ...clean,
          sortOrder: await nextSortOrder(db.categories),
          archivedAt: null,
        });
        const newRowId = id ?? newId();
        if (id !== undefined && (await db.categories.get(newRowId))) {
          throw new ValidationError('Категория с таким id уже существует');
        }
        await checkParent(newRowId, data);
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<Category> = {
          id: newRowId,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
        };
        await db.categories.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, PATCH_KEYS, 'Категория');
      return save(id, (cur) => parseCategoryData({ ...dataOf(cur), ...clean }));
    },

    async archive(id) {
      return save(id, (cur) => (cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() }));
    },

    async restore(id) {
      return save(id, (cur) => ({ ...dataOf(cur), archivedAt: null }));
    },
  };
}
