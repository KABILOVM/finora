import type { HomeItem, HomeSize } from '@/domain/homeLayout';
import { HOME_BLOCKS, homeBlock, type HomeBlock, type HomeBlockId } from './blocks';

/**
 * Раскладка «Главной»: чистые расчёты (без React и базы). Работаем с ПОЛНЫМ списком блоков — в нём все известные блоки (и
 * показанные, и скрытые) плюс незнакомые, которые записало более новое приложение: их не рисуем, но при сохранении не теряем.
 */

/** Блок раскладки, который это приложение умеет рисовать. */
export interface HomeSlot {
  block: HomeBlock;
  on: boolean;
  /** Ширина, которую выбрал человек; нет — как задумано у блока. */
  size?: HomeSize;
  /** Валюты блока курсов, выбранные человеком; нет — доллар и рубль. */
  cur?: string[];
}

const defaultItem = (b: HomeBlock): HomeItem => (b.on ? { id: b.id } : { id: b.id, off: true });

/** Стандартная раскладка: порядок реестра, новые блоки скрыты. */
export const defaultHome = (): HomeItem[] => HOME_BLOCKS.map(defaultItem);

/**
 * Полный список по сохранённой записи. Записи нет — стандартная раскладка. Блок, которого в записи нет (он появился в приложении
 * позже), встаёт сразу за своим соседом по реестру — там, где он стоит на стандартной главной, — и показан или скрыт по умолчанию.
 */
export function resolveHome(stored: readonly HomeItem[] | null): HomeItem[] {
  if (stored === null) return defaultHome();
  const out = [...stored];
  const known = new Set(out.map((i) => i.id));
  HOME_BLOCKS.forEach((b, n) => {
    if (known.has(b.id)) return;
    const prev = n === 0 ? -1 : out.findIndex((i) => i.id === HOME_BLOCKS[n - 1]!.id);
    out.splice(prev + 1, 0, defaultItem(b));
  });
  return out;
}

/** Известные блоки по порядку раскладки. */
export function slotsOf(items: readonly HomeItem[]): HomeSlot[] {
  return items.flatMap((i) => {
    const block = homeBlock(i.id);
    return block ? [{ block, on: i.off !== true, ...(i.size ? { size: i.size } : {}), ...(i.cur ? { cur: i.cur } : {}) }] : [];
  });
}

const shown = (i: HomeItem): boolean => i.off !== true && homeBlock(i.id) !== undefined;

/**
 * Новый порядок показанных блоков: `order` — их id в нужном порядке. Скрытые и незнакомые блоки остаются на своих местах в списке.
 * Если `order` — не перестановка показанных блоков, список возвращается как был.
 */
export function reorderShown(items: readonly HomeItem[], order: readonly string[]): HomeItem[] {
  const byId = new Map(items.filter(shown).map((i) => [i.id, i]));
  if (order.length !== byId.size || new Set(order).size !== order.length || order.some((id) => !byId.has(id))) return [...items];
  let k = 0;
  return items.map((i) => (shown(i) ? byId.get(order[k++]!)! : i));
}

/** Сдвигает показанный блок на `delta` мест среди показанных (−1 — выше, +1 — ниже); у края ничего не меняет. */
export function shiftShown(items: readonly HomeItem[], id: string, delta: number): HomeItem[] {
  const order = items.filter(shown).map((i) => i.id);
  const from = order.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return [...items];
  order.splice(to, 0, ...order.splice(from, 1));
  return reorderShown(items, order);
}

/** Показать или скрыть блок: место в списке за ним остаётся, поэтому возвращённый блок встаёт туда же, где был. */
export function setShown(items: readonly HomeItem[], id: string, on: boolean): HomeItem[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const { off: _off, ...rest } = i;
    return on ? rest : { ...rest, off: true as const };
  });
}

/** Ширина блока по выбору человека. */
export function setSize(items: readonly HomeItem[], id: string, size: HomeSize): HomeItem[] {
  return items.map((i) => (i.id === id ? { ...i, size } : i));
}

/** Валюты блока курсов; null — вернуть стандартные (доллар и рубль). */
export function setCurrencies(items: readonly HomeItem[], id: string, cur: readonly string[] | null): HomeItem[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const { cur: _cur, ...rest } = i;
    return cur === null ? rest : { ...rest, cur: [...cur] };
  });
}

/** Ширина блока «как сейчас»: выбор человека, иначе задуманная у блока. Блок, который не бывает половиной, всегда во всю ширину. */
export function sizeOf(slot: Pick<HomeSlot, 'block' | 'size'>): HomeSize {
  return slot.block.half === 'never' ? 'full' : (slot.size ?? slot.block.size ?? 'full');
}

/**
 * Как блок встаёт в сетку: 'half' — половина на любом экране; 'half-wide' — половина от 560 px; 'bento' — ширину не выбирали, а
 * блок из компактных: образ «Бенто» сам ставит такие парами; 'full' — во всю ширину.
 */
