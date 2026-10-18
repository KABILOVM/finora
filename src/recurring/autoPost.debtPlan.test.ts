import { describe, expect, it } from 'vitest';
import { uuidV5, type RecurringInput, type Store } from '@/db';
import { computeDebtState } from '@/domain/debts';
import type { IsoDate, LocalRow, RecurringRule, UUID } from '@/domain/types';
import { basics, makeStore } from '../../tests/db/helpers';
import { runAutoPost, type RunAutoPostOptions } from './autoPost';

/**
 * Автопроведение плана «Платить частями» (регулярный платёж вида «возврат долга» с debtId):
 *  - последний платёж записывается на остаток (fitToDebt), после погашения план стоит молча — не участвует и не ошибка;
 *  - закрытый долг — план стоит; «Открыть снова» и пополнение возвращают его, но дни до последней правки долга
 *    (debtPlanFloor: местная дата debt.clientUpdatedAt, не позже сегодня) автоматика не проводит;
 *  - выдача по расписанию на тот же долг (другой вид) не останавливается и границей не режется.
 * Часы хранилища подменены (now): метки правок долга — «в такой-то день, 09:00 UTC», toLocal берёт календарную часть,
 * поэтому результат не зависит от часового пояса машины.
 */

const TODAY = '2026-10-11';
const toLocal = (iso: string) => iso.slice(0, 10);
const LONG_AGO = '2026-01-01T00:00:00.000Z';
const noRates = () => null;
const at = (day: IsoDate) => Date.parse(`${day}T09:00:00.000Z`);

async function setup(day: IsoDate = '2026-10-01') {
  let now = at(day);
  const store = await makeStore({ now: () => now });
  const b = await basics(store);
  /** Перевести часы устройства на этот день: следующие правки (создать, закрыть, открыть снова, пополнить) получат его метку. */
  const setDay = (d: IsoDate) => {
    now = at(d);
  };
  return { store, ...b, setDay };
}

/** Платёж «Проводить само», созданный давно и с тех пор не правленный: историю отсекают только начало расписания и граница долга. */
async function mkRule(store: Store, input: Partial<RecurringInput> & Pick<RecurringInput, 'walletId'>): Promise<LocalRow<RecurringRule>> {
  const rule = await store.recurring.create({
    kind: 'expense',
    amountMinor: 5_000,
    frequency: 'daily',
    startOn: TODAY,
    autoPost: 1,
    ...input,
  });
  await store.db.recurring_rules.update(rule.id, { createdAt: LONG_AGO, clientUpdatedAt: LONG_AGO });
  return (await store.db.recurring_rules.get(rule.id)) as LocalRow<RecurringRule>;
}

const run = (s: Store, today: IsoDate = TODAY, over: Partial<RunAutoPostOptions> = {}) =>
  runAutoPost({ store: s, today, getRate: noRates, toLocal, ...over });

/** «Я должен» банку 12 000 сомони: платёж по долгу — расход. */
const borrowed = (store: Store, principalMinor = 12_000) =>
  store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor, currency: 'TJS', openedOn: '2026-09-01' });

