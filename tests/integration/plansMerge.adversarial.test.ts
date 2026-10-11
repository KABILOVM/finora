// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryServer } from '@/sync/memoryServer';
import { openDevice, type Device } from '../sync/engineHarness';

const BASE = Date.UTC(2026, 9, 10, 12, 0, 0);
async function pair(skewB: number) {
  const server = createMemoryServer();
  const clock = { a: BASE, b: BASE + skewB };
  const a = await openDevice(server, 'dev-a', { seed: true, now: () => clock.a });
  await a.engine.syncNow();
  const b = await openDevice(server, 'dev-b', { seed: true, now: () => clock.b });
  await b.engine.syncNow();
  return { server, a, b, clock };
}
const converge = async (...d: Device[]) => {
  for (let i = 0; i < 5; i++) for (const x of d) await x.engine.syncNow();
};

describe('долг: правки разных групп на двух устройствах (часы B отстают на 10 минут)', () => {
  it.each([0, -600_000, 600_000])('сдвиг часов %i мс: заметка, срок, закрытие, сумма — ничего не потеряно', async (skew) => {
    const { server, a, b, clock } = await pair(skew);
    const d = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    await converge(a, b);
    server.setOnline(false);
    clock.a += 10_000; clock.b += 20_000;
    await a.store.debts.update(d.id, { note: 'на ремонт', dueOn: '2026-12-01' });
    await b.store.debts.update(d.id, { principalMinor: 120_000 });
    clock.a += 10_000; clock.b += 10_000;
    await b.store.debts.close(d.id);
    await a.store.debts.update(d.id, { counterparty: 'Али Р.' });
    server.setOnline(true);
    await converge(a, b);
    for (const x of [a, b]) {
      expect(await x.store.db.debts.get(d.id)).toMatchObject({ note: 'на ремонт', dueOn: '2026-12-01', principalMinor: 120_000, counterparty: 'Али Р.', closedAt: expect.any(String), dirty: 0 });
    }
  });

  it('операция: заметка на A, сумма на B, удаление на A — удаление и сумма не теряются; baseAmountMinor согласован с суммой', async () => {
    const { server, a, b, clock } = await pair(0);
    const w = (await a.store.db.wallets.toArray())[0]!;
    const t = await a.store.transactions.create({ kind: 'expense', walletId: w.id, amountMinor: 1000, occurredOn: '2026-10-05' });
    await converge(a, b);
    server.setOnline(false);
    clock.a += 1000; clock.b += 2000;
    await a.store.transactions.update(t.id, { note: 'хлеб' });
    await b.store.transactions.update(t.id, { amountMinor: 2500 });
    server.setOnline(true);
    await converge(a, b);
    for (const x of [a, b]) {
      const row = await x.store.db.transactions.get(t.id);
      expect(row).toMatchObject({ note: 'хлеб', amountMinor: 2500, baseAmountMinor: 2500 });
    }
  });

  it('перевод с комиссией: A меняет сумму зачисления, B — заметку и дату: итог согласован (базовая сумма = комиссия)', async () => {
    const { server, a, b, clock } = await pair(0);
    const w = (await a.store.db.wallets.toArray())[0]!;
    const card = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await a.store.transactions.create({ kind: 'transfer', walletId: w.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    await converge(a, b);
    server.setOnline(false);
    clock.a += 1000; clock.b += 2000;
    await a.store.transactions.update(t.id, { toAmountMinor: 9_500 });
    await b.store.transactions.update(t.id, { note: 'за обслуживание', occurredOn: '2026-10-06' });
    server.setOnline(true);
    await converge(a, b);
    for (const x of [a, b]) {
      const row = (await x.store.db.transactions.get(t.id))!;
      expect(row.baseAmountMinor).toBe(row.amountMinor - (row.toAmountMinor as number));
      expect(row).toMatchObject({ note: 'за обслуживание', occurredOn: '2026-10-06', toAmountMinor: 9_500 });
    }
  });

  it('перевод: A меняет сумму списания (комиссия 0 → пересчёт), B — сумму зачисления: итог не создаёт денег из воздуха', async () => {
    const { server, a, b, clock } = await pair(0);
    const w = (await a.store.db.wallets.toArray())[0]!;
    const card = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    const t = await a.store.transactions.create({ kind: 'transfer', walletId: w.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 10_000, occurredOn: '2026-10-05' });
    await converge(a, b);
    server.setOnline(false);
    clock.a += 1000; clock.b += 2000;
    await a.store.transactions.update(t.id, { amountMinor: 5_000, toAmountMinor: 5_000 });
    await b.store.transactions.update(t.id, { toAmountMinor: 9_000 });
    server.setOnline(true);
    await converge(a, b);
    for (const x of [a, b]) {
      const row = (await x.store.db.transactions.get(t.id))!;
      expect(row.toAmountMinor as number).toBeLessThanOrEqual(row.amountMinor); // зачислено не больше, чем списано
      expect(row.baseAmountMinor).toBe(row.amountMinor - (row.toAmountMinor as number));
    }
  });
});

import { computeDebtState } from '@/domain/debts';

describe('согласованность между таблицами после слияния', () => {
  it('B сменил валюту долга, A внёс платёж в кошельке старой валюты: расхождение видно в issues', async () => {
    const { server, a, b, clock } = await pair(0);
    const w = (await a.store.db.wallets.toArray())[0]!;
    const d = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    await converge(a, b);
    server.setOnline(false);
    clock.a += 1000; clock.b += 2000;
    await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 30_000, occurredOn: '2026-10-05', debtId: d.id });
    await b.store.debts.update(d.id, { currency: 'USD' });
    server.setOnline(true);
    await converge(a, b);
    const debt = (await a.store.db.debts.get(d.id))!;
    const st = computeDebtState(debt, await a.store.db.transactions.toArray(), await a.store.db.wallets.toArray());
    expect(st.paidMinor > 0 || st.issues.length > 0).toBe(true);
  });
});

describe('карантин родителя, который уже есть на сервере', () => {
  it('отвергнутая ПРАВКА уже отправленного долга не должна держать в карантине новый платёж по нему (долг на сервере есть)', async () => {
    const { server, a } = await pair(0);
    const w = (await a.store.db.wallets.toArray())[0]!;
    const d = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    await a.engine.syncNow();
    expect(server.dump('11111111-1111-4111-8111-111111111111', 'debts')).toHaveLength(1);
    await a.store.debts.update(d.id, { note: 'правка' });
    await a.store.transactions.create({ kind: 'income', walletId: w.id, amountMinor: 30_000, occurredOn: '2026-10-05', debtId: d.id, note: 'платёж' });
    server.failNext('rejected', 1); // сбой шлюза на первую отправку (долг)
    await a.engine.syncNow();
    await a.engine.syncNow();
    const rows = server.dump('11111111-1111-4111-8111-111111111111', 'transactions');
    expect(rows.map((r) => r['note'])).toContain('платёж');
  });
});
