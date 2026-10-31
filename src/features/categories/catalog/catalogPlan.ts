import type { CategoryKind } from '@/domain/types';
import { CATALOG, childSlug, groupSlug, type CatalogChild, type CatalogGroup } from './catalogData';

/**
 * Что можно сделать с готовыми категориями при тех, что у человека уже есть: завести новые, перенести его категории под нужного
 * родителя («Свет», «Вода» → «Коммунальные услуги») или ничего (уже есть). Чистая логика без базы и React: проверяется обычными тестами.
 *
 * Сопоставление идёт по НАЗВАНИЮ (и синонимам из каталога), целиком, без учёта регистра, «ё», знаков и окончаний слов («Интернета» = «Интернет»).
 * Частичных совпадений нет: «Газета» не станет «Газом». Что не сопоставилось, остаётся нетронутым.
 */

export interface ExistingCategory {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  archived: boolean;
  color: string;
}

/* ------------------------------ сравнение названий ------------------------------ */

/** Окончания, которые отбрасываются у слов длиной от 4 букв, чтобы «воды»/«вода», «света»/«свет», «дети»/«детей» не расходились. */
const ENDING = /(ыми|ими|его|ого|ему|ому|ая|яя|ое|ее|ые|ие|ый|ий|ой|ей|ом|ем|ах|ях|ов|ев|ам|ям|ы|и|а|я|у|ю|е|о|ь)$/;

function stem(word: string): string {
  return word.length >= 4 ? word.replace(ENDING, '') : word;
}

/** Ключ сравнения: слова без регистра, «ё», знаков и окончаний. «Коммунальные услуги» и «коммунальная услуга» дают один ключ. */
export function nameKey(name: string): string {
  return name
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '')
    .map(stem)
    .join(' ');
}

const groupKeys = (g: CatalogGroup): Set<string> => new Set([g.name, ...(g.aka ?? [])].map(nameKey));
const childKeys = (c: CatalogChild): Set<string> => new Set([c.name, ...(c.aka ?? [])].map(nameKey));

/* ------------------------------ план ------------------------------ */

export type ParentState =
  /** Такой категории у человека нет: заведём. */
  | { action: 'create' }
  /** Уже есть (под своим названием): подкатегории встанут под неё. */
  | { action: 'present'; id: string; name: string; color: string }
  /** Была, но лежит в архиве: вернём из архива. */
  | { action: 'restore'; id: string; name: string; color: string };

export type ChildAction = 'create' | 'move' | 'present';

export interface PlanChild {
  /** Ключ выбора (вечный slug записи). */
  key: string;
  child: CatalogChild;
  action: ChildAction;
  /** Для «перенести» и «уже есть»: категория человека, которой это соответствует. */
  existing?: { id: string; name: string };
}

export interface PlanGroup {
  key: string;
  group: CatalogGroup;
  parent: ParentState;
  children: PlanChild[];
  /** Сколько действий предложено (создать, перенести, вернуть из архива): «0» — группа уже собрана, показывать нечего. */
  open: number;
}

export interface CatalogPlan {
  groups: PlanGroup[];
}

/** Группа, в которой есть что предложить. */
export const hasWork = (g: PlanGroup): boolean => g.open > 0;

/**
 * План для готовых категорий при существующих у человека. Группы, где всё уже на месте (или предложить нечего), остаются в плане
 * с open = 0, чтобы экран мог сказать «у вас всё есть», но в список выбора не попадают.
 */
