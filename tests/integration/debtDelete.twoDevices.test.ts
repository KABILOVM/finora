// @vitest-environment node
/** Удаление долга доезжает до второго устройства (долг, операции, архив регулярного платежа) и отмена тоже. */
import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
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
const cashOf = async (s: Store) => (await s.db.wallets.orderBy('sortOrder').first())!;

async function withDebt() {
  const server = createMemoryServer();
  const { a, b, clock } = await pair(server);
  const w = (await cashOf(a.store)).id;
  const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 40_000, currency: 'TJS', openedOn: '2026-10-01' });
  const issue = await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 40_000, occurredOn: '2026-10-01', debtId: debt.id });
  const pay = await a.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 10_000, occurredOn: '2026-10-05', debtId: debt.id });
  const rule = await a.store.recurring.create({ kind: 'income', walletId: w, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
  await converge(a, b);
  return { server, a, b, clock, w, debt, issue, pay, rule };
}

describe('удаление долга: второе устройство', () => {
  it('только долг: долг скрыт, операции без debtId, правило в архиве, остатки те же; на сервере deleted_at', async () => {
    const { server, a, b, clock, w, debt, issue, pay, rule } = await withDebt();
    const before = computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w);
    clock.a = BASE + 1_000;
    await a.store.debts.softDelete(debt.id, 'keep-operations');
    await converge(a, b);
    expect(server.dump(USER, 'debts').find((r) => r['id'] === debt.id)?.['deleted_at']).toEqual(expect.any(String));
    expect((await b.store.db.debts.get(debt.id))!.deletedAt).not.toBeNull();
    for (const t of [issue, pay]) expect(await b.store.db.transactions.get(t.id)).toMatchObject({ debtId: null, deletedAt: null, dirty: 0 });
    expect((await b.store.db.recurring_rules.get(rule.id))!.archivedAt).not.toBeNull();
    expect(computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w)).toEqual(before);
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('долг и операции: всё удалено на втором устройстве; отмена тоже доезжает', async () => {
    const { a, b, clock, debt, issue, pay } = await withDebt();
    clock.a = BASE + 1_000;
    const res = await a.store.debts.softDelete(debt.id, 'with-operations');
    await converge(a, b);
    expect((await b.store.db.debts.get(debt.id))!.deletedAt).not.toBeNull();
    for (const t of [issue, pay]) expect((await b.store.db.transactions.get(t.id))!.deletedAt).not.toBeNull();
    clock.a = BASE + 2_000;
    await a.store.debts.undoDelete(res);
    await converge(a, b);
    expect((await b.store.db.debts.get(debt.id))!.deletedAt).toBeNull();
    for (const t of [issue, pay]) expect(await b.store.db.transactions.get(t.id)).toMatchObject({ deletedAt: null, debtId: debt.id });
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('второе устройство, бывшее офлайн, получает удаление при следующем обмене', async () => {
    const { server, a, b, clock, debt } = await withDebt();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.softDelete(debt.id, 'keep-operations');
    server.setOnline(true);
    await converge(a, b);
    expect((await b.store.db.debts.get(debt.id))!.deletedAt).not.toBeNull();
  });
});
