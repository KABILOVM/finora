import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, newId, openStore, summarizeMonth, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { occurrencesBetween } from '@/domain/schedule';
import { saveNetting, savePayInParts, undoNetting, type NettingPlanInput } from './debtActions';
import { payoffPlan } from './payoff';

let store: Store;
let cash: string;
let usd: string;
let lentId: string; // Алишер должен мне 500
let borrowedId: string; // я должен Алишеру 200

beforeEach(async () => {
  store = await openStore('user-netting', { deviceId: 'dev-1', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  usd = (await store.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
  await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
  lentId = (await store.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' })).id;
  borrowedId = (await store.debts.create({ direction: 'borrowed', counterparty: 'Алишер', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-10-02' })).id;
});
afterEach(() => store.close());

const plan = (over: Partial<NettingPlanInput> = {}): NettingPlanInput => ({
  steps: [{ lentDebtId: lentId, borrowedDebtId: borrowedId, amountMinor: 20_000, lentTxId: newId(), borrowedTxId: newId() }],
  walletId: cash,
  occurredOn: '2026-10-10',
  note: 'Взаимозачёт',
  ...over,
});
const balance = async (walletId: string) => {
  const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await store.db.transactions.toArray()).get(walletId);
};
const remaining = async (debtId: string) =>
  computeDebtState((await store.db.debts.get(debtId))!, await store.db.transactions.toArray(), await store.db.wallets.toArray()).remainingMinor;
const live = async () => (await store.db.transactions.toArray()).filter((t) => t.deletedAt === null);
const snapshot = async () => JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray()]);

describe('saveNetting: взаимозачёт одной транзакцией базы', () => {
  it('два платежа на одну сумму: доход по «мне должны» и расход по «я должен»; кошелёк не меняется, оба долга уменьшились', async () => {
    const before = await balance(cash);
    const p = plan();
    await saveNetting(store, p);
    const txs = await live();
    const mine = txs.filter((t) => t.debtId !== null && t.debtId !== undefined);
    expect(mine).toHaveLength(2);
    expect(mine.find((t) => t.debtId === lentId)).toMatchObject({ id: p.steps[0]!.lentTxId, kind: 'income', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-10', note: 'Взаимозачёт', categoryId: null });
    expect(mine.find((t) => t.debtId === borrowedId)).toMatchObject({ id: p.steps[0]!.borrowedTxId, kind: 'expense', walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-10', note: 'Взаимозачёт' });
    expect(await balance(cash)).toBe(before);
    expect(await remaining(lentId)).toBe(30_000);
    expect(await remaining(borrowedId)).toBe(0);
  });

  it('в доходы и расходы месяца не попадает: это платежи по долгам', async () => {
    await saveNetting(store, plan());
    const rows = await store.db.transactions.where('occurredOn').between('2026-10-01', '2026-10-31', true, true).toArray();
    expect(summarizeMonth(rows, '2026-10', 'TJS')).toMatchObject({ incomeMinor: 0, expenseMinor: 0 });
  });

  it('несколько пар — все платежи сразу', async () => {
    const lent2 = (await store.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-03' })).id;
    const p = plan({
      steps: [
        { lentDebtId: lentId, borrowedDebtId: borrowedId, amountMinor: 15_000, lentTxId: newId(), borrowedTxId: newId() },
        { lentDebtId: lent2, borrowedDebtId: borrowedId, amountMinor: 5_000, lentTxId: newId(), borrowedTxId: newId() },
      ],
    });
    await saveNetting(store, p);
    expect(await remaining(borrowedId)).toBe(0);
    expect(await remaining(lentId)).toBe(35_000);
    expect(await remaining(lent2)).toBe(5_000);
  });

  it('повтор с теми же id (двойное нажатие) ничего не добавляет', async () => {
    const p = plan();
    await saveNetting(store, p);
    const once = await snapshot();
    await saveNetting(store, p);
    expect(await snapshot()).toBe(once);
  });

  it('всё или ничего: вторая пара не прошла (кошелёк в другой валюте) — нет и первой', async () => {
    const before = await snapshot();
    const bad = plan({ walletId: usd }); // долги в TJS, кошелёк в USD
    await expect(saveNetting(store, bad)).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshot()).toBe(before);
  });

  it('вторая пара не прошла посреди списка: первая откатывается', async () => {
    const before = await snapshot();
    const p = plan({
      steps: [
        { lentDebtId: lentId, borrowedDebtId: borrowedId, amountMinor: 10_000, lentTxId: newId(), borrowedTxId: newId() },
        { lentDebtId: lentId, borrowedDebtId: 'нет-такого-долга', amountMinor: 5_000, lentTxId: newId(), borrowedTxId: newId() },
      ],
    });
    await expect(saveNetting(store, p)).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  });

  it('кошелёк в архиве — понятная ошибка и ничего не записано', async () => {
    await store.wallets.archive(cash);
    const before = await snapshot();
    await expect(saveNetting(store, plan())).rejects.toBeInstanceOf(ValidationError);
    expect(await snapshot()).toBe(before);
  });

  it('undoNetting: платежи убраны разом, остатки вернулись', async () => {
    const p = plan();
    const ids = await saveNetting(store, p);
    await undoNetting(store, ids);
    expect(await remaining(lentId)).toBe(50_000);
    expect(await remaining(borrowedId)).toBe(20_000);
    expect(await live()).toHaveLength(1); // осталась только начальная сумма на кошельке
  });

  it('снимок курса у обоих платежей один: суммы в основной валюте равны, итог по кошельку нулевой', async () => {
    const usdLent = (await store.debts.create({ direction: 'lent', counterparty: 'Джон', principalMinor: 5_000, currency: 'USD', openedOn: '2026-10-01' })).id;
    const usdBorrowed = (await store.debts.create({ direction: 'borrowed', counterparty: 'Джон', principalMinor: 3_000, currency: 'USD', openedOn: '2026-10-01' })).id;
    await saveNetting(store, {
      steps: [{ lentDebtId: usdLent, borrowedDebtId: usdBorrowed, amountMinor: 3_000, lentTxId: newId(), borrowedTxId: newId() }],
      walletId: usd,
      occurredOn: '2026-10-10',
      note: 'Взаимозачёт',
      fx: { rate: 10.9, source: 'manual' },
    });
    const mine = (await live()).filter((t) => t.debtId === usdLent || t.debtId === usdBorrowed);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.baseAmountMinor).toBe(mine[1]!.baseAmountMinor);
    expect(await balance(usd)).toBe(0);
  });
});

describe('savePayInParts: регулярный платёж по долгу', () => {
  const partsPlan = (over = {}) => ({
    debtId: lentId,
    direction: 'lent' as const,
    counterparty: 'Алишер',
    walletId: cash,
    amountMinor: 20_000,
    startOn: '2026-11-15',
    endOn: '2027-01-15',
    autoPost: false,
    ...over,
  });

  it('для «я должен» — расход, для «мне должны» — доход; раз в месяц, с датой окончания, по долгу', async () => {
    const mine = await savePayInParts(store, partsPlan({ debtId: borrowedId, direction: 'borrowed' }), newId());
    expect(mine).toMatchObject({ kind: 'expense', debtId: borrowedId, walletId: cash, amountMinor: 20_000, frequency: 'monthly', intervalN: 1, startOn: '2026-11-15', endOn: '2027-01-15', autoPost: 0, categoryId: null });
    expect(mine.note).toBe('Долг: Алишер');
    const theirs = await savePayInParts(store, partsPlan(), newId());
    expect(theirs.kind).toBe('income');
  });

  it('правило срабатывает ровно столько раз, сколько насчитал payoffPlan, и последний раз — в дату окончания', async () => {
    const r = payoffPlan(50_000, 20_000, '2026-11-15');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rule = await savePayInParts(store, partsPlan({ endOn: r.payoff.lastOn }), newId());
    const dates = occurrencesBetween(rule, '2026-01-01', '2100-01-01');
    expect(dates).toHaveLength(r.payoff.payments);
    expect(dates.at(-1)).toBe(r.payoff.lastOn);
  });

  it('«Проводить само» включается', async () => {
    expect((await savePayInParts(store, partsPlan({ autoPost: true }), newId())).autoPost).toBe(1);
  });

  it('повтор с тем же id (двойное нажатие) отклоняется и не создаёт второе правило', async () => {
    const id = newId();
    await savePayInParts(store, partsPlan(), id);
    await expect(savePayInParts(store, partsPlan(), id)).rejects.toBeInstanceOf(ValidationError);
    expect((await store.db.recurring_rules.toArray()).filter((r) => r.debtId === lentId)).toHaveLength(1);
  });

  it('кошелёк в чужой валюте — ошибка, правило не создано', async () => {
    await expect(savePayInParts(store, partsPlan({ walletId: usd }), newId())).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.recurring_rules.toArray()).toHaveLength(0);
  });
});
