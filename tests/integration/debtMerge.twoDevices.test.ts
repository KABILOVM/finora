// @vitest-environment node
/**
 * «Добавить ещё в долг» и объединение долгов доезжают до второго устройства (долг, операции, регулярные платежи), отмена тоже.
 * Известные ограничения (см. комментарии у тестов «одновременно») проверены явно: устройства сходятся к одному состоянию и ничего не ломается.
 */
import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
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
const debtState = async (s: Store, id: string) =>
  computeDebtState((await s.db.debts.get(id))!, await s.db.transactions.toArray(), await s.db.wallets.toArray());

/** Два долга Али («мне должны»): 400 с выдачей и платежом 100, и 300 с выдачей и регулярным платежом. Всё уже на обоих устройствах. */
async function withTwoDebts() {
  const server = createMemoryServer();
  const { a, b, clock } = await pair(server);
  const w = (await cashOf(a.store)).id;
  const d1 = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 40_000, currency: 'TJS', openedOn: '2026-10-05', dueOn: '2026-11-20' });
  const d2 = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 30_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-11-10' });
  const issue1 = await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 40_000, occurredOn: '2026-10-05', debtId: d1.id });
  const pay1 = await a.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 10_000, occurredOn: '2026-10-08', debtId: d1.id });
  const issue2 = await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 30_000, occurredOn: '2026-10-01', debtId: d2.id });
  const rule = await a.store.recurring.create({ kind: 'income', walletId: w, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', debtId: d2.id });
  await converge(a, b);
  return { server, a, b, clock, w, d1, d2, issue1, pay1, issue2, rule };
}

describe('объединение долгов: второе устройство', () => {
  it('долг собран, источник удалён, операции и регулярный платёж переехали; на сервере deleted_at; остатки кошелька те же', async () => {
    const { server, a, b, clock, w, d1, d2, issue2, rule } = await withTwoDebts();
    const before = computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    await converge(a, b);
    expect(server.dump(USER, 'debts').find((r) => r['id'] === d2.id)?.['deleted_at']).toEqual(expect.any(String));
    expect(await b.store.db.debts.get(d1.id)).toMatchObject({ principalMinor: 70_000, openedOn: '2026-10-01', dueOn: '2026-11-10', dirty: 0 });
    expect((await b.store.db.debts.get(d2.id))!.deletedAt).not.toBeNull();
    expect(await b.store.db.transactions.get(issue2.id)).toMatchObject({ debtId: d1.id, dirty: 0 });
    expect(await b.store.db.recurring_rules.get(rule.id)).toMatchObject({ debtId: d1.id, dirty: 0 });
    expect(computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w)).toEqual(before);
    expect(await debtState(b.store, d1.id)).toMatchObject({ principalMinor: 70_000, issuedMinor: 70_000, paidMinor: 10_000, remainingMinor: 60_000 });
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('отмена объединения тоже доезжает', async () => {
    const { a, b, clock, d1, d2, issue2, rule } = await withTwoDebts();
    clock.a = BASE + 1_000;
    const res = await a.store.debts.merge(d1.id, [d2.id]);
    await converge(a, b);
    clock.a = BASE + 2_000;
    await a.store.debts.undoMerge(res);
    await converge(a, b);
    expect(await b.store.db.debts.get(d1.id)).toMatchObject({ principalMinor: 40_000, dueOn: '2026-11-20' });
    expect((await b.store.db.debts.get(d2.id))!.deletedAt).toBeNull();
    expect((await b.store.db.transactions.get(issue2.id))!.debtId).toBe(d2.id);
    expect((await b.store.db.recurring_rules.get(rule.id))!.debtId).toBe(d2.id);
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('второе устройство, бывшее офлайн, получает объединение при следующем обмене', async () => {
    const { server, a, b, clock, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    server.setOnline(true);
    await converge(a, b);
    expect((await b.store.db.debts.get(d2.id))!.deletedAt).not.toBeNull();
    expect((await b.store.db.debts.get(d1.id))!.principalMinor).toBe(70_000);
  });

  it('известное ограничение: платёж, добавленный на втором устройстве к источнику, пока первое объединяло, остаётся на удалённом долге — но устройства сходятся', async () => {
    const { server, a, b, clock, w, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    clock.b = BASE + 2_000;
    const late = await b.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 7_000, occurredOn: '2026-10-09', debtId: d2.id });
    server.setOnline(true);
    await converge(a, b);
    expect(await state(a.store)).toEqual(await state(b.store));
    // деньги в кошельке учтены, а у долга-источника (удалён) платёж виден только в операциях
    expect((await a.store.db.transactions.get(late.id))!.debtId).toBe(d2.id);
    expect((await a.store.db.debts.get(d2.id))!.deletedAt).not.toBeNull();
    expect((await debtState(a.store, d1.id)).paidMinor).toBe(10_000);
  });
});

describe('«добавить ещё в долг»: второе устройство', () => {
  it('сумма долга и операция выдачи доезжают, остаток и кошелёк одинаковы', async () => {
    const { a, b, clock, w, d1 } = await withTwoDebts();
    clock.a = BASE + 1_000;
    await a.store.debts.increase(d1.id, 20_000);
    const tx = await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 20_000, occurredOn: '2026-10-12', debtId: d1.id });
    await converge(a, b);
    expect((await b.store.db.debts.get(d1.id))!.principalMinor).toBe(60_000);
    expect(await b.store.db.transactions.get(tx.id)).toMatchObject({ debtId: d1.id, amountMinor: 20_000, dirty: 0 });
    expect(await debtState(b.store, d1.id)).toMatchObject({ principalMinor: 60_000, issuedMinor: 60_000, remainingMinor: 50_000 });
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('известное ограничение: два пополнения одного долга офлайн — обе операции целы, сумма долга берётся от последнего, устройства сходятся', async () => {
    const { server, a, b, clock, w, d1 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.increase(d1.id, 10_000);
    await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 10_000, occurredOn: '2026-10-12', debtId: d1.id });
    clock.b = BASE + 2_000;
    await b.store.debts.increase(d1.id, 20_000);
    await b.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 20_000, occurredOn: '2026-10-13', debtId: d1.id });
    server.setOnline(true);
    await converge(a, b);
    expect(await state(a.store)).toEqual(await state(b.store));
    const st = await debtState(a.store, d1.id);
    expect(st.issuedMinor).toBe(70_000); // 400 + 100 + 200: обе операции на месте
    expect([50_000, 60_000]).toContain(st.principalMinor); // сумма долга — от последней правки, одно из пополнений в ней не учтено
  });
});
