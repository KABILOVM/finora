import type { Entity, LocalFields, SyncFields } from '@/domain/types';
import { TABLE_SPECS, type SyncTableName } from '@/sync/tables';
import { ValidationError } from './errors';
import {
  groupMatches,
  groupNames,
  pickGroup,
  readTracking,
  sameMergedFields,
  type DirtyBase,
  type GroupName,
} from './mergeGroups';
import { compareVersion, isCanonicalStamp } from './validate';

/**
 * Чистое правило слияния одной строки, пришедшей с сервера, с локальной.
 *
 *  - Чистая строка заменяется серверной (сервер — источник истины).
 *  - Строка с известными dirtyGroups (грязная, а также чистая, но ещё не подтверждённая сервером — см. mergeGroups.ts) сливается
 *    ПО ГРУППАМ ПОЛЕЙ: группы, которые мы не правили, берутся с сервера. По каждой нашей группе:
 *      · значения совпали — спорить не о чем;
 *      · сервер группу не менял (там то, с чего мы начали) — наша правка остаётся;
 *      · мы группу фактически не меняли — берём серверное;
 *      · менялись обе стороны — побеждает правка с более поздней меткой (метка серверной версии против метки нашей правки),
 *        а не та, чьё устройство вышло в сеть позже. Проигравшая правка ничего не оставляет «наполовину»: группа берётся целиком.
 *    Если после этого мы отличаемся от сервера, результат записывается как обычная грязная правка с НОВОЙ меткой (строго больше
 *    серверной, иначе сервер молча проигнорирует её), а память о правках пересчитывается от серверных значений.
 *  - Строка БЕЗ dirtyGroups (импорт, строка до обновления приложения) — прежнее правило: побеждает большая пара
 *    (clientUpdatedAt, deviceId), правка не пропадает молча, если она новее.
 */

export type MergeOutcome =
  /** Локальной строки не было — вставлена. */
  | 'inserted'
  /** Локальная строка была «чистой» (или все её правки совпали с серверными или проиграли) — заменена серверной версией. */
  | 'replaced'
  /** Пришла версия не новее уже известной (по serverSeq) — проигнорирована. */
  | 'ignoredStale'
  /** Локальная неотправленная правка новее или равна (или уже содержит всё нужное) — осталась. */
  | 'keptLocal'
  /** Серверная версия новее неотправленной локальной правки — локальная правка проиграла (только для строк без dirtyGroups). */
  | 'lostLocal'
  /** Локальные и серверные группы объединены в новую грязную строку с новой меткой. */
  | 'merged';

export interface MergeResult<R> {
  outcome: MergeOutcome;
  /** Что записать в базу; null — записывать нечего. */
  row: R | null;
}

/** Откуда взять метку и устройство для объединённой строки. */
export interface MergeStamper {
  deviceId: string;
  /**
   * Новая метка, строго большая серверной (часы сначала узнают серверную метку). null — не получилось (метка за границами
   * сервера): тогда строка сливается по старому правилу «новее побеждает».
   */
  next(remoteStamp: string): string | null;
}

const sameVersion = (a: { clientUpdatedAt: string; deviceId: string }, b: { clientUpdatedAt: string; deviceId: string }): boolean =>
  a.clientUpdatedAt === b.clientUpdatedAt && a.deviceId === b.deviceId;

