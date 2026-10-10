import { ValidationError } from '@/db';
import type { RemoteRow } from '@/db';
import { SYNC_TABLES, WireError, fromWire, type SyncTableName } from './tables';
import { TransportError } from './transport';
import type { PhaseCtx } from './pushPhase';
import { newWatch, noteIncoming, reconcile, type Watch } from './reconcile';

/**
 * Фаза «получение»: по каждой таблице забираем страницы с сервера, начиная с сохранённого курса.
 * Курс двигается только вместе с записанными данными (это делает store.sync.applyRemotePage одной транзакцией).
 */

export const PULL_PAGE = 500;

/** Что показать человеку, если строка с сервера не читается этой версией приложения. */
export const UNREADABLE_MESSAGE = 'Часть данных не удалось прочитать — обновите приложение';

export interface PullResult {
  /** true, если по какой-то таблице встретилась нечитаемая строка: получение по ней остановлено, курс не сдвинут за неё. */
  unreadable: boolean;
  /** Сколько строк записано в локальную базу. */
  applied: number;
  /** Сколько записей пришлось переписать, чтобы операции не поменяли смысл (см. reconcile.ts): они ждут отправки. */
  repaired: number;
}

async function pullTable(ctx: PhaseCtx, table: SyncTableName, watch: Watch): Promise<{ unreadable: boolean; applied: number }> {
  let applied = 0;
  let cursor = await ctx.store.sync.getCursor(table);
  for (;;) {
    ctx.check();
    const raw = await ctx.transport.pull(table, cursor, PULL_PAGE);
    if (raw.length === 0) return { unreadable: false, applied };

    // Разбираем строки по порядку. Нечитаемую НЕ пропускаем: останавливаемся перед ней, а принятое до неё сохраняем.
    const good: RemoteRow<SyncTableName>[] = [];
    let unreadable = false;
    for (const row of raw) {
      try {
        good.push(fromWire(table, row));
      } catch (e) {
        if (!(e instanceof WireError)) throw e;
        unreadable = true;
        break;
      }
    }

    if (good.length > 0) {
      const maxSeq = good.reduce((m, r) => Math.max(m, r.serverSeq), 0);
      // Сервер обязан отдавать только строки новее курса. Иначе мы бы крутились на одной странице бесконечно.
      if (maxSeq <= cursor) throw new TransportError('server', `Сервер вернул строки не новее курса ${cursor} (таблица ${table})`);
      try {
        await noteIncoming(ctx.store, table, good, watch); // пока в базе ещё локальные версии
        applied += (await ctx.store.sync.applyRemotePage(table, good, maxSeq)).applied;
      } catch (e) {
        // страница не прошла проверку базы целиком — как нечитаемая: ничего не записано, курс на месте
        if (e instanceof ValidationError) return { unreadable: true, applied };
        throw e;
      }
      cursor = maxSeq;
    }
    if (unreadable) return { unreadable: true, applied };
    if (raw.length < PULL_PAGE) return { unreadable: false, applied };
  }
}

/**
 * Забирает все таблицы. Нечитаемая строка в одной таблице не мешает остальным, но итог помечается как неполный.
 * В конце (даже если получение прервалось на середине) проверяется согласованность того, что уже записано.
 */
export async function pullAll(ctx: PhaseCtx): Promise<PullResult> {
  const total: PullResult = { unreadable: false, applied: 0, repaired: 0 };
  const watch = newWatch();
  let failure: { error: unknown } | null = null;
  try {
    for (const table of SYNC_TABLES) {
      const r = await pullTable(ctx, table, watch);
      total.applied += r.applied;
      if (r.unreadable) total.unreadable = true;
    }
  } catch (error) {
    failure = { error };
  }
  try {
    ctx.check();
    total.repaired = await reconcile(ctx.store, watch);
  } catch (error) {
    failure ??= { error };
  }
  if (failure) throw failure.error;
  return total;
}
