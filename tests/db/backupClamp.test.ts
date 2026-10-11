import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, importBackup, ValidationError, type BackupFile, type Store } from '@/db';
import { MAX_FUTURE_SKEW_MS, MAX_STAMP, MIN_STAMP } from '@/db/clock';
import { basics, expense, makeStore } from './helpers';

/**
 * Старые копии: метки createdAt / deletedAt / archivedAt / clientUpdatedAt вне 2000-01-01 … 2100-01-01 (сервер отвергает
 * такие строки навсегда) подрезаются до границы, а файл НЕ отвергается. Порядок «новее побеждает» сохраняется.
 */

type Json = Record<string, any>;
const clone = (f: BackupFile): Json => JSON.parse(JSON.stringify(f)) as Json;
const fresh = (opts: Parameters<typeof makeStore>[0] = {}) => makeStore({ factory: new IDBFactory(), ...opts });

const Y1970 = '1970-01-01T00:00:00.000Z';
const Y1999 = '1999-12-31T23:59:59.999Z';
const Y2200 = '2200-06-01T00:00:00.000Z';

/** Источник: всё, у чего бывают все четыре метки: удалённая операция, архивные кошелёк и категория. */
async function populated(store: Store) {
  const b = await basics(store);
  await expense(store, b.cash.id, 1200, { categoryId: b.food.id, note: 'Обед' });
  const gone = await expense(store, b.cash.id, 300);
  await store.transactions.softDelete(gone.id);
  await store.wallets.archive(b.usd.id);
  await store.categories.archive(b.salary.id);
  return b;
}

const allRows = (f: Json): Json[] => [f.settings, ...f.wallets, ...f.categories, ...f.transactions].filter(Boolean);

async function storedStamps(store: Store): Promise<{ table: string; id: string; field: string; value: string }[]> {
  const out: { table: string; id: string; field: string; value: string }[] = [];
  for (const [name, t] of [['settings', store.db.settings], ['wallets', store.db.wallets], ['categories', store.db.categories], ['transactions', store.db.transactions]] as const) {
    for (const r of (await t.toArray()) as unknown as Json[]) {
      for (const field of ['createdAt', 'clientUpdatedAt', 'deletedAt', 'archivedAt']) {
        if (typeof r[field] === 'string') out.push({ table: name, id: r['id'], field, value: r[field] });
      }
    }
  }
  return out;
}

