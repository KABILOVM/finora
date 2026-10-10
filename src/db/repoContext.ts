import Dexie, { type Table } from 'dexie';
import type { Category, IsoDateTime, LocalRow, Settings, UUID, Wallet } from '@/domain/types';
import type { Clock } from './clock';
import { META_LAST_STAMP, type FinoraDB } from './database';
import { ValidationError } from './errors';
import { SORT_ORDER_MAX, SORT_ORDER_MIN } from './validate';

/** Всё, что нужно репозиториям: база, часы, id устройства и «сообщить подписчикам об изменении». */
export interface RepoContext {
  readonly userId: string;
  readonly deviceId: string;
  readonly db: FinoraDB;
  readonly clock: Clock;
  /** Вызывается ПОСЛЕ фиксации записи (в том числе когда запись шла внутри чужой, внешней транзакции). */
  readonly notify: () => void;
}

const notifyScheduled = new WeakSet<object>();

/**
 * Запись в одной транзакции: проверки и сама запись видят одно и то же состояние (никаких гонок между
 * «проверил — записал»). Таблица meta входит всегда: в ней живёт последняя метка часов, и она
 * сохраняется атомарно вместе со строкой. Вложенный вызов (например, из затравки) присоединяется к внешней
 * транзакции, а уведомление уходит только после её фиксации.
 */
export async function writeTx<T>(ctx: RepoContext, tables: Table[], fn: () => Promise<T>): Promise<T> {
  const outer = Dexie.currentTransaction;
  const scope = Array.from(new Set<Table>([...tables, ctx.db.meta]));
  const result = await ctx.db.transaction('rw', scope, async () => {
    // Другая вкладка этого же устройства могла выдать метку позже нашей памяти — подхватываем её.
    const saved = await ctx.db.meta.get(META_LAST_STAMP);
    if (saved && typeof saved.value === 'string') ctx.clock.observe(saved.value, true);
    return fn();
  });
  if (outer && outer.db === ctx.db) {
    if (!notifyScheduled.has(outer)) {
      notifyScheduled.add(outer);
      outer.on('complete', ctx.notify);
    }
  } else {
    ctx.notify();
  }
  return result;
}

/** Служебные поля свежей правки: метка часов, устройство, «ждёт отправки», снятый карантин. */
export function touch(ctx: RepoContext): {
  stamp: IsoDateTime;
  fields: { clientUpdatedAt: IsoDateTime; deviceId: string; dirty: 1; syncError: null };
} {
  const stamp = ctx.clock.tick();
  return { stamp, fields: { clientUpdatedAt: stamp, deviceId: ctx.deviceId, dirty: 1, syncError: null } };
}

/** Кошелёк должен существовать и не быть удалённым. */
export async function getLiveWallet(ctx: RepoContext, id: UUID, label = 'Кошелёк'): Promise<LocalRow<Wallet>> {
  const w = await ctx.db.wallets.get(id);
  if (!w) throw new ValidationError(`${label} не найден`);
  if (w.deletedAt !== null) throw new ValidationError(`${label} «${w.name}» удалён`);
  return w;
}

export async function getLiveCategory(ctx: RepoContext, id: UUID, label = 'Категория'): Promise<LocalRow<Category>> {
  const c = await ctx.db.categories.get(id);
  if (!c) throw new ValidationError(`${label} не найдена`);
  if (c.deletedAt !== null) throw new ValidationError(`${label} «${c.name}» удалена`);
  return c;
}

/** Настройки нужны для базовой валюты; до первой загрузки/затравки их нет — тогда запись операций запрещена. */
export async function requireSettings(ctx: RepoContext): Promise<LocalRow<Settings>> {
  const s = await ctx.db.settings.get(ctx.userId);
  if (!s || s.deletedAt !== null) {
    throw new ValidationError('Настройки ещё не созданы: дождитесь первой загрузки данных');
  }
  return s;
}

/**
 * Следующий порядковый номер для сортировки (после самого большого, включая архивные и удалённые).
 * Не выходит за границы сервера (±1e15): у самой границы новая запись получает ту же границу (порядок при равенстве
 * определён названием и id, см. sort.ts), а не число, которое сервер отвергнет, и не переполнение.
 */
export async function nextSortOrder(table: Table<{ sortOrder: number }, string>): Promise<number> {
  const last = await table.orderBy('sortOrder').last();
  if (!last) return 0;
  const next = Math.min(last.sortOrder, SORT_ORDER_MAX - 1) + 1;
  return Math.max(next, SORT_ORDER_MIN);
}

/** Только перечисленные ключи; значения undefined считаются «не задано». Лишние ключи — ошибка (защита от опечаток и подмены служебных полей). */
export function cleanPatch<K extends string>(
  patch: unknown,
  allowed: readonly K[],
  label: string,
): Partial<Record<K, unknown>> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationError(`${label}: ожидался объект с изменениями`);
  }
  const out: Partial<Record<K, unknown>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!(allowed as readonly string[]).includes(key)) {
      throw new ValidationError(`${label}: поле «${key}» менять нельзя`);
    }
    out[key as K] = value;
  }
  return out;
}

/** Совпадают ли указанные поля двух объектов (для «правка ничего не меняет»). */
export function sameFields<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): boolean {
  return keys.every((k) => Object.is(a[k], b[k]));
}
