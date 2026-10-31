// @vitest-environment node
/**
 * «Добавить ещё в долг» и объединение долгов (связь части с главным долгом) доезжают до второго устройства, отмена и выход тоже.
 * Известные ограничения (см. комментарии у тестов «одновременно») проверены явно: устройства сходятся к одному состоянию и ничего не ломается.
 */
import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { mergeLinks } from '@/domain/debtGroups';
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
  it('часть входит в состав главного долга; у каждой свои сумма, даты и срок, операции и план остаются при ней; на сервере merged_into_id; остатки кошелька те же', async () => {
    const { server, a, b, clock, w, d1, d2, issue2, rule } = await withTwoDebts();
    const before = computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    await converge(a, b);
    expect(server.dump(USER, 'debts').find((r) => r['id'] === d2.id)?.['merged_into_id']).toBe(d1.id);
    expect(server.dump(USER, 'debts').find((r) => r['id'] === d1.id)?.['merged_into_id']).toBeNull();
    expect(await b.store.db.debts.get(d2.id)).toMatchObject({ mergedIntoId: d1.id, principalMinor: 30_000, openedOn: '2026-10-01', dueOn: '2026-11-10', deletedAt: null, dirty: 0 });
    expect(await b.store.db.debts.get(d1.id)).toMatchObject({ mergedIntoId: null, principalMinor: 40_000, openedOn: '2026-10-05', dueOn: '2026-11-20', deletedAt: null });
    // ничего не переехало: операция и план остались у своего долга
    expect(await b.store.db.transactions.get(issue2.id)).toMatchObject({ debtId: d2.id, dirty: 0 });
    expect(await b.store.db.recurring_rules.get(rule.id)).toMatchObject({ debtId: d2.id, dirty: 0 });
    expect(computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get(w)).toEqual(before);
    expect(await debtState(b.store, d1.id)).toMatchObject({ principalMinor: 40_000, issuedMinor: 40_000, paidMinor: 10_000, remainingMinor: 30_000 });
    expect(await debtState(b.store, d2.id)).toMatchObject({ principalMinor: 30_000, issuedMinor: 30_000, paidMinor: 0, remainingMinor: 30_000 });
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('отмена объединения и выход из объединения тоже доезжают', async () => {
    const { a, b, clock, d1, d2, issue2, rule } = await withTwoDebts();
    clock.a = BASE + 1_000;
    const res = await a.store.debts.merge(d1.id, [d2.id]);
    await converge(a, b);
    expect((await b.store.db.debts.get(d2.id))!.mergedIntoId).toBe(d1.id);
    clock.a = BASE + 2_000;
    await a.store.debts.undoMerge(res);
    await converge(a, b);
    expect(await b.store.db.debts.get(d1.id)).toMatchObject({ principalMinor: 40_000, dueOn: '2026-11-20', mergedIntoId: null });
    expect(await b.store.db.debts.get(d2.id)).toMatchObject({ deletedAt: null, mergedIntoId: null });
    expect((await b.store.db.transactions.get(issue2.id))!.debtId).toBe(d2.id);
    expect((await b.store.db.recurring_rules.get(rule.id))!.debtId).toBe(d2.id);
    expect(await state(a.store)).toEqual(await state(b.store));
    // объединили снова и вывели часть на втором устройстве
    clock.a = BASE + 3_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    await converge(a, b);
    clock.b = BASE + 4_000;
    await b.store.debts.unmerge(d2.id);
    await converge(a, b);
    expect((await a.store.db.debts.get(d2.id))!.mergedIntoId).toBeNull();
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('второе устройство, бывшее офлайн, получает объединение при следующем обмене', async () => {
    const { server, a, b, clock, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    server.setOnline(true);
    await converge(a, b);
    expect((await b.store.db.debts.get(d2.id))!.mergedIntoId).toBe(d1.id);
    expect((await b.store.db.debts.get(d1.id))!.principalMinor).toBe(40_000); // главный долг не менялся
  });

  it('платёж, добавленный на втором устройстве к части, пока первое объединяло, остаётся у своей части и входит в итог (прежнего ограничения нет)', async () => {
    const { server, a, b, clock, w, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    clock.b = BASE + 2_000;
    const late = await b.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 7_000, occurredOn: '2026-10-09', debtId: d2.id });
    server.setOnline(true);
    await converge(a, b);
    expect(await state(a.store)).toEqual(await state(b.store));
    expect((await a.store.db.transactions.get(late.id))!.debtId).toBe(d2.id);
    expect((await a.store.db.debts.get(d2.id))).toMatchObject({ deletedAt: null, mergedIntoId: d1.id });
    expect((await debtState(a.store, d2.id)).paidMinor).toBe(7_000); // платёж виден у своей части
    expect((await debtState(a.store, d1.id)).paidMinor).toBe(10_000);
  });

  it('два устройства одновременно объединили долги друг с другом (цикл): устройства сходятся, связь не действует, оба долга остаются видны', async () => {
    const { server, a, b, clock, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]); // d2 в составе d1
    clock.b = BASE + 2_000;
    await b.store.debts.merge(d2.id, [d1.id]); // d1 в составе d2
    server.setOnline(true);
    await converge(a, b);
    expect(await state(a.store)).toEqual(await state(b.store));
    const debts = (await a.store.db.debts.toArray()).filter((d) => d.deletedAt === null);
    expect(debts.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
    expect(mergeLinks(debts).rootOf.size).toBe(0); // ни одна из двух связей не действует: оба долга сами по себе
  });

  it('главный долг удалён на втором устройстве, пока первое присоединяло к нему часть: часть остаётся живым долгом, связь не действует', async () => {
    const { server, a, b, clock, d1, d2 } = await withTwoDebts();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.merge(d1.id, [d2.id]);
    clock.b = BASE + 2_000;
    await b.store.debts.softDelete(d1.id, 'keep-operations');
    server.setOnline(true);
    await converge(a, b);
    expect(await state(a.store)).toEqual(await state(b.store));
    const all = await a.store.db.debts.toArray();
    expect(all.find((d) => d.id === d1.id)!.deletedAt).not.toBeNull();
    expect(all.find((d) => d.id === d2.id)!.deletedAt).toBeNull();
    expect(mergeLinks(all).rootOf.size).toBe(0);
    expect((await debtState(a.store, d2.id)).remainingMinor).toBe(30_000); // долг цел со своими операциями
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
