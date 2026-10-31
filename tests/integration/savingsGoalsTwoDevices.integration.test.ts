// @vitest-environment node
/**
 * Два устройства одного пользователя + сервер в памяти: цели накопления, «обязательные» категории и категории долгов.
 * Главное: правки разных частей одной записи складываются (название на одном, срок на другом), удаление и архив доезжают,
 * кошелёк цели ссылается на строку, которая уже на сервере, и ничего не уходит в карантин.
 */
import { describe, expect, it } from 'vitest';
import { exportBackup, type Store } from '@/db';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, openDevice, type Device } from '../sync/engineHarness';

const BASE = Date.UTC(2026, 9, 10, 12, 0, 0);

async function pair(server: MemoryServer) {
  const clock = { a: BASE, b: BASE };
  const a = await openDevice(server, 'dev-a', { seed: true, now: () => clock.a });
  await a.engine.syncNow();
  const b = await openDevice(server, 'dev-b', { seed: true, now: () => clock.b });
  await b.engine.syncNow();
  return { a, b, clock };
}
async function converge(...devices: Device[]) {
  for (let i = 0; i < 4; i++) for (const d of devices) await d.engine.syncNow();
}
const state = async (s: Store) => ({ ...(await exportBackup(s)), exportedAt: '' });
const noTrouble = (d: Device) => expect(d.engine.getStatus()).toMatchObject({ pending: 0, quarantined: 0 });
const goal = { name: 'Отпуск', targetMinor: 500_000, dueOn: '2026-12-31' } as const;

async function savingsWallet(s: Store) {
  return s.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'savings', openingBalanceMinor: 0, color: '#16a34a', icon: '🐷' });
}

describe('цели накопления на двух устройствах', () => {
  it('цель с кошельком доезжает до второго устройства; состояние одинаковое', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const w = await savingsWallet(a.store);
    const g = await a.store.savingsGoals.create({ ...goal, walletId: w.id });
    await converge(a, b);
    expect(server.dump(USER, 'savings_goals')).toHaveLength(1);
    expect(await b.store.db.savings_goals.get(g.id)).toMatchObject({ name: 'Отпуск', walletId: w.id, targetMinor: 500_000, dirty: 0 });
    expect(await state(a.store)).toEqual(await state(b.store));
    noTrouble(a);
    noTrouble(b);
  });

  it('офлайн: название меняют на одном, срок на другом — обе правки сохраняются', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const g = await a.store.savingsGoals.create(goal);
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.savingsGoals.update(g.id, { name: 'Отпуск в горах' });
    clock.b = BASE + 2_000;
    await b.store.savingsGoals.update(g.id, { dueOn: '2027-03-01' });
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.savings_goals.get(g.id)).toMatchObject({ name: 'Отпуск в горах', dueOn: '2027-03-01', dirty: 0 });
      noTrouble(d);
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('архив на одном устройстве и удаление на другом доезжают; строка остаётся на сервере', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const g1 = await a.store.savingsGoals.create(goal);
    const g2 = await a.store.savingsGoals.create({ ...goal, name: 'Ноутбук' });
    await converge(a, b);
    clock.a = BASE + 1_000;
    await a.store.savingsGoals.archive(g1.id);
    clock.b = BASE + 2_000;
    await b.store.savingsGoals.remove(g2.id);
    await converge(a, b);
    expect((await b.store.db.savings_goals.get(g1.id))?.archivedAt).not.toBeNull();
    expect((await a.store.db.savings_goals.get(g2.id))?.deletedAt).not.toBeNull();
    expect(server.dump(USER, 'savings_goals')).toHaveLength(2);
    expect(await state(a.store)).toEqual(await state(b.store));
    noTrouble(a);
    noTrouble(b);
  });

  it('кошелёк и цель созданы вместе офлайн: родитель уходит раньше, цель не отвергается', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    server.setOnline(false);
    const w = await savingsWallet(a.store);
    const g = await a.store.savingsGoals.create({ ...goal, walletId: w.id });
    server.setOnline(true);
    await converge(a, b);
    expect(server.dump(USER, 'wallets').map((r) => r['id'])).toContain(w.id);
    expect(await b.store.db.savings_goals.get(g.id)).toMatchObject({ walletId: w.id });
    noTrouble(a);
    noTrouble(b);
  });
});

describe('«обязательные» категории и категории долгов на двух устройствах', () => {
  it('отметка essential и категория долга едут на другое устройство; правки разных групп не затирают друг друга', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const cat = await a.store.categories.create({ name: 'Аренда', kind: 'expense', color: '#a855f7', icon: '🏠' });
    const debt = await a.store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-10-01' });
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.categories.setEssential(cat.id, true);
    await a.store.debts.update(debt.id, { category: 'Кредит' });
    clock.b = BASE + 2_000;
    await b.store.categories.update(cat.id, { name: 'Аренда квартиры' });
    await b.store.debts.update(debt.id, { note: 'до зарплаты' });
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.categories.get(cat.id)).toMatchObject({ name: 'Аренда квартиры', essential: 1, dirty: 0 });
      expect(await d.store.db.debts.get(debt.id)).toMatchObject({ category: 'Кредит', note: 'до зарплаты', dirty: 0 });
      noTrouble(d);
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });
});