export type HomeWidth = 'full' | 'half' | 'half-wide' | 'bento';

export function widthOf(slot: Pick<HomeSlot, 'block' | 'size'>): HomeWidth {
  const { block } = slot;
  if (block.half === 'never') return 'full';
  if (sizeOf(slot) === 'half') return block.half === 'always' ? 'half' : 'half-wide';
  return slot.size === undefined && block.half === 'wide' ? 'bento' : 'full';
}

/**
 * После какого из показанных блоков ставить строку-совет погоды («возьмите зонт»), когда «Погода» стоит половиной: совет идёт
 * отдельной строкой во всю ширину ПОД рядом, в котором стоит погода, а не растягивает узкую плитку. Половины встают парами по
 * порядку, поэтому погода либо вторая в своей паре (совет сразу за ней), либо первая (совет — за её соседкой справа, если та
 * тоже половина). −1 — погода скрыта или стоит во всю ширину: тогда совет остаётся внутри её карточки.
 */
export function adviceAnchor(shown: readonly Pick<HomeSlot, 'block' | 'size'>[]): number {
  const at = shown.findIndex((s) => s.block.id === 'weather');
  if (at < 0 || widthOf(shown[at]!) !== 'half') return -1;
  let before = 0;
  while (at - before - 1 >= 0 && widthOf(shown[at - before - 1]!) === 'half') before++;
  const startsRow = before % 2 === 0;
  return startsRow && at + 1 < shown.length && widthOf(shown[at + 1]!) === 'half' ? at + 1 : at;
}

// ───────────────────────── готовые наборы ─────────────────────────

export type HomePresetId = 'standard' | 'classic' | 'minimal' | 'all';

export interface HomePreset {
  id: HomePresetId;
  title: string;
  hint: string;
}

export const HOME_PRESETS: readonly HomePreset[] = [
  { id: 'standard', title: 'Стандартная', hint: 'Операции сразу под итогом' },
  { id: 'classic', title: 'Операции внизу', hint: 'Как было раньше' },
  { id: 'minimal', title: 'Минимум', hint: 'Итог, операции и кошельки' },
  { id: 'all', title: 'Всё', hint: 'Все блоки, какие есть' },
];

/** Блоки набора «Минимум»; «Требует внимания» оставлен: он появляется, только когда что-то горит. */
const MINIMAL: readonly HomeBlockId[] = ['hero', 'attention', 'recent', 'wallets'];
/** Прежняя стандартная главная (до версии 0.13): подсказки и курсы с погодой сверху, последние операции — в самом низу. */
const CLASSIC: readonly HomeBlockId[] = [
  'hero', 'templates', 'attention', 'missed', 'weekly', 'monthly', 'save', 'trip', 'daily', 'rates', 'weather', 'wallets', 'budgets', 'upcoming', 'recent',
];

/**
 * Раскладка готового набора. null — стандартная, и хранить нечего (запись в настройках очищается). Незнакомые блоки из текущей
 * раскладки сохраняются в конце списка: набор не должен стирать то, что записало более новое приложение. Выбранные человеком
 * валюты блока курсов набор тоже не трогает: он про порядок и состав блоков (их сбрасывает только «Сбросить»).
 */
export function presetHome(id: HomePresetId, current: readonly HomeItem[] = []): HomeItem[] | null {
  const unknown = current.filter((i) => homeBlock(i.id) === undefined);
  const cur = current.find((i) => i.id === 'rates')?.cur;
  // стандартной главной запись не нужна — кроме случая, когда в ней лежит выбор валют или незнакомые блоки
  if (id === 'standard' && !cur && unknown.length === 0) return null;
  const pick = (): HomeItem[] => {
    if (id === 'standard') return defaultHome();
    if (id === 'all') return HOME_BLOCKS.map((b) => ({ id: b.id }));
    if (id === 'minimal') return HOME_BLOCKS.map((b) => (MINIMAL.includes(b.id) ? { id: b.id } : { id: b.id, off: true as const }));
    // блоки, которых на прежней главной не было, встают за своими соседями по реестру и остаются скрытыми
    return resolveHome(CLASSIC.map((bid) => ({ id: bid })));
  };
  return [...pick().map((i) => (i.id === 'rates' && cur ? { ...i, cur } : i)), ...unknown];
}

/** Какому набору равна раскладка (по показанным блокам, их порядку и ширине); null — своя. */
export function matchPreset(items: readonly HomeItem[] | null): HomePresetId | null {
  if (items === null) return 'standard';
  const key = (list: readonly HomeItem[]) =>
    slotsOf(list)
      .filter((s) => s.on)
      .map((s) => `${s.block.id}:${sizeOf(s)}`)
      .join('|');
  const mine = key(items);
  return HOME_PRESETS.find((p) => key(resolveHome(presetHome(p.id))) === mine)?.id ?? null;
}
