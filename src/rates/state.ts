import type { CurrencyCode, IsoDateTime, RateTable } from '@/domain/types';
import { MAX_PER_UNIT, MIN_PER_UNIT, isPlainObject } from './parseUtil';
import { assessRateTable } from './sanity';

/** Всё, что сервис курсов хранит между запусками (один JSON-документ в RateStorage). */
export interface ManualRate {
  rate: number;
  setAt: IsoDateTime;
}

export interface RatesState {
  /** Свежие первыми. Несколько таблиц нужны, чтобы курс, которого нет в самой свежей (например, TJS), нашёлся в прежней. */
  tables: RateTable[];
  /**
   * «Ничьи» ручные курсы, ключ 'USD>TJS': так было до версии с пользователями, и так работает сервис, которому не назвали
   * пользователя. Как только пользователя назвали (bindUser), эти курсы переезжают в его корзину и здесь остаётся пусто.
   */
  manual: Record<string, ManualRate>;
  /** Ручные курсы по пользователям: id пользователя → ключ 'USD>TJS' → курс. Курс одного человека не виден другому. */
  manualByUser: Record<string, Record<string, ManualRate>>;
  lastRefreshAt: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastError: string | null;
}

export const STATE_VERSION = 1;
export const MAX_TABLES = 12;

/** Словарь без прототипа: любой ключ (даже '__proto__' или 'constructor') — обычный ключ, а не свойство Object.prototype. */
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const emptyState = (): RatesState => ({
  tables: [],
  manual: {},
  manualByUser: dictionary(),
  lastRefreshAt: null,
  lastAttemptAt: null,
  lastError: null,
});

/**
 * Допустимый id пользователя в корзине ручных курсов: то же правило, что у входа в приложение (isSafeUserId в auth/config):
 * непустой, не длиннее 128, без управляющих символов. Строже нельзя: человек, чей id не прошёл бы, остался бы с общей корзиной.
 */
export const isOwnerId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= 128 && !/[\u0000-\u001f]/.test(v);

/** Не больше стольких пользователей в хранилище: личному учёту хватает с огромным запасом, а файл не должен пухнуть. */
export const MAX_MANUAL_OWNERS = 50;

export const pairKey = (from: CurrencyCode, to: CurrencyCode): string => `${from}>${to}`;

/** Только перечисленные поля RateTable (например, без warnings) и копия perUnit. */
export function cleanTable(t: RateTable): RateTable {
  return { asOf: t.asOf, pivot: t.pivot, perUnit: { ...t.perUnit }, source: t.source, fetchedAt: t.fetchedAt };
}

const isIsoDateTime = (v: unknown): v is IsoDateTime => typeof v === 'string' && !Number.isNaN(Date.parse(v));
/**
 * Текст последней ошибки из хранилища. Прежние версии могли записать туда английское системное сообщение
 * («Failed to fetch», «HTTP 503»): такое человеку не показываем, оставляем только суть.
 */
const russianOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const hasRussian = /[А-Яа-яЁё]/.test(v);
  const noisy = /failed to fetch|load failed|network ?error|aborterror|typeerror|\bHTTP\s*\d{3}\b/i.test(v);
  return hasRussian && !noisy ? v : 'Не удалось обновить курсы';
};

/** Объединение без дублей (источник + дата; побеждает более поздний fetchedAt), свежие первыми, не больше MAX_TABLES. */
export function mergeTables(a: readonly RateTable[], b: readonly RateTable[]): RateTable[] {
  const byKey = new Map<string, RateTable>();
  for (const t of [...a, ...b]) {
    const k = `${t.source}|${t.asOf}`;
    const cur = byKey.get(k);
    if (!cur || t.fetchedAt > cur.fetchedAt) byKey.set(k, t);
  }
  return [...byKey.values()]
    .sort((x, y) => (x.asOf !== y.asOf ? (x.asOf < y.asOf ? 1 : -1) : x.fetchedAt < y.fetchedAt ? 1 : x.fetchedAt > y.fetchedAt ? -1 : 0))
    .slice(0, MAX_TABLES);
}

/** Только что полученная таблица ВСЕГДА заменяет сохранённую с тем же источником и датой (метка fetchedAt зависит от часов устройства). */
export function putTable(tables: readonly RateTable[], incoming: RateTable): RateTable[] {
  return mergeTables(
    tables.filter((t) => !(t.source === incoming.source && t.asOf === incoming.asOf)),
    [incoming],
  );
}

/** Есть ли в хранилище документ нашего формата (а не пусто / мусор / чужая версия). */
export const isStoredState = (raw: unknown): boolean => isPlainObject(raw) && raw.v === STATE_VERSION;

/** Метка времени → миллисекунды; нет метки — минус бесконечность (любая настоящая новее). */
export const stamp = (iso: IsoDateTime | null): number => (iso === null ? -Infinity : Date.parse(iso));

/** Корзина ручных курсов из хранилища: битые пары (ключ, курс, метка) отбрасываются. */
function parseManual(raw: unknown): Record<string, ManualRate> {
  const out: Record<string, ManualRate> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, m] of Object.entries(raw)) {
    const [from, to] = key.split('>');
    const validKey = /^[A-Z]{3}>[A-Z]{3}$/.test(key) && from !== to;
    if (validKey && isPlainObject(m) && typeof m.rate === 'number' && m.rate >= MIN_PER_UNIT && m.rate <= MAX_PER_UNIT && isIsoDateTime(m.setAt)) {
      out[key] = { rate: m.rate, setAt: m.setAt };
    }
  }
  return out;
}

/** Не бросает: повреждённые части отбрасываются, остальное сохраняется. */
export function normalizeStored(raw: unknown): RatesState {
  const state = emptyState();
  if (!isPlainObject(raw) || raw.v !== STATE_VERSION) return state;
  if (Array.isArray(raw.tables)) {
    const ok: RateTable[] = [];
    for (const t of raw.tables as unknown[]) {
      if (isPlainObject(t) && typeof t.source === 'string' && assessRateTable(t as unknown as RateTable).ok) {
        ok.push(cleanTable(t as unknown as RateTable));
      }
    }
    state.tables = mergeTables(ok, []);
  }
  state.manual = parseManual(raw.manual);
  if (isPlainObject(raw.manualByUser)) {
    for (const [owner, rates] of Object.entries(raw.manualByUser)) {
      if (Object.keys(state.manualByUser).length >= MAX_MANUAL_OWNERS) break;
      if (!isOwnerId(owner)) continue;
      const parsed = parseManual(rates);
      if (Object.keys(parsed).length > 0) state.manualByUser[owner] = parsed;
    }
  }
  state.lastRefreshAt = isIsoDateTime(raw.lastRefreshAt) ? raw.lastRefreshAt : null;
  state.lastAttemptAt = isIsoDateTime(raw.lastAttemptAt) ? raw.lastAttemptAt : null;
  state.lastError = russianOrNull(raw.lastError);
  return state;
}

export function serializeState(state: RatesState): unknown {
  return { v: STATE_VERSION, ...state };
}
