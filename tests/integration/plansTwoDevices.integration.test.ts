// @vitest-environment node
/**
 * Два устройства одного пользователя + сервер в памяти: бюджеты, долги и регулярные платежи (этап 2).
 * Главное: детерминированные id не дают задвоить одно и то же (бюджет на категорию, операция правила за дату),
 * а правки разных групп полей складываются.
 */
import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import { computeBalances } from '@/domain/balances';
import { defaultId, exportBackup, summarizeMonth, uuidV5, type Store } from '@/db';
import { createMemoryServer, type MemoryServer } from '@/sync/memoryServer';
import { USER, openDevice, type Device } from '../sync/engineHarness';

const BASE = Date.UTC(2026, 9, 10, 12, 0, 0);

/** Устройство с управляемыми часами; затравка делается на первом устройстве, второе её получает с сервера. */
async function pair(server: MemoryServer, skewB = 0) {
  const clock = { a: BASE, b: BASE + skewB };
  const a = await openDevice(server, 'dev-a', { seed: true, now: () => clock.a });
  await a.engine.syncNow();
  const b = await openDevice(server, 'dev-b', { seed: true, now: () => clock.b });
  await b.engine.syncNow();
  return { a, b, clock };
}

/** Прогоняет обмен до покоя: каждое устройство отправляет, потом забирает; хватает трёх кругов. */
async function converge(...devices: Device[]) {
  for (let i = 0; i < 4; i++) for (const d of devices) await d.engine.syncNow();
}

const state = async (s: Store) => {
  const f = await exportBackup(s);
  return { ...f, exportedAt: '' };
};
const cash = async (s: Store) => (await s.db.wallets.orderBy('sortOrder').first())!;
const foodId = () => defaultId(USER, 'category:food');
const rowsOn = (server: MemoryServer, table: Parameters<MemoryServer['dump']>[1]) => server.dump(USER, table);

describe('бюджеты: одно устройство — одна строка на категорию', () => {
  it('оба устройства создали лимит на «Еду» офлайн: после обмена на сервере и везде ровно один бюджет; сумма — позднейшая', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const food = await foodId();
    server.setOnline(false);
    clock.a = BASE + 1_000;
    const ba = await a.store.budgets.create({ categoryId: food, amountMinor: 100_000 });
    clock.b = BASE + 2_000;
    const bb = await b.store.budgets.create({ categoryId: food, amountMinor: 250_000 });
    expect(ba.id).toBe(bb.id);
    server.setOnline(true);
    await converge(a, b);
    expect(rowsOn(server, 'budgets')).toHaveLength(1);
    for (const d of [a, b]) {
      const rows = await d.store.db.budgets.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ba.id, amountMinor: 250_000, dirty: 0 });
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('общий лимит тоже один; архивация на одном и новая сумма на другом складываются', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const ta = await a.store.budgets.create({ amountMinor: 900_000 });
    await converge(a, b);
    clock.a = BASE + 1_000;
    await a.store.budgets.archive(ta.id);
    clock.b = BASE + 2_000;
    await b.store.budgets.update(ta.id, { amountMinor: 800_000 });
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.budgets.toArray()).toEqual([expect.objectContaining({ id: ta.id, amountMinor: 800_000, archivedAt: expect.any(String), dirty: 0 })]);
    }
    expect(rowsOn(server, 'budgets')).toHaveLength(1);
  });
});

