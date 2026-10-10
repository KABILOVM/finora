import type { Entity, LocalFields, SyncFields } from '@/domain/types';
import { TABLE_SPECS, type SyncTableName } from '@/sync/tables';
import { ValidationError } from './errors';
import { compareVersion, isCanonicalStamp } from './validate';

/**
 * Чистое правило слияния одной строки, пришедшей с сервера, с локальной.
 * Сервер — источник истины для «чистых» строк; для строк с неотправленными правками
 * побеждает большая пара (clientUpdatedAt, deviceId) — правка не пропадает молча, если она новее.
 */

export type MergeOutcome =
  /** Локальной строки не было — вставлена. */
  | 'inserted'
  /** Локальная строка была «чистой» — заменена серверной версией. */
  | 'replaced'
  /** Пришла версия не новее уже известной (по serverSeq) — проигнорирована. */
  | 'ignoredStale'
  /** Локальная неотправленная правка новее или равна — осталась. */
  | 'keptLocal'
  /** Серверная версия новее неотправленной локальной правки — локальная правка проиграла. */
  | 'lostLocal';

export interface MergeResult<R> {
  outcome: MergeOutcome;
  /** Что записать в базу; null — записывать нечего. */
  row: R | null;
}

export function mergeRemoteRow<R extends SyncFields & LocalFields>(
  local: R | undefined,
  remote: Omit<R, keyof LocalFields> & SyncFields,
  serverSeq: number,
): MergeResult<R> {
  const adopt = (known: number): R => ({ ...remote, dirty: 0, serverSeq: known, syncError: null }) as R;

  if (!local) return { outcome: 'inserted', row: adopt(serverSeq) };

  if (local.dirty === 0) {
    // Версию с serverSeq не больше уже известного пропускаем: равный serverSeq — это ровно та версия, что мы уже видели
    // (повтор страницы), а наша «чистая» строка могла с тех пор уйти на сервер уже с новой правкой — её нельзя откатывать.
    if (local.serverSeq !== null && serverSeq <= local.serverSeq) return { outcome: 'ignoredStale', row: null };
    return { outcome: 'replaced', row: adopt(serverSeq) };
  }

  if (compareVersion(remote, local) > 0) {
    return { outcome: 'lostLocal', row: adopt(Math.max(local.serverSeq ?? 0, serverSeq)) };
  }
  // Локальная правка новее или равна: остаётся в очереди на отправку; запоминаем, какую версию сервера уже видели.
  if (local.serverSeq === null || serverSeq > local.serverSeq) {
    return { outcome: 'keptLocal', row: { ...local, serverSeq } };
  }
  return { outcome: 'keptLocal', row: null };
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