/** Проведённые по правилу даты и суммы, по возрастанию даты. */
async function postedBy(store: Store, ruleId: UUID): Promise<[IsoDate, number][]> {
  const rows = (await store.db.transactions.where('recurringRuleId').equals(ruleId).toArray()).filter((t) => t.deletedAt === null);
  return rows.map((t): [IsoDate, number] => [t.occurredOn, t.amountMinor]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function remainingOf(store: Store, debtId: UUID): Promise<number> {
  const debt = (await store.db.debts.get(debtId))!;
  return computeDebtState(debt, await store.db.transactions.toArray(), await store.db.wallets.toArray()).remainingMinor;
}

const hasRow = async (store: Store, ruleId: UUID, date: IsoDate) => (await store.db.transactions.get(await uuidV5(ruleId, date))) !== undefined;

describe('план по долгу: последний платёж — на остаток, потом план стоит', () => {
  it('план 5 000 в день при остатке 12 000: по дням 5 000, 5 000, затем 2 000 — и дальше ничего, план не участвует', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-09', note: 'Банк: частями' });

    for (const day of ['2026-10-09', '2026-10-10', '2026-10-11']) {
      const r = await run(store, day);
      expect(r.posted).toBe(1);
      expect(r.failures.size).toBe(0);
      expect(r.eligible.has(plan.id)).toBe(true);
    }
    expect(await postedBy(store, plan.id)).toEqual([
      ['2026-10-09', 5_000],
      ['2026-10-10', 5_000],
      ['2026-10-11', 2_000],
    ]);
    const last = await store.db.transactions.get(await uuidV5(plan.id, '2026-10-11'));
    expect(last).toMatchObject({ kind: 'expense', walletId: cash.id, debtId: debt.id, amountMinor: 2_000, baseAmountMinor: 2_000, note: 'Банк: частями' });
    expect(await remainingOf(store, debt.id)).toBe(0);

    for (const day of ['2026-10-12', '2026-10-13']) {
      const r = await run(store, day);
      expect(r.posted).toBe(0);
      expect(r.eligible.has(plan.id)).toBe(false);
      expect(r.examined.has(plan.id)).toBe(false);
      expect(r.failures.has(plan.id)).toBe(false);
    }
    expect(await store.db.transactions.count()).toBe(3);
    expect(await hasRow(store, plan.id, '2026-10-12')).toBe(false);
    // в само правило ничего не пишется: «стоит» — вычисление, не флаг
    expect(await store.db.recurring_rules.get(plan.id)).toMatchObject({ autoPost: 1, archivedAt: null, deletedAt: null, amountMinor: 5_000 });
  });

  it('один проход за три дня: 5 000, 5 000 и 2 000 — остаток пересчитывается перед каждой записью, ошибок нет', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-09' });
    const r = await run(store, TODAY);
    expect(r.posted).toBe(3);
    expect(r.failures.size).toBe(0);
    expect(r.examined.has(plan.id)).toBe(true);
    expect(await postedBy(store, plan.id)).toEqual([
      ['2026-10-09', 5_000],
      ['2026-10-10', 5_000],
      ['2026-10-11', 2_000],
    ]);
    expect(await remainingOf(store, debt.id)).toBe(0);
  });

  it('ручной платёж погасил долг раньше плана: план не участвует, ошибки нет, обычный платёж рядом проводится', async () => {
    const { store, cash, food } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-09' });
    const plain = await mkRule(store, { walletId: cash.id, categoryId: food.id, amountMinor: 700, note: 'Интернет' });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 12_000, occurredOn: '2026-10-05', debtId: debt.id });
    const r = await run(store);
    expect(r.posted).toBe(1);
    expect(r.eligible.has(plan.id)).toBe(false);
    expect(r.eligible.has(plain.id)).toBe(true);
    expect(r.failures.size).toBe(0);
    expect(await postedBy(store, plan.id)).toEqual([]);
    expect(await postedBy(store, plain.id)).toEqual([[TODAY, 700]]);
  });
});