export function mergeRemoteRow<R extends SyncFields & LocalFields>(
  table: SyncTableName,
  local: R | undefined,
  remote: Omit<R, keyof LocalFields> & SyncFields,
  serverSeq: number,
  stamper: MergeStamper,
): MergeResult<R> {
  const adopt = (known: number): R => ({ ...remote, dirty: 0, serverSeq: known, syncError: null }) as R;

  /** Прежнее правило «целиком»: побеждает большая пара (clientUpdatedAt, deviceId). */
  const wholeRow = (cur: R): MergeResult<R> => {
    if (compareVersion(remote, cur) > 0) {
      return { outcome: 'lostLocal', row: adopt(Math.max(cur.serverSeq ?? 0, serverSeq)) };
    }
    // Локальная правка новее или равна: остаётся в очереди на отправку; запоминаем, какую версию сервера уже видели.
    if (cur.serverSeq === null || serverSeq > cur.serverSeq) {
      return { outcome: 'keptLocal', row: { ...cur, serverSeq } };
    }
    return { outcome: 'keptLocal', row: null };
  };

  if (!local) return { outcome: 'inserted', row: adopt(serverSeq) };

  const tracking = readTracking(table, local);
  const seen = local.serverSeq !== null && serverSeq <= local.serverSeq;

  if (local.dirty === 0) {
    // Версию с serverSeq не больше уже известного пропускаем: равный serverSeq — это ровно та версия, что мы уже видели
    // (повтор страницы), а наша «чистая» строка могла с тех пор уйти на сервер уже с новой правкой — её нельзя откатывать.
    if (seen) return { outcome: 'ignoredStale', row: null };
    // Нечего подтверждать, либо пришла ровно наша отправленная версия — подтверждена, память о правках не нужна.
    if (!tracking || Object.keys(tracking.base).length === 0 || sameVersion(remote, local)) {
      return { outcome: 'replaced', row: adopt(serverSeq) };
    }
    // Иначе: отправленная нами версия не дошла в чистом виде (сервер отклонил её как устаревшую, её перезаписали, ответ потерялся
    // и кто-то правил дальше) — сверяем по группам так же, как грязную.
  } else {
    if (!tracking) return wholeRow(local);
    // Эту (или более старую) версию сервера мы уже учли: повтор страницы ничего не меняет и метку не растит.
    if (seen) return { outcome: 'keptLocal', row: null };
  }

  if (!tracking) return wholeRow(local); // недостижимо (обе ветки выше отсекают), нужно для типов
  const data: Record<string, unknown> = {};
  const pending: GroupName[] = [];
  const base: DirtyBase = {};
  for (const g of groupNames(table)) {
    const theirs = pickGroup(table, g, remote);
    const mine = tracking.groups.includes(g) && !groupMatches(table, g, remote, pickGroup(table, g, local));
    const known = tracking.base[g];
    let takeLocal = false;
    if (mine) {
      if (!known) takeLocal = true; // нет памяти (строка до обновления): прежнее правило — наша правка
      else if (groupMatches(table, g, remote, known.b)) takeLocal = true; // сервер группу не менял
      else if (known.p?.some((v) => groupMatches(table, g, remote, v))) takeLocal = true; // там наше же прежнее значение (перевезённое)
      else if (known.s !== true && groupMatches(table, g, local, known.b)) takeLocal = false; // мы группу не меняли
      else takeLocal = compareVersion(remote, { clientUpdatedAt: known.at, deviceId: stamper.deviceId }) <= 0; // менялись обе: позже — прав
    }
    if (takeLocal) {
      Object.assign(data, pickGroup(table, g, local));
      pending.push(g);
      base[g] = { b: theirs, at: known?.at ?? local.clientUpdatedAt, ...(known?.p ? { p: known.p } : {}) };
    } else {
      Object.assign(data, theirs);
    }
  }

  // Всё, что мы правили, уже есть на сервере (или проиграло ему): расхождений нет — принимаем серверную версию.
  if (pending.length === 0) return { outcome: 'replaced', row: adopt(serverSeq) };

  const kept = { dirtyGroups: pending, dirtyBase: base };
  // Локальная строка уже содержит ровно такое объединение и её метка новее серверной: сервер её примет, метку не растим.
  if (local.dirty === 1 && compareVersion(local, remote) > 0 && sameMergedFields(table, data, local)) {
    return { outcome: 'keptLocal', row: { ...local, ...kept, serverSeq } };
  }
  const stamp = stamper.next(remote.clientUpdatedAt);
  if (stamp === null || stamp <= remote.clientUpdatedAt) {
    // Часы не дали метку новее серверной. Грязная строка сливается по старому правилу; «чистой» (ждала подтверждения) нечем
    // конкурировать — принимаем серверную версию.
    return local.dirty === 1 ? wholeRow(local) : { outcome: 'replaced', row: adopt(serverSeq) };
  }
  return {
    outcome: 'merged',
    row: {
      ...remote,
      ...data,
      clientUpdatedAt: stamp,
      deviceId: stamper.deviceId,
      dirty: 1,
      serverSeq,
      syncError: local.syncError,
      ...kept,
    } as unknown as R,
  };
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
