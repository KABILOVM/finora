import Dexie from 'dexie';
import type { Entity, IsoDateTime, LocalRow, UUID } from '@/domain/types';
import { SYNC_TABLES, type EntityOf, type SyncTableName } from '@/sync/tables';
import type { Clock } from './clock';
import { cursorKey, META_LAST_STAMP, type FinoraDB, type MetaValue } from './database';
import { ValidationError } from './errors';
import { mergeRemoteRow, pickColumns } from './syncMerge';

/**
 * Примитивы для движка синхронизации. Движок только оркестрирует (когда слать, когда забирать),
 * а правила целостности — здесь: каждая операция атомарна (одна транзакция Dexie).
 */

/** Какая именно версия строки была отправлена. */
export interface PushedRef {
  id: UUID;
  clientUpdatedAt: IsoDateTime;
  deviceId: string;
}

export interface RemoteRow<T extends SyncTableName> {
  entity: EntityOf<T>;
  serverSeq: number;
}

export interface ApplyResult {
  /** Сколько строк с сервера записано в базу (вставлено или заменило локальную версию). */
  applied: number;
  /** Сколько неотправленных локальных правок оказались новее серверной версии и остались. */
  keptLocal: number;
  /** Сколько неотправленных локальных правок проиграли более новой серверной версии (входят в applied). */
  lostLocal: number;
}

export interface SyncCounts {
  /** Ждут отправки (без карантина). */
  pending: number;
  /** Отвергнуты сервером; не блокируют остальные, пока человек не исправит запись или не нажмёт «повторить». */
  quarantined: number;
}

export interface SyncOps {
  /** Курс (server_seq последней применённой строки) таблицы; 0 по умолчанию. */
  getCursor(table: SyncTableName): Promise<number>;
  getMeta(key: string): Promise<MetaValue | undefined>;
  /** Служебные ключи ('lastStamp', 'cursor:*') менять нельзя — для них есть свои методы. */
  setMeta(key: string, value: MetaValue): Promise<void>;
  /** Строки dirty=1 БЕЗ карантина, старые первыми. */
  listDirty<T extends SyncTableName>(table: T, limit: number): Promise<LocalRow<EntityOf<T>>[]>;
  /**
   * Сервер принял отправленные версии. Строка перестаёт быть «грязной» ТОЛЬКО если у неё всё ещё те же
   * clientUpdatedAt и deviceId: если человек успел её исправить во время отправки — остаётся в очереди.
   * Возвращает, сколько строк очищено.
   */
  markPushed(table: SyncTableName, pushed: readonly PushedRef[]): Promise<number>;
  /**
   * Сервер отверг строки. Строка с PushedRef помещается в карантин, только если это всё ещё та же версия
   * (правка во время отправки не должна попасть в карантин за чужую ошибку). Голый id — безусловно.
   * Возвращает, сколько строк помещено в карантин.
   */
  quarantine(table: SyncTableName, items: readonly (UUID | PushedRef)[], message: string): Promise<number>;
  /** Снимает карантин со всех строк (они снова пойдут в отправку). Возвращает их число. */
  retryQuarantined(): Promise<number>;
  /**
   * Применяет страницу с сервера и сдвигает курс В ОДНОЙ транзакции: сбой не оставит курс впереди данных.
   * nextCursor не может опережать ни прежний курс, ни наибольший serverSeq страницы — иначе часть данных
   * была бы пропущена навсегда.
   */
  applyRemotePage<T extends SyncTableName>(
    table: T,
    rows: readonly RemoteRow<T>[],
    nextCursor: number,
  ): Promise<ApplyResult>;
  counts(): Promise<SyncCounts>;
  /** Полная пересинхронизация: курсы всех таблиц в 0. Локальные данные не трогает. */
  resetCursors(): Promise<void>;
}

const MAX_MESSAGE = 500;
const MAX_LIMIT = 10_000;

