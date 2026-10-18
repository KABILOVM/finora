import { describe, expect, it } from 'vitest';
import { computeDebtState } from '@/domain/debts';
import type { Debt, LocalRow } from '@/domain/types';
import { stoppedDebtPlans, uuidV5, ValidationError, type Store } from '@/db';
import { basics, makeStore } from './helpers';

/**
 * План «Платить частями» на уровне хранилища:
 *  - createFromRule(…, { fitToDebt: true }) — платёж по плану не больше остатка долга; закрытый или погашенный долг — ошибка без записи;
 *  - stoppedDebtPlans — какие планы стоят и почему (удалён / в архиве / закрыт / погашен), в правило при этом ничего не пишется.
 */

const lent = { direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' } as const;
const NOT_FOUND_DEBT = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

/** «Мне должны» 100 000 (Али); план — доход 30 000 ежемесячно с 1 ноября; выдача по расписанию — расход 30 000; правило без долга. */
async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  const debt = await store.debts.create(lent);
  const plan = await store.recurring.create({
    kind: 'income', walletId: b.cash.id, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id, note: 'Али: частями',
  });
  const issue = await store.recurring.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
  const plain = await store.recurring.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', categoryId: b.food.id });
  return { store, ...b, debt, plan, issue, plain };
}

/** Платёж мне по долгу «мне должны» (доход с debtId). */
const pay = (store: Store, walletId: string, debtId: string, amountMinor: number, occurredOn = '2026-10-10') =>
  store.transactions.create({ kind: 'income', walletId, amountMinor, occurredOn, debtId });

async function stateOf(store: Store, debt: LocalRow<Debt>) {
  const fresh = (await store.db.debts.get(debt.id))!;
  return computeDebtState(fresh, await store.db.transactions.toArray(), await store.db.wallets.toArray());
}

/**
 * Операция в долларах, привязанная к долгу в сомони: обычным путём её не создать (валюта кошелька ≠ валюте долга),
 * поэтому пишем строку прямо в базу — как если бы она пришла с другого устройства до правки валют.
 */
async function foreignPayment(store: Store, usdId: string, debtId: string, amountMinor: number) {
  const t = await store.transactions.create({ kind: 'income', walletId: usdId, amountMinor, occurredOn: '2026-10-12', fx: { rate: 10, source: 'manual' } });
  await store.db.transactions.put({ ...t, debtId });
  return t;
}