describe('импорт: метки вне границ сервера подрезаются, а не отвергают файл', () => {
  it('метки 1970 года → 2000-01-01; архивные и удалённые тоже; файл принят целиком', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    for (const r of allRows(file)) {
      r.createdAt = Y1970;
      r.clientUpdatedAt = Y1970;
      if (r.deletedAt !== null && r.deletedAt !== undefined) r.deletedAt = Y1970;
      if (r.archivedAt !== null && r.archivedAt !== undefined) r.archivedAt = Y1970;
    }
    expect(allRows(file).some((r) => r.archivedAt === Y1970)).toBe(true);
    expect(allRows(file).some((r) => r.deletedAt === Y1970)).toBe(true);

    const dst = await fresh();
    const res = await importBackup(dst, file);
    expect(res.added).toBe(allRows(file).length);

    const stamps = await storedStamps(dst);
    expect(stamps.length).toBeGreaterThan(allRows(file).length * 2);
    for (const s of stamps) expect(s.value, `${s.table}.${s.field}`).toBe(MIN_STAMP);
    expect(stamps.some((s) => s.field === 'archivedAt')).toBe(true);
    expect(stamps.some((s) => s.field === 'deletedAt')).toBe(true);
  });

  it('метки на 1 мс раньше границы подрезаются, ровно на границе — остаются как есть', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    file.wallets[0].createdAt = Y1999;
    file.wallets[0].clientUpdatedAt = MIN_STAMP;
    const dst = await fresh();
    await importBackup(dst, file);
    const w = (await dst.db.wallets.get(file.wallets[0].id))!;
    expect(w.createdAt).toBe(MIN_STAMP);
    expect(w.clientUpdatedAt).toBe(MIN_STAMP);
  });

  it('метки после 2100 года больше не «порча файла»: подрезаются (createdAt/clientUpdatedAt/deletedAt — до времени создания копии, archivedAt — до 2100-01-01)', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    const w = file.wallets.find((x: Json) => x.archivedAt !== null)!;
    const tx = file.transactions.find((x: Json) => x.deletedAt !== null)!;
    w.createdAt = Y2200;
    w.clientUpdatedAt = '2100-01-01T00:00:00.001Z'; // раньше это отвергало весь файл
    w.archivedAt = Y2200;
    tx.createdAt = Y2200;
    tx.deletedAt = Y2200;
    tx.clientUpdatedAt = Y2200;

    const dst = await fresh();
    await importBackup(dst, file);
    const limit = new Date(Date.now() + MAX_FUTURE_SKEW_MS).toISOString();

    // Метка из будущего заменяется временем создания копии: оно одно и то же при каждом импорте (см. importFuture.adversarial).
    const wRow = (await dst.db.wallets.get(w.id))!;
    const tRow = (await dst.db.transactions.get(tx.id))!;
    for (const v of [wRow.createdAt, wRow.clientUpdatedAt, tRow.createdAt, tRow.deletedAt!, tRow.clientUpdatedAt]) {
      expect(v, v).toBe(file.exportedAt);
      expect(v <= limit, v).toBe(true);
    }
    expect(wRow.archivedAt).toBe(MAX_STAMP);
    for (const s of await storedStamps(dst)) expect(s.value >= MIN_STAMP && s.value <= MAX_STAMP, `${s.table}.${s.field}=${s.value}`).toBe(true);
  });

  it('метки внутри границ не трогаются ни на миллисекунду', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    const dst = await fresh();
    await importBackup(dst, file);
    const again = clone(await exportBackup(dst));
    expect({ ...again, exportedAt: '' }).toEqual({ ...file, exportedAt: '' });
  });

  it('часы устройства, на которое грузим копию, сброшены на 1970 год: метки всё равно внутри 2000–2100', async () => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    const dst = await fresh({ now: () => 0 });
    await importBackup(dst, file);
    for (const s of await storedStamps(dst)) expect(s.value >= MIN_STAMP && s.value <= MAX_STAMP, `${s.table}.${s.field}=${s.value}`).toBe(true);
  });

  it('мусорная метка по-прежнему отвергает файл (подрезается только настоящая метка вне границ)', async () => {
    const src = await fresh();
    await populated(src);
    for (const [field, junk] of [
      ['createdAt', '1970-01-01'],
      ['clientUpdatedAt', 'вчера'],
      ['archivedAt', '1970-01-01T00:00:00Z'],
      ['createdAt', '-000001-01-01T00:00:00.000Z'],
      ['clientUpdatedAt', 12345],
    ] as const) {
      const file = clone(await exportBackup(src));
      const w = file.wallets.find((x: Json) => x.archivedAt !== null)!;
      w[field] = junk;
      await expect(importBackup(await fresh(), file), `${field}=${String(junk)}`).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe('импорт: подрезание не ломает «новее побеждает»', () => {
  it('старая копия (метки 1970) не затирает более новые локальные правки', async () => {
    const src = await fresh({ deviceId: 'device-old-0001' });
    const b = await populated(src);
    const file = clone(await exportBackup(src));
    for (const r of allRows(file)) {
      r.createdAt = Y1970;
      r.clientUpdatedAt = Y1970;
    }
    const dst = await fresh({ deviceId: 'device-new-0002' });
    await importBackup(dst, file); // первая загрузка старой копии
    const edited = await dst.wallets.update(b.cash.id, { name: 'Новое имя' }); // свежая локальная правка
    expect(edited.clientUpdatedAt > MIN_STAMP).toBe(true);

    const res = await importBackup(dst, file); // та же старая копия ещё раз
    expect(res).toMatchObject({ replaced: 0, added: 0 });
    expect((await dst.db.wallets.get(b.cash.id))?.name).toBe('Новое имя');
  });

  it('копия со СВЕЖИМИ метками по-прежнему заменяет устаревшие локальные строки', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const a = await fresh({ now: () => t, deviceId: 'device-aaa-0001' });
    const b = await populated(a);
    const file = clone(await exportBackup(a));
    const dst = await fresh({ now: () => t, deviceId: 'device-bbb-0002' });
    await importBackup(dst, file);
    t += 60_000;
    await a.wallets.update(b.cash.id, { name: 'Из копии' });
    const res = await importBackup(dst, clone(await exportBackup(a)));
    expect(res.replaced).toBe(1);
    expect((await dst.db.wallets.get(b.cash.id))?.name).toBe('Из копии');
  });

  it('после импорта подрезанных меток следующая правка этого устройства новее всего импортированного', async () => {
    const src = await fresh();
    const b = await populated(src);
    const file = clone(await exportBackup(src));
    for (const r of allRows(file)) {
      r.createdAt = Y1970;
      r.clientUpdatedAt = Y2200; // подрежется до «сейчас + 5 минут»
    }
    const dst = await fresh();
    await importBackup(dst, file);
    const imported = (await dst.db.wallets.get(b.cash.id))!;
    const edited = await dst.wallets.update(b.cash.id, { name: 'После импорта' });
    expect(edited.clientUpdatedAt > imported.clientUpdatedAt).toBe(true);
    expect(edited.clientUpdatedAt <= MAX_STAMP).toBe(true);
  });

  it('порядок меток внутри файла сохраняется: что было новее, остаётся не старее (для меток в границах)', async () => {
    let t = Date.UTC(2026, 9, 10, 12);
    const src = await fresh({ now: () => t });
    const b = await populated(src);
    t += 60_000;
    await src.wallets.update(b.cash.id, { name: 'второй' });
    const file = clone(await exportBackup(src));
    const first = file.wallets.find((x: Json) => x.id === b.cash.id)!;
    const second = file.wallets.find((x: Json) => x.id === b.usd.id)!;
    second.clientUpdatedAt = Y1970; // самая старая подрежется до границы
    const dst = await fresh();
    await importBackup(dst, file);
    const w1 = (await dst.db.wallets.get(first.id))!;
    const w2 = (await dst.db.wallets.get(second.id))!;
    expect(w2.clientUpdatedAt).toBe(MIN_STAMP);
    expect(w1.clientUpdatedAt > w2.clientUpdatedAt).toBe(true);
  });
});

describe('импорт: метка из будущего подрезается одинаково при каждом импорте', () => {
  afterEach(() => vi.useRealTimers());

  /** Копия, у которой все метки в 2090 году, а время создания копии задаёт тест. */
  async function futureFile(exportedAt: string): Promise<Json> {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    file.exportedAt = exportedAt;
    for (const r of allRows(file)) {
      r.createdAt = '2090-01-01T00:00:00.000Z';
      r.clientUpdatedAt = '2090-01-01T00:00:00.000Z';
      if (r.deletedAt !== null && r.deletedAt !== undefined) r.deletedAt = '2090-01-01T00:00:00.000Z';
    }
    return file;
  }
  const sameStamps = async (store: Store, expected: string) => {
    const stamps = (await storedStamps(store)).filter((s) => s.field !== 'archivedAt');
    expect(stamps.length).toBeGreaterThan(0);
    for (const s of stamps) expect(s.value, `${s.table}.${s.field}`).toBe(expected);
  };

  it('время создания копии в прошлом: метки подрезаются до него', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const dst = await fresh();
    await importBackup(dst, await futureFile('2026-10-01T08:30:00.000Z'));
    await sameStamps(dst, '2026-10-01T08:30:00.000Z');
  });

  it('время создания копии чуть впереди (часы источника спешат): метки подрезаются до «сейчас + 5 минут»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const dst = await fresh();
    await importBackup(dst, await futureFile('2026-10-10T10:12:00.000Z'));
    await sameStamps(dst, '2026-10-10T10:05:00.000Z');
  });

  it('время создания копии дальше 30 минут впереди: времени записей мы не знаем, они получают самую раннюю метку', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const dst = await fresh();
    await importBackup(dst, await futureFile('2090-01-01T00:00:00.000Z'));
    await sameStamps(dst, MIN_STAMP);
  });

  it('копия с неверными часами и впредь не затирает локальное: ни свежую правку, ни повтором через час', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const file = await futureFile('2090-01-01T00:00:00.000Z');
    const dst = await fresh();
    await importBackup(dst, structuredClone(file));
    const wallet = (await dst.db.wallets.toArray()).find((w) => w.name === 'Нал')!;

    vi.setSystemTime(new Date('2026-10-10T11:00:00.000Z'));
    await dst.wallets.update(wallet.id, { name: 'Кошелёк мамы' });
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    const again = await importBackup(dst, structuredClone(file));

    expect(again).toMatchObject({ added: 0, replaced: 0 });
    expect((await dst.db.wallets.get(wallet.id))?.name).toBe('Кошелёк мамы');
  });

  it('копия с неверными часами не заменяет версию, которая уже есть на устройстве, но добавляет недостающее', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const src = await fresh();
    const b = await populated(src);
    const dst = await fresh();
    await importBackup(dst, clone(await exportBackup(src))); // обычная копия: у устройства есть своя версия

    const file = clone(await exportBackup(src));
    file.exportedAt = '2090-01-01T00:00:00.000Z';
    for (const r of allRows(file)) {
      r.clientUpdatedAt = '2090-01-01T00:00:00.000Z';
      r.createdAt = '2090-01-01T00:00:00.000Z';
    }
    file.wallets.find((w: Json) => w.id === b.cash.id)!.name = 'Из будущего';
    const extra = file.wallets.find((w: Json) => w.id === b.usd.id)!;
    await dst.db.wallets.delete(extra.id); // этого кошелька на устройстве нет — копия его вернёт

    const res = await importBackup(dst, file);
    expect(res.added).toBe(1);
    expect(res.replaced).toBe(0);
    expect((await dst.db.wallets.get(b.cash.id))?.name).not.toBe('Из будущего');
    expect(await dst.db.wallets.get(extra.id)).toBeDefined();
  });
});