function assertTable(table: unknown): asserts table is SyncTableName {
  if (!(SYNC_TABLES as readonly unknown[]).includes(table)) {
    throw new ValidationError(`Неизвестная таблица синхронизации: ${String(table)}`);
  }
}

function assertRef(ref: unknown): asserts ref is PushedRef {
  const r = ref as Partial<PushedRef> | null;
  if (
    typeof r !== 'object' ||
    r === null ||
    typeof r.id !== 'string' ||
    typeof r.clientUpdatedAt !== 'string' ||
    typeof r.deviceId !== 'string'
  ) {
    throw new ValidationError('Отправленная версия записи описана неверно: нужны id, clientUpdatedAt и deviceId');
  }
}

const isSafeSeq = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

type AnyRow = LocalRow<Entity>;

export function createSyncOps(db: FinoraDB, clock: Clock): SyncOps {
  const readCursor = async (table: SyncTableName): Promise<number> => {
    const row = await db.meta.get(cursorKey(table));
    return row && isSafeSeq(row.value) ? row.value : 0;
  };

  return {
    async getCursor(table) {
      assertTable(table);
      return readCursor(table);
    },

    async getMeta(key) {
      return (await db.meta.get(key))?.value;
    },

    async setMeta(key, value) {
      if (typeof key !== 'string' || key === '' || key.length > 100) throw new ValidationError('Ключ служебных данных некорректен');
      if (key === META_LAST_STAMP || key.startsWith('cursor:')) {
        throw new ValidationError(`Ключ «${key}» служебный: менять его напрямую нельзя`);
      }
      await db.meta.put({ key, value });
    },

    async listDirty<T extends SyncTableName>(table: T, limit: number) {
      assertTable(table);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ValidationError(`Размер пачки: целое от 1 до ${MAX_LIMIT}`);
      }
      const rows = await db
        .syncTable(table as SyncTableName)
        .where('[dirty+clientUpdatedAt]')
        .between([1, Dexie.minKey], [1, Dexie.maxKey])
        .filter((r) => r.syncError === null)
        .limit(limit)
        .toArray();
      return rows as unknown as LocalRow<EntityOf<T>>[];
    },

    async markPushed(table, pushed) {
      assertTable(table);
      pushed.forEach(assertRef);
      const tbl = db.syncTable(table);
      return db.transaction('rw', tbl, async () => {
        const rows = await tbl.bulkGet(pushed.map((p) => p.id));
        const cleared: AnyRow[] = [];
        rows.forEach((row, i) => {
          const p = pushed[i];
          if (!row || !p || row.dirty !== 1) return;
          if (row.clientUpdatedAt !== p.clientUpdatedAt || row.deviceId !== p.deviceId) return;
          cleared.push({ ...row, dirty: 0, syncError: null });
        });
        if (cleared.length > 0) await tbl.bulkPut(cleared);
        return cleared.length;
      });
    },

    async quarantine(table, items, message) {
      assertTable(table);
      const text = (typeof message === 'string' ? message.trim() : '').slice(0, MAX_MESSAGE) || 'Сервер отверг запись';
      const tbl = db.syncTable(table);
      const refs = items.map((it) => {
        if (typeof it === 'string') return { id: it, version: null };
        assertRef(it);
        return { id: it.id, version: it };
      });
      return db.transaction('rw', tbl, async () => {
        const rows = await tbl.bulkGet(refs.map((r) => r.id));
        const changed: AnyRow[] = [];
        rows.forEach((row, i) => {
          const ref = refs[i];
          if (!row || !ref || row.dirty !== 1) return;
          if (ref.version && (row.clientUpdatedAt !== ref.version.clientUpdatedAt || row.deviceId !== ref.version.deviceId)) return;
          changed.push({ ...row, syncError: text });
        });
        if (changed.length > 0) await tbl.bulkPut(changed);
        return changed.length;
      });
    },

    async retryQuarantined() {
      const tables = SYNC_TABLES.map((n) => db.syncTable(n));
      return db.transaction('rw', tables, async () => {
        let n = 0;
        for (const tbl of tables) {
          const stuck = await tbl
            .where('dirty')
            .equals(1)
            .filter((r) => r.syncError !== null)
            .toArray();
          if (stuck.length === 0) continue;
          await tbl.bulkPut(stuck.map((r) => ({ ...r, syncError: null })));
          n += stuck.length;
        }
        return n;
      });
    },

    async applyRemotePage<T extends SyncTableName>(table: T, rows: readonly RemoteRow<T>[], nextCursor: number) {
      assertTable(table);
      if (!isSafeSeq(nextCursor)) throw new ValidationError('Курс синхронизации: ожидалось неотрицательное целое');
      if (!Array.isArray(rows)) throw new ValidationError('Страница с сервера: ожидался список строк');

      // Вся проверка страницы — ДО первой записи.
      const incoming = rows.map((r) => {
        if (!r || !isSafeSeq(r.serverSeq) || r.serverSeq < 1) {
          throw new ValidationError('Строка с сервера: serverSeq должен быть целым числом от 1');
        }
        return { entity: pickColumns(table, r.entity) as AnyRow, serverSeq: r.serverSeq };
      });
      const maxSeq = incoming.reduce((m, r) => Math.max(m, r.serverSeq), 0);
      // метки страницы от больших к меньшим: часам хватит самой большой из правдоподобных
      const stampsDesc = [...new Set(incoming.map((r) => r.entity.clientUpdatedAt))].sort().reverse();

      const tbl = db.syncTable(table as SyncTableName);
      return db.transaction('rw', [tbl, db.meta], async () => {
        const cursor = await readCursor(table);
        if (nextCursor > Math.max(cursor, maxSeq)) {
          throw new ValidationError(
            `Курс ${nextCursor} опережает полученные данные (последний serverSeq страницы: ${maxSeq}, прежний курс: ${cursor})`,
          );
        }

        // Состояние страницы в памяти: повтор одного id внутри страницы видит результат предыдущей строки.
        const known = new Map<string, AnyRow | undefined>();
        const ids = [...new Set(incoming.map((r) => r.entity.id))];
        (await tbl.bulkGet(ids)).forEach((row, i) => known.set(ids[i] as string, row));

        const result: ApplyResult = { applied: 0, keptLocal: 0, lostLocal: 0 };
        const dirtyIds = new Set<string>();
        for (const { entity, serverSeq } of incoming) {
          const m = mergeRemoteRow(known.get(entity.id), entity, serverSeq);
          if (m.row) {
            known.set(entity.id, m.row);
            dirtyIds.add(entity.id);
          }
          if (m.outcome === 'inserted' || m.outcome === 'replaced') result.applied++;
          else if (m.outcome === 'lostLocal') {
            result.applied++;
            result.lostLocal++;
          } else if (m.outcome === 'keptLocal') result.keptLocal++;
        }
        const toWrite = [...dirtyIds].map((id) => known.get(id)).filter((r): r is AnyRow => r !== undefined);
        if (toWrite.length > 0) await tbl.bulkPut(toWrite);

        // следующие правки этого устройства будут новее всего, что мы видели
        for (const st of stampsDesc) if (clock.observe(st)) break;
        await db.meta.put({ key: cursorKey(table), value: Math.max(cursor, nextCursor) });
        return result;
      });
    },

    async counts() {
      const tables = SYNC_TABLES.map((n) => db.syncTable(n));
      return db.transaction('r', tables, async () => {
        let pending = 0;
        let quarantined = 0;
        for (const tbl of tables) {
          const dirty = await tbl.where('dirty').equals(1).toArray();
          for (const r of dirty) {
            if (r.syncError === null) pending++;
            else quarantined++;
          }
        }
        return { pending, quarantined };
      });
    },

    async resetCursors() {
      await db.meta.bulkDelete(SYNC_TABLES.map(cursorKey));
    },
  };
}
