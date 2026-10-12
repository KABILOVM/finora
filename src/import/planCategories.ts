import { categoryKey } from './ids';
import { nameKey } from './text';
import type { CategoryLite, CategoryTarget, PlanCategory, ZenRow } from './types';

/**
 * Категории Дзен-мани → категории Finora. Совпадение — по названию и виду (расход/доход), у подкатегории ещё и по родителю;
 * архивные и удалённые для совпадения не берутся. Нет совпадения — создаём с детерминированным id
 * (повторный импорт найдёт её по этому id, даже если её переименовали). Созданную прошлым импортом и потом удалённую
 * не воскрешаем: операции этой категории придут без категории, и мы говорим об этом в предпросмотре.
 * Родители идут раньше детей (порядок создания).
 */
export function resolveCategories(
  rows: readonly ZenRow[],
  cats: readonly CategoryLite[],
  detIds: ReadonlyMap<string, string>,
): Map<string, PlanCategory> {
  const out = new Map<string, PlanCategory>();

  for (const r of rows) {
    if (r.kind === 'transfer' || r.categoryPath.length === 0) continue;
    const kind = r.kind;
    for (let depth = 1; depth <= r.categoryPath.length; depth++) {
      const path = r.categoryPath.slice(0, depth);
      const key = categoryKey(kind, path);
      if (out.has(key)) continue;
      const name = path[depth - 1]!;
      const parentKey = depth > 1 ? categoryKey(kind, path.slice(0, depth - 1)) : null;
      const parent = parentKey ? out.get(parentKey) : undefined;
      out.set(key, {
        key,
        catKind: kind,
        name,
        path,
        parentKey,
        usedBy: 0,
        needed: false,
        target: targetFor(kind, name, parent?.target ?? null, cats, detIds.get(key)),
      });
    }
  }

  for (const r of rows) {
    if (r.kind === 'transfer' || r.categoryPath.length === 0) continue;
    const leaf = out.get(categoryKey(r.kind, r.categoryPath));
    if (leaf) leaf.usedBy++;
  }
  return out;
}

function targetFor(
  kind: 'expense' | 'income',
  name: string,
  parent: CategoryTarget | null,
  cats: readonly CategoryLite[],
  detId: string | undefined,
): CategoryTarget {
  if (parent?.kind === 'missing') return { kind: 'missing', reason: parent.reason };
  const parentId = parent ? parent.id : null;
  const wanted = nameKey(name);
  if (parent?.kind !== 'create') {
    const match = cats.find(
      (c) => c.deletedAt === null && c.archivedAt === null && c.kind === kind && c.parentId === parentId && nameKey(c.name) === wanted,
    );
    if (match) return { kind: 'existing', id: match.id, how: 'name' };
  }
  if (detId === undefined) return { kind: 'missing', reason: 'Не удалось подготовить категорию' };
  const det = cats.find((c) => c.id === detId);
  if (!det) return { kind: 'create', id: detId };
  if (det.deletedAt !== null) {
    return { kind: 'missing', reason: `Категория «${det.name}», созданная прошлым импортом, удалена` };
  }
  return { kind: 'existing', id: det.id, how: 'saved' };
}

/** id категории, в которую пойдёт операция; null — без категории. */
export function categoryIdOf(target: CategoryTarget | undefined): string | null {
  return target && target.kind !== 'missing' ? target.id : null;
}