describe('регулярные платежи: одна операция за дату', () => {
  const rule = (w: string) => ({ kind: 'expense', walletId: w, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-15', note: 'Аренда' }) as const;

  it('правило заведено на A и доехало до B; обе стороны провели платёж за одну дату офлайн — на сервере и везде одна операция', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const r = await a.store.recurring.create(rule((await cash(a.store)).id));
    await converge(a, b);
    expect(await b.store.db.recurring_rules.get(r.id)).toMatchObject({ amountMinor: 30_000, dirty: 0 });

    server.setOnline(false);
    clock.a = BASE + 1_000;
    const ta = await a.store.transactions.createFromRule(r.id, '2026-10-15');
    clock.b = BASE + 2_000;
    const tb = await b.store.transactions.createFromRule(r.id, '2026-10-15');
    expect(ta.id).toBe(tb.id);
    expect(ta.id).toBe(await uuidV5(r.id, '2026-10-15'));
    server.setOnline(true);
    await converge(a, b);
    expect(rowsOn(server, 'transactions')).toHaveLength(1);
    for (const d of [a, b]) expect(await d.store.db.transactions.toArray()).toEqual([expect.objectContaining({ id: ta.id, recurringRuleId: r.id, dirty: 0 })]);
    // деньги списаны один раз
    const balance = computeBalances(await b.store.db.wallets.toArray(), await b.store.db.transactions.toArray()).get((await cash(b.store)).id);
    expect(balance).toBe(-30_000);
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('пока одно устройство офлайн: второе провело, первое потом тоже «провело» — вторая запись не появляется', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const r = await a.store.recurring.create(rule((await cash(a.store)).id));
    await converge(a, b);
    server.setOnline(false);
    await a.store.transactions.createFromRule(r.id, '2026-10-15');
    server.setOnline(true);
    await a.engine.syncNow();
    await b.engine.syncNow(); // B ещё до этого ничего не знал, получил операцию с сервера
    const again = await b.store.transactions.createFromRule(r.id, '2026-10-15');
    expect(again.dirty).toBe(0); // вернулась уже подтверждённая строка, новой записи нет
    await converge(a, b);
    expect(rowsOn(server, 'transactions')).toHaveLength(1);
  });

  it('A пропустила дату, B провела её: оба приходят к одному и тому же состоянию, дубля нет, остаток согласован', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const r = await a.store.recurring.create(rule((await cash(a.store)).id));
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.transactions.skipOccurrence(r.id, '2026-10-15');
    clock.b = BASE + 2_000;
    await b.store.transactions.createFromRule(r.id, '2026-10-15');
    server.setOnline(true);
    await converge(a, b);
    expect(rowsOn(server, 'transactions')).toHaveLength(1);
    const sa = await state(a.store);
    expect(sa).toEqual(await state(b.store));
    expect(sa.transactions).toHaveLength(1);
    const live = sa.transactions.filter((t) => t.deletedAt === null).length;
    const bal = computeBalances(await a.store.db.wallets.toArray(), await a.store.db.transactions.toArray()).get((await cash(a.store)).id);
    expect(bal).toBe(live === 1 ? -30_000 : 0);
  });

  it('пропуск на A доезжает до B: createFromRule на B возвращает «удалённую» строку и ничего не воскрешает', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const r = await a.store.recurring.create(rule((await cash(a.store)).id));
    await a.store.transactions.skipOccurrence(r.id, '2026-10-15');
    await converge(a, b);
    const got = await b.store.transactions.createFromRule(r.id, '2026-10-15');
    expect(got.deletedAt).not.toBeNull();
    await converge(a, b);
    expect((await b.store.db.transactions.toArray()).filter((t) => t.deletedAt === null)).toEqual([]);
    expect(rowsOn(server, 'transactions')).toHaveLength(1);
  });

  it('правки разных частей правила на двух устройствах складываются (расписание на A, автопроведение на B)', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const r = await a.store.recurring.create(rule((await cash(a.store)).id));
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.recurring.update(r.id, { frequency: 'weekly', intervalN: 2 });
    clock.b = BASE + 2_000;
    await b.store.recurring.update(r.id, { autoPost: 1, note: 'Аренда квартиры' });
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.recurring_rules.get(r.id)).toMatchObject({ frequency: 'weekly', intervalN: 2, autoPost: 1, note: 'Аренда квартиры', dirty: 0 });
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('два правила за одну дату — это ДВЕ операции (разные правила = разные платежи); дубль только у одного и того же правила невозможен', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const w = (await cash(a.store)).id;
    const r1 = await a.store.recurring.create(rule(w));
    const r2 = await b.store.recurring.create(rule(w));
    await converge(a, b);
    await a.store.transactions.createFromRule(r1.id, '2026-10-15');
    await b.store.transactions.createFromRule(r2.id, '2026-10-15');
    await converge(a, b);
    expect(rowsOn(server, 'transactions')).toHaveLength(2);
  });
});