describe('план по долгу: закрыт и открыт снова', () => {
  it('закрытый долг с остатком: план не участвует, ошибки нет, ничего не проведено', async () => {
    const { store, cash, setDay } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-05' });
    setDay('2026-10-03');
    await store.debts.close(debt.id);
    const r = await run(store);
    expect(r.posted).toBe(0);
    expect(r.eligible.has(plan.id)).toBe(false);
    expect(r.failures.has(plan.id)).toBe(false);
    expect(await store.db.transactions.count()).toBe(0);
    expect(await remainingOf(store, debt.id)).toBe(12_000);
  });

  it('открыли снова: план снова участвует; дни, пока долг был закрыт, не проводятся — с дня «Открыть снова» по сегодня', async () => {
    const { store, cash, setDay } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 1_000, startOn: '2026-10-05' });
    expect((await run(store, '2026-10-05')).posted).toBe(1);

    setDay('2026-10-06');
    await store.debts.close(debt.id);
    for (const day of ['2026-10-07', '2026-10-08']) {
      const r = await run(store, day);
      expect(r.posted).toBe(0);
      expect(r.eligible.has(plan.id)).toBe(false);
    }

    setDay('2026-10-09');
    await store.debts.reopen(debt.id);
    const r = await run(store, TODAY);
    expect(r.eligible.has(plan.id)).toBe(true);
    expect(r.failures.size).toBe(0);
    expect(r.posted).toBe(3);
    expect(await postedBy(store, plan.id)).toEqual([
      ['2026-10-05', 1_000],
      ['2026-10-09', 1_000],
      ['2026-10-10', 1_000],
      ['2026-10-11', 1_000],
    ]);
    for (const day of ['2026-10-06', '2026-10-07', '2026-10-08']) expect(await hasRow(store, plan.id, day)).toBe(false);
    expect(await remainingOf(store, debt.id)).toBe(8_000);
    // следующий проход те дни тоже не трогает: они ждут человека в «Просроченных»
    expect((await run(store, TODAY)).posted).toBe(0);
  });

  it('открыли снова сегодня: проводится только сегодняшний платёж, вчерашние даты ждут вручную', async () => {
    const { store, cash, setDay } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 1_000, startOn: '2026-10-01' });
    setDay('2026-10-02');
    await store.debts.close(debt.id);
    setDay(TODAY);
    await store.debts.reopen(debt.id);
    const r = await run(store);
    expect(r.posted).toBe(1);
    expect(await postedBy(store, plan.id)).toEqual([[TODAY, 1_000]]);
    expect(await hasRow(store, plan.id, '2026-10-10')).toBe(false);
  });

  it('пополнение после погашения: план продолжается с дня пополнения, дни между погашением и пополнением не проводятся', async () => {
    const { store, cash, setDay } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-04' });
    expect((await run(store, '2026-10-06')).posted).toBe(3);
    expect(await remainingOf(store, debt.id)).toBe(0);
    for (const day of ['2026-10-07', '2026-10-08']) {
      const r = await run(store, day);
      expect(r.posted).toBe(0);
      expect(r.eligible.has(plan.id)).toBe(false);
    }

    setDay('2026-10-09');
    await store.debts.increase(debt.id, 15_000);
    const r = await run(store, TODAY);
    expect(r.eligible.has(plan.id)).toBe(true);
    expect(r.failures.size).toBe(0);
    expect(r.posted).toBe(3);
    expect(await postedBy(store, plan.id)).toEqual([
      ['2026-10-04', 5_000],
      ['2026-10-05', 5_000],
      ['2026-10-06', 2_000],
      ['2026-10-09', 5_000],
      ['2026-10-10', 5_000],
      ['2026-10-11', 5_000],
    ]);
    expect(await hasRow(store, plan.id, '2026-10-07')).toBe(false);
    expect(await hasRow(store, plan.id, '2026-10-08')).toBe(false);
    expect(await remainingOf(store, debt.id)).toBe(0);
  });

  it('долг удалён на другом устройстве, а правило ещё не в архиве: план стоит молча', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-09' });
    await store.db.debts.update(debt.id, { deletedAt: '2026-10-10T09:00:00.000Z' });
    const r = await run(store);
    expect(r.posted).toBe(0);
    expect(r.eligible.has(plan.id)).toBe(false);
    expect(r.failures.has(plan.id)).toBe(false);
    expect(await store.db.transactions.count()).toBe(0);
  });
});

