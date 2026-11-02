import type { ChipOption } from '@/components/ChipPicker';
import type { Category, LocalRow } from '@/domain/types';
import { isSearching, matchesQuery, searchKey } from '@/lib/search';

/**
 * Подкатегории («Коммунальные услуги → Вода, Свет»). Данные хранят родителя у каждой категории (поле parentId, проверки — в categoriesRepo:
 * тот же вид, без циклов); в интерфейсе — один уровень: родитель и его дети. Категория, чьего родителя нет в показываемом списке (он в
 * архиве или удалён), показывается как обычная верхняя: так она не пропадает и не висит под невидимым родителем.
 */

/** Всё, что нужно знать о категории, чтобы разложить её по родителям. */
export interface TreeNode {
  id: string;
  parentId: string | null;
}

const MAX_CLIMB = 8;

/** Верхний предок категории среди показываемых (сама категория, если родителя нет в списке). */
function topOf<T extends TreeNode>(row: T, byId: ReadonlyMap<string, T>): T {
  let cur = row;
  for (let i = 0; i < MAX_CLIMB; i++) {
    const up = cur.parentId !== null && cur.parentId !== cur.id ? byId.get(cur.parentId) : undefined;
    if (!up || up === row) return cur;
    cur = up;
  }
  return cur;
}

/**
 * Порядок показа: родитель, сразу за ним его подкатегории. Группа стоит там, где в исходном порядке встретился её первый член
 * (например, в списке «самые частые первыми» группа поднимается за счёт самой частой подкатегории). Внутри группы порядок исходный.
 */
export function groupUnderParents<T extends TreeNode>(rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const top = topOf(r, byId);
    const list = groups.get(top.id);
    if (list) list.push(r);
    else groups.set(top.id, [r]);
  }
  const out: T[] = [];
  for (const [topId, members] of groups) {
    const top = byId.get(topId);
    if (top && members.includes(top)) out.push(top, ...members.filter((m) => m !== top));
    else out.push(...members);
  }
  return out;
}

/**
 * Категории под поиск по названию (порядок списка сохраняется). Подкатегория ищется по полному пути «Родитель Название»: «жильё вода» находит
 * «Вода» в «Жильё», а запрос, совпавший с самим родителем, — все его подкатегории. У найденной подкатегории показывается и родитель
 * (чтобы было видно, где она лежит). Пустой запрос возвращает всё.
 */
export function searchCategories<T extends TreeNode & { name: string }>(rows: readonly T[], query: string): T[] {
  if (!isSearching(query)) return [...rows];
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const keep = new Set<string>();
  for (const r of rows) {
    const parent = parentIn(r, byId);
    if (matchesQuery(parent === null ? r.name : `${parent.name} ${r.name}`, query)) {
      keep.add(r.id);
      if (parent !== null) keep.add(parent.id);
    }
  }
  return rows.filter((r) => keep.has(r.id));
}

/** Родитель категории, если он есть в показываемом списке. */
export function parentIn<T extends TreeNode>(row: T, byId: ReadonlyMap<string, T>): T | null {
  if (row.parentId === null || row.parentId === row.id) return null;
  return byId.get(row.parentId) ?? null;
}

/** Есть ли у категории подкатегории среди переданных. */
export function hasChildren(id: string, rows: readonly TreeNode[]): boolean {
  return rows.some((r) => r.parentId === id && r.id !== id);
}

/** Подкатегории категории, в исходном порядке. */
export function childrenOf<T extends TreeNode>(id: string, rows: readonly T[]): T[] {
  return rows.filter((r) => r.parentId === id && r.id !== id);
}

/** Идентификаторы категории и всех её подкатегорий: для фильтра «категория» — выбрав родителя, видишь и операции подкатегорий. */
export function withDescendants(id: string, rows: readonly TreeNode[]): Set<string> {
  const out = new Set<string>([id]);
  // несколько проходов: вложенность в данных может быть глубже, чем показывает интерфейс (например, после импорта)
  for (let pass = 0; pass < MAX_CLIMB; pass++) {
    let grew = false;
    for (const r of rows) {
      if (r.parentId !== null && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return out;
}

type OptionRow = Pick<LocalRow<Category>, 'id' | 'name' | 'icon' | 'color' | 'parentId'>;

/** «Родитель › Название» для плоских списков (<select>), где мелкой подписи нет. */
export function pathLabel<T extends TreeNode & { name: string }>(row: T, byId: ReadonlyMap<string, T>): string {
  const parent = parentIn(row, byId);
  return parent ? `${parent.name} › ${row.name}` : row.name;
}

/**
 * Варианты для выбора категории: родители и подкатегории в порядке «родитель, его дети»; у подкатегории — подпись `sub` с названием родителя
 * (в чипах и результатах поиска она показывается мелко перед названием) и `parent` — id родителя. `label` всегда обычное название: по нему ищется «такая категория уже есть».
 * `rows` — уже отфильтрованные и упорядоченные нужным образом (например, по частоте); порядок групп берётся из него.
 */
export function buildCategoryOptions<T extends OptionRow>(rows: readonly T[], labelOf: (row: T) => string = (r) => r.name): ChipOption[] {
  const ordered = groupUnderParents(rows);
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  return ordered.map((r) => {
    const parent = parentIn(r, byId);
    return { value: r.id, label: labelOf(r), icon: r.icon, color: r.color, ...(parent ? { sub: parent.name, parent: parent.id } : {}) };
  });
}

/** Слова названия без знаков препинания, в виде для сравнения. */
const wordsOf = (text: string): string[] => searchKey(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Варианты выбора под поиск при вводе операции. Подходит то, что содержит все слова запроса в названии или в «Родитель Название»
 * (запрос «коммун» находит и родителя, и все его подкатегории; «вода» — подкатегорию «Вода»). Лучшие совпадения — выше: сначала те, где слова
 * запроса — начала слов названия («так» → «Такси»), потом любые вхождения в название, потом совпавшие только по родителю; внутри
 * одной ступени порядок исходный (самые частые первыми). Пустой запрос возвращает всё как есть.
 */
export function searchOptions(options: readonly ChipOption[], query: string): ChipOption[] {
  if (!isSearching(query)) return [...options];
  const queryWords = searchKey(query).split(/\s+/).filter(Boolean);
  const rank = (o: ChipOption): number | null => {
    if (!matchesQuery(o.sub ? `${o.sub} ${o.label}` : o.label, query)) return null;
    if (!matchesQuery(o.label, query)) return 2;
    const words = wordsOf(o.label);
    return queryWords.every((q) => words.some((w) => w.startsWith(q))) ? 0 : 1;
  };
  return options
    .map((o, i) => ({ o, i, r: rank(o) }))
    .filter((x): x is { o: ChipOption; i: number; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.o);
}