describe('долги: платежи с двух устройств', () => {
  it('платежи на A и B складываются; остаток одинаков на обоих и считается из операций', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const w = (await cash(a.store)).id;
    const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' });
    await a.store.transactions.create({ kind: 'expense', walletId: w, amountMinor: 100_000, occurredOn: '2026-10-01', debtId: debt.id });
    await converge(a, b);
    server.setOnline(false);
    await a.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 20_000, occurredOn: '2026-10-05', debtId: debt.id });
    await b.store.transactions.create({ kind: 'income', walletId: w, amountMinor: 30_000, occurredOn: '2026-10-06', debtId: debt.id });
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      const row = (await d.store.db.debts.get(debt.id))!;
      const st = computeDebtState(row, await d.store.db.transactions.toArray(), await d.store.db.wallets.toArray());
      expect(st).toMatchObject({ paidMinor: 50_000, remainingMinor: 50_000, settled: false });
      expect(st.payments).toHaveLength(2);
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });

  it('закрытие долга на A и правка заметки на B складываются; привязка операции к долгу доезжает', async () => {
    const server = createMemoryServer();
    const { a, b, clock } = await pair(server);
    const debt = await a.store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' });
    const t = await a.store.transactions.create({ kind: 'income', walletId: (await cash(a.store)).id, amountMinor: 50_000, occurredOn: '2026-10-01' });
    await converge(a, b);
    server.setOnline(false);
    clock.a = BASE + 1_000;
    await a.store.debts.close(debt.id);
    clock.b = BASE + 2_000;
    await b.store.debts.update(debt.id, { note: 'на машину' });
    await b.store.transactions.update(t.id, { debtId: debt.id });
    server.setOnline(true);
    await converge(a, b);
    for (const d of [a, b]) {
      expect(await d.store.db.debts.get(debt.id)).toMatchObject({ note: 'на машину', closedAt: expect.any(String), dirty: 0 });
      expect(await d.store.db.transactions.get(t.id)).toMatchObject({ debtId: debt.id, dirty: 0 });
    }
    expect(await state(a.store)).toEqual(await state(b.store));
  });
});

describe('комиссия перевода и сводки на двух устройствах', () => {
  it('комиссия доезжает до второго устройства; итоги месяца совпадают, операции по долгу отдельно', async () => {
    const server = createMemoryServer();
    const { a, b } = await pair(server);
    const w1 = await cash(a.store);
    const w2 = await a.store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
    await a.store.transactions.create({ kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: 10_000, toAmountMinor: 9_850, occurredOn: '2026-10-05' });
    const debt = await a.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 1_000, currency: 'TJS', openedOn: '2026-10-01' });
    await a.store.transactions.create({ kind: 'expense', walletId: w1.id, amountMinor: 1_000, occurredOn: '2026-10-06', debtId: debt.id });
    await a.store.transactions.create({ kind: 'expense', walletId: w1.id, amountMinor: 500, occurredOn: '2026-10-07', categoryId: await foodId() });
    await converge(a, b);
    const sums = async (d: Device) => summarizeMonth(await d.store.db.transactions.toArray(), '2026-10', 'TJS');
    const sa = await sums(a);
    expect(sa).toMatchObject({ expenseMinor: 650, feeMinor: 150, debtOutMinor: 1_000, incomeMinor: 0 });
    expect(await sums(b)).toEqual(sa);
    expect(await state(a.store)).toEqual(await state(b.store));
  });
});