describe('план по долгу: граница по последней правке долга', () => {
  it('метка правки долга «из будущего» (часы убегали): сегодняшний платёж не откладывается, прошлые даты не проводятся', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 1_000, startOn: '2026-10-09' });
    await store.db.debts.update(debt.id, { clientUpdatedAt: '2026-10-15T09:00:00.000Z' });
    const r = await run(store);
    expect(r.posted).toBe(1);
    expect(await postedBy(store, plan.id)).toEqual([[TODAY, 1_000]]);
  });

  it('метку правки долга не прочитать: проводится только сегодняшний день', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 1_000, startOn: '2026-10-09' });
    await store.db.debts.update(debt.id, { clientUpdatedAt: 'не метка' });
    const strict = (iso: string) => (/^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : null);
    const r = await run(store, TODAY, { toLocal: strict });
    expect(r.posted).toBe(1);
    expect(await postedBy(store, plan.id)).toEqual([[TODAY, 1_000]]);
  });

  it('долг не правили с создания: проводятся все даты плана с начала расписания', async () => {
    const { store, cash } = await setup('2026-10-01');
    const debt = await borrowed(store);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, amountMinor: 1_000, startOn: '2026-10-08' });
    expect((await run(store)).posted).toBe(4);
    expect((await postedBy(store, plan.id)).map(([d]) => d)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });
});

describe('выдача по расписанию на тот же долг: граница и остановка её не касаются', () => {
  it('«мне должны»: план (доход) режется границей и встаёт при закрытии; выдача (расход) проводится вся и полной суммой', async () => {
    const { store, cash, setDay } = await setup();
    const debt = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-09-01' });
    const plan = await mkRule(store, { kind: 'income', walletId: cash.id, debtId: debt.id, amountMinor: 4_000, startOn: '2026-10-08' });
    const issue = await mkRule(store, { kind: 'expense', walletId: cash.id, debtId: debt.id, amountMinor: 3_000, startOn: '2026-10-08' });
    setDay('2026-10-10');
    await store.debts.close(debt.id);
    await store.debts.reopen(debt.id);

    const first = await run(store, TODAY);
    expect(first.failures.size).toBe(0);
    expect(first.posted).toBe(6);
    expect(await postedBy(store, plan.id)).toEqual([
      ['2026-10-10', 4_000],
      ['2026-10-11', 4_000],
    ]);
    expect(await postedBy(store, issue.id)).toEqual([
      ['2026-10-08', 3_000],
      ['2026-10-09', 3_000],
      ['2026-10-10', 3_000],
      ['2026-10-11', 3_000],
    ]);
    // выдачи не уменьшают и не увеличивают остаток: 10 000 − 2 × 4 000
    expect(await remainingOf(store, debt.id)).toBe(2_000);

    setDay('2026-10-12');
    await store.debts.close(debt.id);
    const second = await run(store, '2026-10-12');
    expect(second.eligible.has(plan.id)).toBe(false);
    expect(second.eligible.has(issue.id)).toBe(true);
    expect(second.failures.size).toBe(0);
    expect(second.posted).toBe(1);
    // остаток 2 000, но выдача не ограничивается остатком и закрытым долгом
    expect((await postedBy(store, issue.id)).at(-1)).toEqual(['2026-10-12', 3_000]);
    expect(await hasRow(store, plan.id, '2026-10-12')).toBe(false);
  });

  it('погашенный долг: выдача по расписанию остаётся в проходе и проводится, план — нет', async () => {
    const { store, cash } = await setup();
    const debt = await borrowed(store, 5_000);
    const plan = await mkRule(store, { walletId: cash.id, debtId: debt.id, startOn: '2026-10-09' });
    // «я должен»: выдача — доход (мне дали ещё денег деньгами)
    const issue = await mkRule(store, { kind: 'income', walletId: cash.id, debtId: debt.id, amountMinor: 8_000 });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-05', debtId: debt.id });
    const r = await run(store);
    expect(r.eligible.has(plan.id)).toBe(false);
    expect(r.eligible.has(issue.id)).toBe(true);
    expect(r.failures.size).toBe(0);
    expect(r.posted).toBe(1);
    expect(await postedBy(store, issue.id)).toEqual([[TODAY, 8_000]]);
    expect(await postedBy(store, plan.id)).toEqual([]);
  });
});
