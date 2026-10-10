import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, importBackup, type BackupFile } from '@/db';
import { basics, expense, makeStore } from './helpers';

/**
 * Атаки на подрезание меток при импорте.
 * Заявлено: «импорт НИКОГДА не затирает более новые локальные данные» и «повторный импорт ничего не плодит».
 * Но метка из будущего подрезается до «СЕЙЧАС + 5 минут» — и «сейчас» у каждого импорта своё.
 */

type Json = Record<string, any>;
const clone = (f: BackupFile): Json => JSON.parse(JSON.stringify(f)) as Json;
const fresh = (opts: Parameters<typeof makeStore>[0] = {}) => makeStore({ factory: new IDBFactory(), ...opts });

afterEach(() => vi.useRealTimers());

/** Копия, снятая на устройстве с убежавшими вперёд часами: у всех строк метка 2090 года (внутри 2000–2100, но в будущем). */
async function skewedBackup(stamp = '2090-01-01T00:00:00.000Z'): Promise<Json> {
  const src = await fresh();
  const b = await basics(src);
  await expense(src, b.cash.id, 1200, { categoryId: b.food.id, note: 'Обед' });
  const file = clone(await exportBackup(src));
  for (const r of [file.settings, ...file.wallets, ...file.categories, ...file.transactions] as Json[]) {
    r.createdAt = stamp;
    r.clientUpdatedAt = stamp;
  }
  return file;
}

describe('импорт копии с метками из будущего', () => {
  it('повторный импорт того же файла ничего не заменяет (идемпотентность)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const file = await skewedBackup();
    const dst = await fresh();

    const first = await importBackup(dst, structuredClone(file));
    expect(first.added).toBeGreaterThan(0);

    vi.setSystemTime(new Date('2026-10-10T11:00:00.000Z')); // через час человек нажал «Восстановить» ещё раз
    const second = await importBackup(dst, structuredClone(file));
    expect(second.replaced, 'второй импорт того же файла заменил строки, которые уже были загружены').toBe(0);
  });

  it.each(['2090-01-01T00:00:00.000Z', '2200-01-01T00:00:00.000Z'])('правка, сделанная после импорта, не пропадает при повторном импорте того же файла (метки %s)', async (stamp) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const file = await skewedBackup(stamp);
    const dst = await fresh();
    await importBackup(dst, structuredClone(file));

    const wallet = (await dst.db.wallets.toArray()).find((w) => w.name === 'Нал');
    expect(wallet).toBeDefined();
    vi.setSystemTime(new Date('2026-10-10T11:00:00.000Z'));
    await dst.wallets.update(wallet!.id, { name: 'Кошелёк мамы' }); // осознанная правка человека

    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    await importBackup(dst, structuredClone(file)); // тот же файл ещё раз

    const after = await dst.db.wallets.get(wallet!.id);
    expect(after?.name, 'импорт затёр более новую локальную правку').toBe('Кошелёк мамы');
  });
});
