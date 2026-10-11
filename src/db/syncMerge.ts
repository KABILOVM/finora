import type { Entity, IsoDateTime, LocalFields, SyncFields } from '@/domain/types';
import { MERGE_GROUPS, TABLE_SPECS, type SyncTableName } from '@/sync/tables';
import { ValidationError } from './errors';
import { compareVersion, isCanonicalStamp } from './validate';

/**
 * Чистое правило слияния одной строки, пришедшей с сервера, с локальной.
 * Сервер — источник истины для «чистых» строк. Для строк с неотправленными правками работает трёхстороннее слияние по группам
 * полей (MERGE_GROUPS): база — версия сервера, поверх которой сделаны наши правки (LocalFields.dirtyBase), «наша» — локальная
 * строка, «чужая» — пришедшая. Группу, которую изменила только одна сторона, берём у неё; если изменили обе и по-разному —
 * побеждает большая пара (clientUpdatedAt, deviceId), целиком группой. Так правка заметки с одного телефона и правка суммы
 * с другого не затирают друг друга, как бы ни разошлись часы. Нет базы (строка создана здесь, данные от старой версии) —
 * прежнее правило: побеждает вся строка с большей парой.
 */

export type MergeOutcome =
  /** Локальной строки не было — вставлена. */
  | 'inserted'
  /** Локальная строка была «чистой» (или это эхо нашей же правки) — заменена серверной версией. */
  | 'replaced'
  /** Пришла версия не новее уже известной (по serverSeq) — проигнорирована. */
  | 'ignoredStale'
  /** Локальная неотправленная правка новее или равна: осталась целиком, база сдвинута на серверную версию. */
  | 'keptLocal'
  /** Серверная версия поглотила неотправленную локальную правку (она проиграла или всех групп уже нет) — локальная правка потеряна. */
  | 'lostLocal'
  /** Правки обеих сторон сложены: строка осталась «грязной» с новой меткой этого устройства поверх серверной версии. */
  | 'merged';

export interface MergeResult<R> {
  outcome: MergeOutcome;
  /** Что записать в базу; null — записывать нечего. */
  row: R | null;
}

/** Чем располагает слияние для трёхстороннего режима. Без него (или без базы у строки) работает слияние целой строкой. */
export interface MergeContext {
  table: SyncTableName;
  /** Свежая метка правки этого устройства — больше всех, что устройство видело (в том числе в пришедшей странице). Может бросить. */
  stamp(): IsoDateTime;
  deviceId: string;
}

type Rec = Record<string, unknown>;

/** Колонки договора строки (лишнее — dirty, serverSeq, dirtyBase — отбрасывается). Это и есть «версия» для слияния. */
export function snapshotRow(table: SyncTableName, row: unknown): Record<string, unknown> {
  const src = row as Rec;
  const out: Rec = {};
  for (const c of TABLE_SPECS[table].columns) out[c.field] = src[c.field] ?? null;
  return out;
}

const sameGroup = (group: readonly string[], a: Rec, b: Rec): boolean => group.every((f) => Object.is(a[f] ?? null, b[f] ?? null));

/** Одинаково ли содержимое строк (все группы; служебные id, createdAt и версия не в счёт). */
export function sameContent(table: SyncTableName, a: unknown, b: unknown): boolean {
  return MERGE_GROUPS[table].every((g) => sameGroup(g, a as Rec, b as Rec));
}

/**
 * Складывает правки по группам. Побеждает у конфликтующей группы (изменили обе стороны и по-разному) большая версия;
 * при равных версиях и разном содержимом — серверная.
 */
function combine(table: SyncTableName, base: Rec, local: Rec, remote: Rec): Rec {
  const localWins = compareVersion(local as never, remote as never) > 0;
  const out: Rec = {};
  for (const group of MERGE_GROUPS[table]) {
    const mine = !sameGroup(group, local, base);
    const theirs = !sameGroup(group, remote, base);
    let src: Rec;
    if (mine && theirs) src = sameGroup(group, local, remote) || !localWins ? remote : local;
    else src = mine ? local : remote;
    for (const f of group) out[f] = src[f] ?? null;
  }
  return out;
}

