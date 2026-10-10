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
  /** Ключ 'USD>TJS'. */
  manual: Record<string, ManualRate>;
  lastRefreshAt: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastError: string | null;
}

export const STATE_VERSION = 1;
export const MAX_TABLES = 12;

export const emptyState = (): RatesState => ({ tables: [], manual: {}, lastRefreshAt: null, lastAttemptAt: null, lastError: null });

export const pairKey = (from: CurrencyCode, to: CurrencyCode): string => `${from}>${to}`;

/** Только перечисленные поля RateTable (например, без warnings) и копия perUnit. */
export function cleanTable(t: RateTable): RateTable {
  return { asOf: t.asOf, pivot: t.pivot, perUnit: { ...t.perUnit }, source: t.source, fetchedAt: t.fetchedAt };
}

const isIsoDateTime = (v: unknown): v is IsoDateTime => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

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
  if (isPlainObject(raw.manual)) {
    for (const [key, m] of Object.entries(raw.manual)) {
      const [from, to] = key.split('>');
      const validKey = /^[A-Z]{3}>[A-Z]{3}$/.test(key) && from !== to;
      if (validKey && isPlainObject(m) && typeof m.rate === 'number' && m.rate >= MIN_PER_UNIT && m.rate <= MAX_PER_UNIT && isIsoDateTime(m.setAt)) {
        state.manual[key] = { rate: m.rate, setAt: m.setAt };
      }
    }
  }
  state.lastRefreshAt = isIsoDateTime(raw.lastRefreshAt) ? raw.lastRefreshAt : null;
  state.lastAttemptAt = isIsoDateTime(raw.lastAttemptAt) ? raw.lastAttemptAt : null;
  state.lastError = orNull(raw.lastError);
  return state;
}

export function serializeState(state: RatesState): unknown {
  return { v: STATE_VERSION, ...state };
}
