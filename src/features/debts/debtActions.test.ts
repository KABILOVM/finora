import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, FxRequiredError, newId, openStore, summarizeMonth, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { freshPlanIds, savePayment, saveNewDebt, type NewDebtPlan } from './debtActions';

let store: Store;
let cash: string;
let usd: string;
let cat: string;

beforeEach(async () => {
  store = await openStore('user-debts', { deviceId: 'dev-1', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  const wallets = await store.db.wallets.toArray();
  cash = wallets.find((w) => w.name === 'Наличные')!.id;
  usd = (await store.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
  cat = (await store.db.categories.toArray()).find((c) => c.kind === 'expense' && c.name === 'Еда')!.id;
  await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-10-01' });
});
afterEach(() => store.close());

const plan = (over: Partial<NewDebtPlan> = {}, debt: Partial<NewDebtPlan['debt']> = {}): NewDebtPlan => ({
  ...freshPlanIds(),
  debt: { direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-10', dueOn: null, note: '', ...debt },
  movement: null,
  ...over,
});
const withMove = (walletId: string, over: Partial<NewDebtPlan> = {}, debt: Partial<NewDebtPlan['debt']> = {}): NewDebtPlan => {
  const ids = freshPlanIds();
  return plan({ debtId: ids.debtId, movement: { walletId, txId: ids.txId }, ...over }, debt);
};

const counts = async () => ({ debts: await store.db.debts.count(), txs: await store.db.transactions.count() });
const balance = async (walletId: string) => {
  const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await store.db.transactions.toArray()).get(walletId);
};

describe('saveNewDebt: долг и исходная операция одной транзакцией', () => {
  it('«Я дал»: долг + РАСХОД с debtId, дата долга, без категории; остаток кошелька уменьшился', async () => {
    const p = withMove(cash);
    const r = await saveNewDebt(store, p);
    expect(r.debt.id).toBe(p.debtId);
    expect(r.tx).toMatchObject({ id: p.movement!.txId, kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-10', categoryId: null, debtId: p.debtId });
    expect(await balance(cash)).toBe(50_000); // 100 000 − 50 000
  });

  it('«Я взял»: ДОХОД на кошелёк', async () => {
    const r = await saveNewDebt(store, withMove(cash, {}, { direction: 'borrowed', counterparty: 'Банк' }));
    expect(r.tx?.kind).toBe('income');
    expect(await balance(cash)).toBe(150_000);
  });

  it('«на бумаге»: операции нет, остатки не меняются', async () => {
    const r = await saveNewDebt(store, plan());
    expect(r.tx).toBeNull();
    expect(await counts()).toEqual({ debts: 1, txs: 1 });
    expect(await balance(cash)).toBe(100_000);
  });

  it('выдача долга не входит в доходы и расходы месяца', async () => {
    await store.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 1_000, categoryId: cat, occurredOn: '2026-10-05' });
    await saveNewDebt(store, withMove(cash));
    const rows = await store.db.transactions.where('occurredOn').between('2026-10-01', '2026-10-31', true, true).toArray();
    const s = summarizeMonth(rows, '2026-10', 'TJS');
    expect(s.expenseMinor).toBe(1_000);
    expect(s.incomeMinor).toBe(100_000);
    expect(s.debtOutMinor).toBe(50_000);
  });

  it('кошелёк другой валюты: понятная ошибка, и долг НЕ остаётся «наполовину»', async () => {
    const p = withMove(usd);
    await expect(saveNewDebt(store, p)).rejects.toThrow(ValidationError);
    await expect(saveNewDebt(store, p)).rejects.toThrow(/не совпадает с валютой долга/);
    expect(await counts()).toEqual({ debts: 0, txs: 1 });
  });

  it('кошелёк в архиве: ошибка и ничего не сохранено', async () => {
    const w = await store.wallets.create({ name: 'Старый', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: '🗄️' });
    await store.wallets.archive(w.id);
    await expect(saveNewDebt(store, withMove(w.id))).rejects.toThrow(/в архиве/);
    expect(await counts()).toEqual({ debts: 0, txs: 1 });
  });

  it('несуществующий кошелёк: ошибка и ничего не сохранено', async () => {
    await expect(saveNewDebt(store, withMove(newId()))).rejects.toThrow(ValidationError);
    expect(await counts()).toEqual({ debts: 0, txs: 1 });
  });

  it('кошелёк в небазовой валюте без курса: FxRequiredError, ничего не сохранено', async () => {
    const p = withMove(usd, {}, { currency: 'USD' });
    await expect(saveNewDebt(store, p)).rejects.toBeInstanceOf(FxRequiredError);
    expect(await counts()).toEqual({ debts: 0, txs: 1 });
  });

  it('с курсом: снимок курса сохраняется в операции', async () => {
    const p = withMove(usd, { }, { currency: 'USD', principalMinor: 10_000 });
    p.movement = { ...p.movement!, fx: { rate: 10.9, source: 'manual' } };
    const r = await saveNewDebt(store, p);
    expect(r.tx).toMatchObject({ baseCurrency: 'TJS', baseAmountMinor: 109_000, fxRate: 10.9, fxSource: 'manual' });
  });

  it('повтор с теми же id (двойное нажатие) не создаёт дубль', async () => {
    const p = withMove(cash);
    await saveNewDebt(store, p);
    await saveNewDebt(store, p);
    expect(await counts()).toEqual({ debts: 1, txs: 2 });
    expect(await balance(cash)).toBe(50_000);
  });

  it('после ошибки тот же замысел с исправленным кошельком проходит: долг один', async () => {
    const p = withMove(usd);
    await expect(saveNewDebt(store, p)).rejects.toThrow();
    p.movement = { ...p.movement!, walletId: cash };
    await saveNewDebt(store, p);
    expect(await counts()).toEqual({ debts: 1, txs: 2 });
  });

  it('ошибка в самом долге (срок раньше даты) — тоже ничего не сохранено', async () => {
    await expect(saveNewDebt(store, withMove(cash, {}, { dueOn: '2026-10-01' }))).rejects.toThrow(/раньше/);
    expect(await counts()).toEqual({ debts: 0, txs: 1 });
  });
});

describe('savePayment: платёж по долгу', () => {
  const debtOf = async (direction: 'lent' | 'borrowed') => {
    const p = withMove(cash, {}, { direction });
    const r = await saveNewDebt(store, p);
    return r.debt;
  };
  const stateOf = async (id: string) => {
    const debt = (await store.db.debts.get(id))!;
    const wallets = await store.db.wallets.toArray();
    return computeDebtState(debt, await store.db.transactions.where('debtId').equals(id).toArray(), new Map(wallets.map((w) => [w.id, w])));
  };

  it('«мне должны»: платёж — доход; остаток долга и кошелька верны', async () => {
    const d = await debtOf('lent');
    const tx = await savePayment(store, { debtId: d.id, direction: 'lent', txId: newId(), walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-12', note: ' частично ' });
    expect(tx).toMatchObject({ kind: 'income', debtId: d.id, categoryId: null, note: 'частично' });
    const st = await stateOf(d.id);
    expect(st.remainingMinor).toBe(30_000);
    expect(st.paidMinor).toBe(20_000);
    expect(st.issuedMinor).toBe(50_000);
    expect(await balance(cash)).toBe(70_000); // 100 000 − 50 000 + 20 000
  });

  it('«я должен»: платёж — расход', async () => {
    const d = await debtOf('borrowed');
    const tx = await savePayment(store, { debtId: d.id, direction: 'borrowed', txId: newId(), walletId: cash, amountMinor: 10_000, occurredOn: '2026-10-12', note: '' });
    expect(tx.kind).toBe('expense');
    expect((await stateOf(d.id)).remainingMinor).toBe(40_000);
  });

  it('платёж не входит в расходы/доходы месяца', async () => {
    const d = await debtOf('lent');
    await savePayment(store, { debtId: d.id, direction: 'lent', txId: newId(), walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-12', note: '' });
    const rows = await store.db.transactions.toArray();
    const s = summarizeMonth(rows, '2026-10', 'TJS');
    expect(s.incomeMinor).toBe(100_000); // только зарплата
    expect(s.expenseMinor).toBe(0);
    expect(s.debtInMinor).toBe(20_000);
  });

  it('двойное нажатие (тот же id) — один платёж', async () => {
    const d = await debtOf('lent');
    const input = { debtId: d.id, direction: 'lent' as const, txId: newId(), walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-12', note: '' };
    await savePayment(store, input);
    await savePayment(store, input);
    expect((await stateOf(d.id)).payments).toHaveLength(1);
  });

  it('кошелёк другой валюты: ошибка репозитория, платежа нет', async () => {
    const d = await debtOf('lent');
    await expect(
      savePayment(store, { debtId: d.id, direction: 'lent', txId: newId(), walletId: usd, amountMinor: 100, occurredOn: '2026-10-12', note: '', fx: { rate: 10.9, source: 'manual' } }),
    ).rejects.toThrow(/не совпадает с валютой долга/);
    expect((await stateOf(d.id)).payments).toHaveLength(0);
  });

  it('удаление платежа (мягкое) возвращает остаток; восстановление — снова платёж', async () => {
    const d = await debtOf('lent');
    const tx = await savePayment(store, { debtId: d.id, direction: 'lent', txId: newId(), walletId: cash, amountMinor: 20_000, occurredOn: '2026-10-12', note: '' });
    await store.transactions.softDelete(tx.id);
    expect((await stateOf(d.id)).remainingMinor).toBe(50_000);
    expect(await store.db.transactions.get(tx.id)).toMatchObject({ deletedAt: expect.any(String) });
    await store.transactions.restore(tx.id);
    expect((await stateOf(d.id)).remainingMinor).toBe(30_000);
  });

  it('переплата считается отдельно, остаток не уходит в минус', async () => {
    const d = await debtOf('lent');
    await savePayment(store, { debtId: d.id, direction: 'lent', txId: newId(), walletId: cash, amountMinor: 60_000, occurredOn: '2026-10-12', note: '' });
    const st = await stateOf(d.id);
    expect(st.remainingMinor).toBe(0);
    expect(st.overpaidMinor).toBe(10_000);
    expect(st.settled).toBe(true);
  });
});