export function mergeRemoteRow<R extends SyncFields & LocalFields>(
  local: R | undefined,
  remote: Omit<R, keyof LocalFields> & SyncFields,
  serverSeq: number,
  ctx?: MergeContext,
): MergeResult<R> {
  const adopt = (known: number): R => ({ ...remote, dirty: 0, serverSeq: known, syncError: null }) as R;

  if (!local) return { outcome: 'inserted', row: adopt(serverSeq) };

  if (local.dirty === 0) {
    // Версию с serverSeq не больше уже известного пропускаем: равный serverSeq — это ровно та версия, что мы уже видели
    // (повтор страницы), а наша «чистая» строка могла с тех пор уйти на сервер уже с новой правкой — её нельзя откатывать.
    if (local.serverSeq !== null && serverSeq <= local.serverSeq) return { outcome: 'ignoredStale', row: null };
    return { outcome: 'replaced', row: adopt(serverSeq) };
  }

  const known = Math.max(local.serverSeq ?? 0, serverSeq);

  const base = ctx ? (local.dirtyBase ?? null) : null;
  if (ctx && base !== null) {
    // Эту или более позднюю серверную версию мы уже сливали с нашими правками.
    if (local.serverSeq !== null && serverSeq <= local.serverSeq) return { outcome: 'keptLocal', row: null };
    // Эхо нашей же правки (сервер принял её, а ответ потерялся) тоже попадает сюда: содержимое то же, строка становится «чистой».
    const merged = threeWay(local, remote, known, base, ctx);
    if (merged) return merged;
  }

  if (compareVersion(remote, local) > 0) {
    return { outcome: 'lostLocal', row: adopt(known) };
  }
  // Локальная правка новее или равна: остаётся в очереди на отправку; запоминаем, какую версию сервера уже видели.
  if (local.serverSeq === null || serverSeq > local.serverSeq) {
    return { outcome: 'keptLocal', row: { ...local, serverSeq } };
  }
  return { outcome: 'keptLocal', row: null };
}

/** Трёхстороннее слияние. null — не вышло (нет метки от часов): вызывающий откатывается к слиянию целой строкой. */
function threeWay<R extends SyncFields & LocalFields>(
  local: R,
  remote: Omit<R, keyof LocalFields> & SyncFields,
  known: number,
  base: Rec,
  ctx: MergeContext,
): MergeResult<R> | null {
  const { table } = ctx;
  const merged = combine(table, base, local as unknown as Rec, remote as unknown as Rec);
  const adopt = (): R => ({ ...remote, dirty: 0, serverSeq: known, syncError: null }) as R;

  // Серверная версия включает всё, что у нас осталось: наши правки уже в ней (её сделали из нашей же версии) или проиграли.
  if (sameContent(table, merged, remote)) {
    return { outcome: sameContent(table, local, remote) ? 'replaced' : 'lostLocal', row: adopt() };
  }

  const nextBase = snapshotRow(table, remote);
  // Всё своё сохранили, и наша метка новее серверной: отправляем как есть, только база и версия сервера сдвигаются.
  if (sameContent(table, merged, local) && compareVersion(remote, local) < 0) {
    return { outcome: 'keptLocal', row: { ...local, serverSeq: known, dirtyBase: nextBase } };
  }

  // Настоящее слияние (или своя правка со старой меткой, которую сервер молча проигнорировал бы): новая правка этого
  // устройства поверх серверной версии — с меткой, которая больше всех виденных.
  let stamp: IsoDateTime;
  try {
    stamp = ctx.stamp();
  } catch {
    return null;
  }
  const row = {
    ...remote,
    ...merged,
    clientUpdatedAt: stamp,
    deviceId: ctx.deviceId,
    dirty: 1,
    serverSeq: known,
    syncError: null,
    dirtyBase: nextBase,
  } as unknown as R;
  return { outcome: 'merged', row };
}

/**
 * Берёт из «сырой» строки ровно колонки договора (лишнее отбрасывается), проверяя типы.
 * Бросает ValidationError — до любой записи в базу.
 */
export function pickColumns(table: SyncTableName, raw: unknown): Entity {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`Строка ${table}: ожидался объект`);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const col of TABLE_SPECS[table].columns) {
    const v = src[col.field];
    if (v === undefined || v === null) {
      if (!col.nullable) throw new ValidationError(`Строка ${table}: обязательное поле «${col.field}» пустое`);
      out[col.field] = null;
      continue;
    }
    switch (col.type) {
      case 'uuid':
      case 'text':
      case 'date':
        if (typeof v !== 'string') throw new ValidationError(`Строка ${table}: поле «${col.field}» должно быть текстом`);
        break;
      case 'int':
        if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
          throw new ValidationError(`Строка ${table}: поле «${col.field}» должно быть целым числом`);
        }
        break;
      case 'num':
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          throw new ValidationError(`Строка ${table}: поле «${col.field}» должно быть числом`);
        }
        break;
      case 'ts':
        if (!isCanonicalStamp(v)) throw new ValidationError(`Строка ${table}: поле «${col.field}» — некорректная метка времени`);
        break;
    }
    out[col.field] = v;
  }
  if (typeof out['id'] !== 'string' || out['id'] === '') throw new ValidationError(`Строка ${table}: нет id`);
  return out as unknown as Entity;
}
