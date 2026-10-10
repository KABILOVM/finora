import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, type BackupFile } from '@/db';
import { basics, expense, makeStore } from './helpers';

/**
 * Атака на «одинокий суррогат»: проверка стоит в reqText, а deviceId (тоже текст, тоже уходит на сервер) её обходил.
 * (Вторая атака ломателя — «старая заметка с половинкой смайлика в базе не даёт загрузить собственную копию» — отклонена:
 * ни один путь записи в базу такой текст не пропускает, а приложение ещё не выходило, старых данных нет.)
 */

type Json = Record<string, any>;
const clone = (f: BackupFile): Json => JSON.parse(JSON.stringify(f)) as Json;
const fresh = (opts: Parameters<typeof makeStore>[0] = {}) => makeStore({ factory: new IDBFactory(), ...opts });
const CUT = '\uD83D'; // обрезанный смайлик

describe('deviceId обходит проверку суррогатов', () => {
  it('копия с «половинкой» в deviceId отвергается так же, как в названии', async () => {
    const src = await fresh();
    const b = await basics(src);
    await expense(src, b.cash.id, 1200, { categoryId: b.food.id });
    const file = clone(await exportBackup(src));
    file.wallets[0].deviceId = `phone-${CUT}`;

    const dst = await fresh({ userId: src.userId });
    const err = await importBackup(dst, file).catch((e: unknown) => e);
    const stored = (await dst.db.wallets.toArray()).map((w) => w.deviceId);
    expect(err, `deviceId в базе: ${JSON.stringify(stored)}`).toBeInstanceOf(Error);
  });
});
