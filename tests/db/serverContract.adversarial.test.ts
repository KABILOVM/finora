import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '@/db';
import { basics, expense, makeStore } from './helpers';

/**
 * Что принимает клиент, но CHECK в supabase/schema.sql потом отвергает навсегда
 * (запись остаётся только на этом устройстве и попадает в карантин). Границы сервера:
 *   transactions.occurred_on между 2000-01-01 и 2100-01-01; суммы и остаток ≤ 1e15; sort_order ±1e15;
 *   текст не может содержать символ NUL (Postgres).
 */
describe('клиент не должен принимать то, что сервер заведомо отвергнет', () => {
  it('дата операции раньше 2000 года (опечатка в годе: 1999, 1925)', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    await expect(expense(s, cash.id, 100, { occurredOn: '1999-12-31' })).rejects.toThrow();
  });

  it('дата операции позже 2100-01-01', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    await expect(expense(s, cash.id, 100, { occurredOn: '2100-06-15' })).rejects.toThrow();
  });

  it('сумма операции больше 1e15 минорных единиц', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    await expect(expense(s, cash.id, 1_000_000_000_000_001)).rejects.toThrow();
  });

  it('начальный остаток кошелька больше 1e15', async () => {
    const s = await makeStore();
    await s.settings.ensure();
    await expect(
      s.wallets.create({ name: 'Много', currency: 'TJS', kind: 'cash', openingBalanceMinor: 2_000_000_000_000_000, color: '#000000', icon: 'x' }),
    ).rejects.toThrow();
  });

  it('текст с символом NUL (Postgres его не хранит) в заметке', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    await expect(expense(s, cash.id, 100, { note: 'до\u0000после' })).rejects.toThrow();
  });

  it('порядок кошелька у границы: после sortOrder = MAX_SAFE_INTEGER новые кошельки создать нельзя совсем', async () => {
    const s = await makeStore();
    const { cash } = await basics(s);
    // update принимает любое безопасное целое (и сервер отвергнет его позже), а после этого блокируется create
    await s.wallets.update(cash.id, { sortOrder: Number.MAX_SAFE_INTEGER }).catch(() => undefined);
    const created = await s.wallets
      .create({ name: 'Новый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' })
      .then(() => true, () => false);
    expect(created, 'после одной «большой» записи кошельки больше не создаются').toBe(true);
  });

  it('импорт: id записи не в виде UUID (на сервере колонка id имеет тип uuid) отвергается', async () => {
    const s = await makeStore();
    await basics(s);
    const file = JSON.parse(JSON.stringify(await exportBackup(s)));
    const stamp = '2026-10-10T12:30:00.000Z';
    file.wallets.push({ ...file.wallets[0], id: 'old-wallet-1', name: 'Из старой программы', createdAt: stamp, clientUpdatedAt: stamp });
    await expect(importBackup(s, file)).rejects.toThrow();
  });

  it('импорт: UUID в верхнем регистре не должен попадать в базу как есть (Postgres вернёт его строчным и появится дубль)', async () => {
    const s = await makeStore();
    await basics(s);
    const file = JSON.parse(JSON.stringify(await exportBackup(s)));
    const stamp = '2026-10-10T12:30:00.000Z';
    file.wallets.push({ ...file.wallets[0], id: 'ABCDEF01-2345-4678-89AB-CDEF01234567', name: 'Верхний регистр', createdAt: stamp, clientUpdatedAt: stamp });
    await importBackup(s, file).catch(() => undefined);
    const ids = (await s.db.wallets.toArray()).map((w) => w.id);
    expect(ids.filter((id) => id !== id.toLowerCase())).toEqual([]);
  });
});