describe('createFromRule с fitToDebt: платёж по плану не больше остатка', () => {
  it('остаток 20 000 меньше плана 30 000 — записывается 20 000; остальное из правила, долг погашен ровно', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 80_000);
    const t = await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true });
    expect(t).toMatchObject({
      id: await uuidV5(plan.id, '2026-11-01'),
      kind: 'income',
      walletId: cash.id,
      amountMinor: 20_000,
      baseAmountMinor: 20_000,
      debtId: debt.id,
      recurringRuleId: plan.id,
      note: 'Али: частями',
      occurredOn: '2026-11-01',
      deletedAt: null,
    });
    expect((await store.db.transactions.get(t.id))!.amountMinor).toBe(20_000);
    const s = await stateOf(store, debt);
    expect(s).toMatchObject({ remainingMinor: 0, overpaidMinor: 0, paidMinor: 100_000, settled: true });
  });

  it('остаток больше плана или равен ему — полная сумма плана', async () => {
    const { store, cash, debt, plan } = await setup();
    // остаток 100 000 > 30 000
    expect((await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).amountMinor).toBe(30_000);
    // остаток ровно 30 000 = плану
    await pay(store, cash.id, debt.id, 40_000);
    expect((await stateOf(store, debt)).remainingMinor).toBe(30_000);
    expect((await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: true })).amountMinor).toBe(30_000);
    expect((await stateOf(store, debt)).remainingMinor).toBe(0);
  });

  it('весь план по месяцам: 30 000 ×3, последний — 10 000, дальше «уже погашен» и ничего не пишется', async () => {
    const { store, debt, plan } = await setup();
    const dates = ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'];
    const amounts: number[] = [];
    for (const d of dates) amounts.push((await store.transactions.createFromRule(plan, d, { fitToDebt: true })).amountMinor);
    expect(amounts).toEqual([30_000, 30_000, 30_000, 10_000]);
    await expect(store.transactions.createFromRule(plan, '2027-03-01', { fitToDebt: true })).rejects.toThrow(
      'Долг «Али» уже погашен: платёж не проведён',
    );
    expect(await store.db.transactions.count()).toBe(4);
    expect(await store.db.transactions.get(await uuidV5(plan.id, '2027-03-01'))).toBeUndefined();
    expect((await stateOf(store, debt)).overpaidMinor).toBe(0);
  });

  it('долг закрыт — ValidationError «Долг «Али» закрыт: платёж не проведён», операция не записана', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 10_000);
    await store.debts.close(debt.id);
    const call = store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true });
    await expect(call).rejects.toBeInstanceOf(ValidationError);
    await expect(call).rejects.toThrow('Долг «Али» закрыт: платёж не проведён');
    expect(await store.db.transactions.count()).toBe(1); // только ручной платёж
    expect(await store.db.transactions.get(await uuidV5(plan.id, '2026-11-01'))).toBeUndefined();
    // после «Открыть снова» план проводится как обычно
    await store.debts.reopen(debt.id);
    expect((await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).amountMinor).toBe(30_000);
  });

  it('долг погашен (ровно и с переплатой) — «уже погашен», операция не записана', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 100_000);
    const call = store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true });
    await expect(call).rejects.toBeInstanceOf(ValidationError);
    await expect(call).rejects.toThrow('Долг «Али» уже погашен: платёж не проведён');
    await pay(store, cash.id, debt.id, 5_000, '2026-10-11'); // переплата 5 000
    await expect(store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).rejects.toThrow(
      'Долг «Али» уже погашен: платёж не проведён',
    );
    expect(await store.db.transactions.count()).toBe(2);
    expect(await store.db.transactions.get(await uuidV5(plan.id, '2026-11-01'))).toBeUndefined();
  });

  it('долг «я должен»: платёж — расход, тоже записывается на остаток (10 000 вместо 25 000)', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const debt = await store.debts.create({ ...lent, direction: 'borrowed', counterparty: 'Банк' });
    const plan = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 25_000, frequency: 'monthly', startOn: '2026-11-05', debtId: debt.id });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 90_000, occurredOn: '2026-10-20', debtId: debt.id });
    const t = await store.transactions.createFromRule(plan, '2026-11-05', { fitToDebt: true });
    expect(t).toMatchObject({ kind: 'expense', amountMinor: 10_000, baseAmountMinor: 10_000, debtId: debt.id });
    await expect(store.transactions.createFromRule(plan, '2026-12-05', { fitToDebt: true })).rejects.toThrow(
      'Долг «Банк» уже погашен: платёж не проведён',
    );
  });

  it('выдача по расписанию (вид «выдачи») остатком не ограничивается: и при погашенном, и при закрытом долге — полная сумма', async () => {
    const { store, cash, debt, issue } = await setup();
    await pay(store, cash.id, debt.id, 90_000);
    // остаток 10 000, а выдача — 30 000 целиком
    expect((await store.transactions.createFromRule(issue, '2026-11-01', { fitToDebt: true })).amountMinor).toBe(30_000);
    await pay(store, cash.id, debt.id, 10_000, '2026-11-02'); // погашен
    expect((await store.transactions.createFromRule(issue, '2026-12-01', { fitToDebt: true })).amountMinor).toBe(30_000);
    await store.debts.close(debt.id);
    expect((await store.transactions.createFromRule(issue, '2027-01-01', { fitToDebt: true })).amountMinor).toBe(30_000);
    expect(await store.db.transactions.count()).toBe(5);
  });

  it('своя сумма проходит как есть: переплата 50 000 при остатке 20 000; закрытие долга её тоже не останавливает', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 80_000);
    const t = await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true, amountMinor: 50_000 });
    expect(t).toMatchObject({ amountMinor: 50_000, baseAmountMinor: 50_000 });
    expect(await stateOf(store, debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 30_000 });
    // долг уже погашен, но сумма задана явно — проверка остатка не делается
    expect((await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: true, amountMinor: 1_500 })).amountMinor).toBe(1_500);
    await store.debts.close(debt.id);
    expect((await store.transactions.createFromRule(plan, '2027-01-01', { fitToDebt: true, amountMinor: 700 })).amountMinor).toBe(700);
  });

  it('без флага — прежнее поведение: полная сумма плана сверх остатка, погашенный и закрытый долг не мешают', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 80_000);
    expect((await store.transactions.createFromRule(plan, '2026-11-01')).amountMinor).toBe(30_000);
    expect(await stateOf(store, debt)).toMatchObject({ remainingMinor: 0, overpaidMinor: 10_000 });
    expect((await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: false })).amountMinor).toBe(30_000);
    await store.debts.close(debt.id);
    expect((await store.transactions.createFromRule(plan, '2027-01-01')).amountMinor).toBe(30_000);
    expect(await stateOf(store, debt)).toMatchObject({ paidMinor: 170_000, overpaidMinor: 70_000 });
  });

  it('операция за эту дату уже есть — возвращается как есть, без проверки долга (и пропущенная тоже)', async () => {
    const { store, cash, debt, plan } = await setup();
    const first = await store.transactions.createFromRule(plan, '2026-11-01');
    await store.transactions.skipOccurrence(plan, '2026-12-01');
    await pay(store, cash.id, debt.id, 70_000); // 30 000 + 70 000 — погашен
    const again = await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true });
    expect(again).toEqual(first);
    await store.debts.close(debt.id);
    expect(await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).toEqual(first);
    const skipped = await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: true });
    expect(skipped.deletedAt).not.toBeNull();
    expect(skipped.amountMinor).toBe(30_000);
    expect(await store.db.transactions.count()).toBe(3);
  });

  it('платёж в чужой валюте не уменьшает остаток для расчёта: записывается 40 000, а не 10 000', async () => {
    const { store, cash, usd, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 60_000);
    const foreign = await foreignPayment(store, usd.id, debt.id, 30_000);
    const before = await stateOf(store, debt);
    expect(before.remainingMinor).toBe(40_000);
    expect(before.issues).toEqual([expect.objectContaining({ txId: foreign.id, reason: 'foreign-currency' })]);
    const t = await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true });
    expect(t.amountMinor).toBe(30_000);
    expect((await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: true })).amountMinor).toBe(10_000);
  });

  it('чужая валюта на остатке ровно 40 000: план 50 000 пишется на 40 000 (доллары не засчитаны)', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const debt = await store.debts.create(lent);
    const plan = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 50_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
    await pay(store, cash.id, debt.id, 60_000);
    await foreignPayment(store, usd.id, debt.id, 30_000);
    expect((await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).amountMinor).toBe(40_000);
  });

  it('пропущенная дата плана не считается платежом: остаток 20 000 после ручного 80 000', async () => {
    const { store, cash, debt, plan } = await setup();
    await store.transactions.skipOccurrence(plan, '2026-11-01'); // удалённая строка на 30 000 с debtId
    await pay(store, cash.id, debt.id, 80_000);
    expect((await store.transactions.createFromRule(plan, '2026-12-01', { fitToDebt: true })).amountMinor).toBe(20_000);
  });

  it('долг в валюте кошелька не базовой: сумма на остаток, курс пересчитывает уже урезанную сумму', async () => {
    const store = await makeStore();
    const { usd } = await basics(store);
    const debt = await store.debts.create({ ...lent, currency: 'USD', principalMinor: 10_000, counterparty: 'Джон' });
    const plan = await store.recurring.create({ kind: 'income', walletId: usd.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
    await store.transactions.create({ kind: 'income', walletId: usd.id, amountMinor: 7_000, occurredOn: '2026-10-10', debtId: debt.id, fx: { rate: 10, source: 'manual' } });
    const t = await store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true, fx: { rate: 10, source: 'manual' } });
    expect(t).toMatchObject({ amountMinor: 3_000, baseAmountMinor: 30_000, fxRate: 10, fxSource: 'manual', baseCurrency: 'TJS' });
  });

  it('долг в архиве — ошибка связи с долгом, операция не записана', async () => {
    const { store, debt, plan } = await setup();
    await store.debts.archive(debt.id);
    await expect(store.transactions.createFromRule(plan, '2026-11-01', { fitToDebt: true })).rejects.toThrow(/Долг «Али» в архиве/);
    expect(await store.db.transactions.count()).toBe(0);
  });
});

