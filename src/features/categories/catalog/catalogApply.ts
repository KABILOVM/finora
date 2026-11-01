import { defaultId, type Store } from '@/db';
import { glyphValue } from '@/components/glyphs';
import type { Category, LocalRow } from '@/domain/types';
import { childSlug, groupSlug } from './catalogData';
import { actionable, type CatalogPlan, type PlanGroup, type Selection } from './catalogPlan';

export interface ApplyResult {
  created: number;
  moved: number;
  restored: number;
}

/** Кратко для сообщения: «Добавлено 12 категорий, перенесено 3». */
export function applyText(r: ApplyResult): string {
  const word = (n: number, one: string, few: string, many: string) => {
    const last2 = n % 100;
    const last = n % 10;
    return last2 >= 11 && last2 <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  };
  const parts: string[] = [];
  if (r.created > 0) parts.push(`добавлено ${r.created} ${word(r.created, 'категория', 'категории', 'категорий')}`);
  if (r.moved > 0) parts.push(`перенесено ${r.moved}`);
  if (r.restored > 0) parts.push(`возвращено из архива ${r.restored}`);
  if (parts.length === 0) return 'Ничего не изменилось';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Записывает выбранное из плана одной транзакцией: либо всё, либо ничего. Новые строки получают id, посчитанные от пользователя и вечного
 * slug (defaultId), как у стартовых категорий: два устройства, заведшие одно и то же, создадут одни и те же строки, а не дубли. Если строка с
 * таким id уже есть и жива — берём её; если id занят удалённой строкой — заводим с новым случайным.
 * Подкатегории без родителя (его нет и он не выбран) пропускаются. Повторный вызов с тем же выбором ничего не дублирует.
 */
export async function applyCatalog(store: Store, plan: CatalogPlan, selected: Selection): Promise<ApplyResult> {
  const { db } = store;
  const result: ApplyResult = { created: 0, moved: 0, restored: 0 };

  const chosen: PlanGroup[] = plan.groups.filter((g) => g.parent.action === 'present' || selected.has(g.key));
  // id считаются ДО транзакции: ожидание не-Dexie промисов (crypto) внутри транзакции её закрыло бы
  const ids = new Map<string, string>();
  for (const g of chosen) {
    if (g.parent.action === 'create') ids.set(g.key, await defaultId(store.userId, groupSlug(g.group)));
    for (const c of actionable(g)) if (c.action === 'create' && selected.has(c.key)) ids.set(c.key, await defaultId(store.userId, childSlug(g.group, c.child)));
  }

  await db.transaction('rw', [db.categories, db.transactions, db.budgets, db.recurring_rules, db.meta], async () => {
    /** Создаёт категорию или берёт уже существующую с тем же детерминированным id. Возвращает id. */
    const ensure = async (
      key: string,
      input: { name: string; kind: Category['kind']; color: string; icon: string; parentId: string | null; essential: boolean },
    ): Promise<string> => {
      const wanted = ids.get(key);
      const same: LocalRow<Category> | undefined = wanted === undefined ? undefined : await db.categories.get(wanted);
      if (same && same.deletedAt === null) return same.id;
      // id занят удалённой строкой (след синхронизации): создать заново с тем же id нельзя — берём новый
      const row = await store.categories.create(input, same || wanted === undefined ? undefined : { id: wanted });
      result.created++;
      return row.id;
    };

    for (const g of chosen) {
      let parentId: string;
      let color: string;
      if (g.parent.action === 'present') {
        parentId = g.parent.id;
        color = g.parent.color;
      } else if (g.parent.action === 'restore') {
        const kids = actionable(g).filter((c) => selected.has(c.key));
        if (kids.length === 0) continue; // вернуть из архива ради пустой группы незачем
        await store.categories.restore(g.parent.id);
        result.restored++;
        parentId = g.parent.id;
        color = g.parent.color;
      } else {
        const kids = actionable(g).filter((c) => selected.has(c.key));
        if (kids.length === 0) continue;
        color = g.group.color;
        parentId = await ensure(g.key, {
          name: g.group.name,
          kind: g.group.kind,
          color,
          icon: glyphValue(g.group.icon),
          parentId: null,
          essential: g.group.kind === 'expense' && g.group.essential === true,
        });
      }

      for (const c of actionable(g)) {
        if (!selected.has(c.key)) continue;
        if (c.action === 'move' && c.existing) {
          await store.categories.update(c.existing.id, { parentId });
          result.moved++;
        } else if (c.action === 'create') {
          await ensure(c.key, {
            name: c.child.name,
            kind: g.group.kind,
            color,
            icon: glyphValue(c.child.icon),
            parentId,
            essential: g.group.kind === 'expense' && c.child.essential === true,
          });
        }
      }
    }
  });

  return result;
}