export function planCatalog(existing: readonly ExistingCategory[], catalog: readonly CatalogGroup[] = CATALOG): CatalogPlan {
  const groups: PlanGroup[] = [];

  for (const kind of ['expense', 'income'] as const) {
    const ofKind = existing.filter((c) => c.kind === kind);
    const live = ofKind.filter((c) => !c.archived);
    const archived = ofKind.filter((c) => c.archived);
    const hasKids = new Set(ofKind.filter((c) => c.parentId !== null).map((c) => c.parentId));
    const kindGroups = catalog.filter((g) => g.kind === kind);

    // 1. Родители: верхняя категория с тем же названием. Занятые родителями категории потом не переносятся как подкатегории.
    const parents = new Map<string, ParentState | 'blocked'>();
    const taken = new Set<string>();
    for (const g of kindGroups) {
      const keys = groupKeys(g);
      const byName = (list: readonly ExistingCategory[], top: boolean) =>
        list.filter((c) => keys.has(nameKey(c.name)) && (c.parentId === null) === top);
      const exact = (list: ExistingCategory[]) => list.find((c) => nameKey(c.name) === nameKey(g.name)) ?? list[0];
      const liveTop = exact(byName(live, true));
      if (liveTop) {
        parents.set(g.slug, { action: 'present', id: liveTop.id, name: liveTop.name, color: liveTop.color });
        taken.add(liveTop.id);
        continue;
      }
      const archivedTop = exact(byName(archived, true));
      if (archivedTop) {
        parents.set(g.slug, { action: 'restore', id: archivedTop.id, name: archivedTop.name, color: archivedTop.color });
        taken.add(archivedTop.id);
        continue;
      }
      // такое же название носит чья-то подкатегория (или группа с ним не может встать наверх): группу не предлагаем
      const clash = [...live, ...archived].some((c) => keys.has(nameKey(c.name)));
      parents.set(g.slug, clash ? 'blocked' : { action: 'create' });
    }

    // 2. Подкатегории.
    const used = new Set<string>();
    for (const g of kindGroups) {
      const parent = parents.get(g.slug);
      if (parent === undefined || parent === 'blocked') continue;
      const parentId = parent.action === 'create' ? null : parent.id;
      const children: PlanChild[] = [];
      for (const c of g.children) {
        const keys = childKeys(c);
        const base = { key: childSlug(g, c), child: c };
        const matches = live.filter((x) => keys.has(nameKey(x.name)) && !taken.has(x.id) && !used.has(x.id));
        const inPlace = matches.find((x) => parentId !== null && x.parentId === parentId);
        if (inPlace) {
          used.add(inPlace.id);
          children.push({ ...base, action: 'present', existing: { id: inPlace.id, name: inPlace.name } });
          continue;
        }
        const movable = matches.find((x) => x.parentId === null && !hasKids.has(x.id));
        if (movable) {
          used.add(movable.id);
          children.push({ ...base, action: 'move', existing: { id: movable.id, name: movable.name } });
          continue;
        }
        // Уже есть под другим родителем, с подкатегориями у себя, в архиве или называется как чей-то родитель: свою копию не заводим.
        const anywhere = [...live, ...archived].some((x) => keys.has(nameKey(x.name)));
        if (anywhere) continue;
        children.push({ ...base, action: 'create' });
      }
      // Родитель заводится (или возвращается) ради подкатегорий: пустую группу не предлагаем
      const work = children.filter((x) => x.action !== 'present').length;
      const open = work === 0 ? 0 : work + (parent.action === 'present' ? 0 : 1);
      groups.push({ key: groupSlug(g), group: g, parent, children, open });
    }
  }
  return { groups };
}

/* ------------------------------ выбор ------------------------------ */

/** Ключи выбранного: у группы — её ключ, у подкатегории — её. */
export type Selection = ReadonlySet<string>;

/** Что действительно предложено «сделать» в группе: категории, которые создаются или переносятся. */
export const actionable = (g: PlanGroup): PlanChild[] => g.children.filter((c) => c.action !== 'present');

/**
 * Заранее отмеченное: «популярные» группы целиком и любая группа, где есть чьи-то категории для переноса (так и собирается порядок
 * у тех, у кого он уже есть). Остальное человек отмечает сам.
 */
export function defaultSelection(plan: CatalogPlan): Set<string> {
  const out = new Set<string>();
  for (const g of plan.groups) {
    if (!hasWork(g)) continue;
    const moves = g.children.some((c) => c.action === 'move');
    if (!g.group.popular && !moves) continue;
    out.add(g.key);
    for (const c of actionable(g)) out.add(c.key);
  }
  return out;
}

/** Отмечена ли группа целиком: все её подкатегории и (если родителя ещё нет) он сам. */
export function isGroupOn(g: PlanGroup, selected: Selection): boolean {
  const kids = actionable(g);
  return kids.length > 0 && kids.every((c) => selected.has(c.key)) && (g.parent.action === 'present' || selected.has(g.key));
}

/** Отмечено ли хоть что-то в группе (для «часть отмечена»). */
export function isGroupPartly(g: PlanGroup, selected: Selection): boolean {
  return actionable(g).some((c) => selected.has(c.key));
}

/** Переключить группу целиком: отмеченную снять вместе с подкатегориями, остальную отметить вместе с ними. */
export function toggleGroup(g: PlanGroup, selected: Selection): Set<string> {
  const next = new Set(selected);
  if (isGroupOn(g, selected)) {
    next.delete(g.key);
    for (const c of actionable(g)) next.delete(c.key);
  } else {
    next.add(g.key);
    for (const c of actionable(g)) next.add(c.key);
  }
  return next;
}

/** Переключить одну подкатегорию. Если родителя ещё нет, выбор подкатегории отмечает и его; снятие последней — снимает родителя. */
export function toggleChild(g: PlanGroup, key: string, selected: Selection): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else {
    next.add(key);
    next.add(g.key);
  }
  if (g.parent.action !== 'present' && actionable(g).every((c) => !next.has(c.key))) {
    // родитель создаётся ради подкатегорий; оставить его одного можно, нажав на сам набор — здесь он не навязывается
    next.delete(g.key);
  }
  return next;
}

/** Сколько действий будет сделано при таком выборе. Подкатегории без родителя (не отмеченного и не существующего) не считаются. */
export function countSelected(plan: CatalogPlan, selected: Selection): number {
  let n = 0;
  for (const g of plan.groups) {
    const parentOk = g.parent.action === 'present' || selected.has(g.key);
    if (g.parent.action !== 'present' && selected.has(g.key)) n++;
    if (!parentOk) continue;
    for (const c of actionable(g)) if (selected.has(c.key)) n++;
  }
  return n;
}
