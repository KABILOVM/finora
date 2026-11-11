/**
 * Раскладка «Главной», которую человек собрал сам: порядок блоков, какие скрыты и какой ширины. Хранится в настройках
 * (Settings.home) одним текстом и ездит между устройствами.
 * Формат: {"v":1,"items":[{"id":"hero"},{"id":"rates","size":"half","cur":["USD","EUR"]},{"id":"weather","off":true}]}.
 * Здесь только форма записи: какие блоки бывают и как они выглядят, знает экран (features/home/layout). Незнакомый id — не ошибка:
 * его записало более новое приложение, и при сохранении он остаётся на своём месте.
 * Читаем мягко (непонятное = «раскладка не задана», главная остаётся стандартной), пишем строго и в одном каноническом виде —
 * чтобы одинаковое содержимое давало одинаковый текст и не плодило лишних правок.
 */

/** Столько блоков с самыми длинными полями ещё помещается в HOME_MAX_CHARS (тест следит). */
export const HOME_MAX_ITEMS = 40;
/** Не больше, чем CHECK settings_home_len на сервере (раздел 21 supabase/schema.sql). */
export const HOME_MAX_CHARS = 4000;
/** Сколько валют помещается в блок курсов. */
export const HOME_MAX_CUR = 3;
const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const CUR_RE = /^[A-Z]{3}$/;

/** Ширина блока: во всю ширину или половина (две половины встают рядом). */
export type HomeSize = 'full' | 'half';

export interface HomeItem {
  id: string;
  /** true — блок скрыт. */
  off?: true;
  /** Ширина, которую выбрал человек; нет поля — как задумано у блока. */
  size?: HomeSize;
  /** Валюты блока курсов (коды ISO, от 1 до 3, без повторов); нет поля — доллар и рубль. */
  cur?: string[];
}

export type HomeRead = { ok: true; items: HomeItem[] } | { ok: false; error: string };

const bad = (error: string): HomeRead => ({ ok: false, error });

/** Разбирает текст настройки. Любое отклонение — `ok: false` с причиной по-русски. */
export function readHome(text: unknown): HomeRead {
  if (typeof text !== 'string') return bad('ожидался текст');
  if (text.length > HOME_MAX_CHARS) return bad(`длиннее ${HOME_MAX_CHARS} знаков`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return bad('это не JSON');
  }
  const raw = (json as { v?: unknown; items?: unknown } | null)?.items;
  if ((json as { v?: unknown } | null)?.v !== 1) return bad('неизвестная версия записи');
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > HOME_MAX_ITEMS) return bad(`блоков должно быть от 1 до ${HOME_MAX_ITEMS}`);
  const items: HomeItem[] = [];
  const seen = new Set<string>();
  for (const r of raw as unknown[]) {
    const { id, off, size, cur } = (typeof r === 'object' && r !== null ? r : {}) as { id?: unknown; off?: unknown; size?: unknown; cur?: unknown };
    if (typeof id !== 'string' || !ID_RE.test(id)) return bad(`блок ${items.length + 1}: некорректный идентификатор`);
    if (seen.has(id)) return bad('блоки повторяются');
    if (off !== undefined && off !== true) return bad(`блок «${id}»: некорректная отметка «скрыт»`);
    if (size !== undefined && size !== 'full' && size !== 'half') return bad(`блок «${id}»: некорректная ширина`);
    if (cur !== undefined && !isCurList(cur)) return bad(`блок «${id}»: некорректные валюты`);
    seen.add(id);
    items.push({ id, ...(off ? { off } : {}), ...(size ? { size } : {}), ...(cur ? { cur: [...cur] } : {}) });
  }
  return { ok: true, items };
}

function isCurList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= HOME_MAX_CUR && new Set(v).size === v.length && v.every((c) => typeof c === 'string' && CUR_RE.test(c));
}

/** Мягкое чтение: null, если записи нет или она непонятна. */
export function parseHome(text: string | null | undefined): HomeItem[] | null {
  if (text === null || text === undefined) return null;
  const r = readHome(text);
  return r.ok ? r.items : null;
}

/** Канонический текст. Бросает, если раскладка не проходит проверку, — так в настройки не попадёт мусор. */
export function stringifyHome(items: readonly HomeItem[]): string {
  const r = readHome(JSON.stringify({ v: 1, items }));
  if (!r.ok) throw new RangeError(`Главная: ${r.error}`);
  return JSON.stringify({ v: 1, items: r.items });
}