describe('stoppedDebtPlans: какие планы по долгам стоят', () => {
  it('живой долг с остатком — ничего не стоит; правило без долга и пустой список не учитываются', async () => {
    const { store, cash, debt, plan, issue, plain } = await setup();
    await pay(store, cash.id, debt.id, 99_999);
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(new Map());
    expect(await stoppedDebtPlans(store.db, [plain])).toEqual(new Map());
    expect(await stoppedDebtPlans(store.db, [])).toEqual(new Map());
  });

  it('погашен → settled (выдача по расписанию не стоит); пополнение долга снова запускает план без правки правила', async () => {
    const { store, cash, debt, plan, issue, plain } = await setup();
    await pay(store, cash.id, debt.id, 100_000);
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(new Map([[plan.id, 'settled']]));
    await store.debts.increase(debt.id, 10_000);
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(new Map());
    expect(await store.db.recurring_rules.get(plan.id)).toEqual(plan); // в правило ничего не записано
  });

  it('переплата — тоже settled', async () => {
    const { store, cash, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 120_000);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map([[plan.id, 'settled']]));
  });

  it('закрыт → closed; «Открыть снова» — план снова идёт', async () => {
    const { store, debt, plan, issue, plain } = await setup();
    await store.debts.close(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(new Map([[plan.id, 'closed']]));
    await store.debts.reopen(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(new Map());
    expect(await store.db.recurring_rules.get(plan.id)).toEqual(plan);
  });

  it('в архиве → archived даже при закрытом и погашенном; из архива — снова closed, после открытия — settled', async () => {
    const { store, cash, debt, plan, issue } = await setup();
    await pay(store, cash.id, debt.id, 100_000);
    await store.debts.close(debt.id);
    await store.debts.archive(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan, issue])).toEqual(new Map([[plan.id, 'archived']]));
    await store.debts.restore(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan, issue])).toEqual(new Map([[plan.id, 'closed']]));
    await store.debts.reopen(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan, issue])).toEqual(new Map([[plan.id, 'settled']]));
  });

  it('в архиве с остатком → archived', async () => {
    const { store, debt, plan } = await setup();
    await store.debts.archive(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map([[plan.id, 'archived']]));
  });

  it('выдача по расписанию не останавливается ни погашением, ни закрытием, ни архивом', async () => {
    const { store, cash, debt, issue } = await setup();
    await pay(store, cash.id, debt.id, 100_000);
    expect(await stoppedDebtPlans(store.db, [issue])).toEqual(new Map());
    await store.debts.close(debt.id);
    expect(await stoppedDebtPlans(store.db, [issue])).toEqual(new Map());
    await store.debts.archive(debt.id);
    expect(await stoppedDebtPlans(store.db, [issue])).toEqual(new Map());
  });

  it('удалён → deleted (удалённый долг останавливает любое правило с ним, в том числе выдачу)', async () => {
    const { store, debt, plan, issue, plain } = await setup();
    await store.debts.softDelete(debt.id, 'keep-operations');
    expect(await stoppedDebtPlans(store.db, [plan, issue, plain])).toEqual(
      new Map([
        [plan.id, 'deleted'],
        [issue.id, 'deleted'],
      ]),
    );
  });

  it('долга на устройстве нет → deleted', async () => {
    const { store, debt, plan, plain } = await setup();
    const orphan = { id: 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', kind: 'income', debtId: NOT_FOUND_DEBT } as const;
    expect(await stoppedDebtPlans(store.db, [orphan, plain])).toEqual(new Map([[orphan.id, 'deleted']]));
    await store.db.debts.delete(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map([[plan.id, 'deleted']]));
  });

  it('платёж в чужой валюте не гасит долг: план не стоит при 60 000 сомони + 40 000 «долларов»', async () => {
    const { store, cash, usd, debt, plan } = await setup();
    await pay(store, cash.id, debt.id, 60_000);
    await foreignPayment(store, usd.id, debt.id, 40_000);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map());
    await pay(store, cash.id, debt.id, 40_000, '2026-10-13');
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map([[plan.id, 'settled']]));
  });

  it('несколько долгов: у каждого плана своя причина, два плана одного долга — оба', async () => {
    const { store, cash, debt, plan } = await setup();
    const second = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000, frequency: 'weekly', startOn: '2026-11-02', debtId: debt.id });
    const bank = await store.debts.create({ ...lent, direction: 'borrowed', counterparty: 'Банк' });
    const bankPlan = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 10_000, frequency: 'monthly', startOn: '2026-11-05', debtId: bank.id });
    const live = await store.debts.create({ ...lent, counterparty: 'Вали' });
    const livePlan = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 10_000, frequency: 'monthly', startOn: '2026-11-05', debtId: live.id });
    await pay(store, cash.id, debt.id, 100_000);
    await store.debts.close(bank.id);
    expect(await stoppedDebtPlans(store.db, [plan, second, bankPlan, livePlan])).toEqual(
      new Map([
        [plan.id, 'settled'],
        [second.id, 'settled'],
        [bankPlan.id, 'closed'],
      ]),
    );
  });

  it('суммы платежей не помещаются в расчёт (RangeError) — по остатку план не останавливается, закрытие по-прежнему видно', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const debt = await store.debts.create({ ...lent, principalMinor: 1_000_000_000_000_000 });
    const plan = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-11-01', debtId: debt.id });
    for (let i = 0; i < 10; i++) await pay(store, cash.id, debt.id, 1_000_000_000_000_000);
    await expect(stateOf(store, debt)).rejects.toBeInstanceOf(RangeError);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map());
    await store.debts.close(debt.id);
    expect(await stoppedDebtPlans(store.db, [plan])).toEqual(new Map([[plan.id, 'closed']]));
  });
});
