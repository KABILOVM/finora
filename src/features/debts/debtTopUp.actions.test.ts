import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, FxRequiredError, newId, openStore, summarizeMonth, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { saveTopUp, type TopUpPlan } from './debtActions';

let store: Store;
let cash: string;
let usd: string;
let debtId: string;

beforeEach(async () => {
  store = await openStore('user-topup', { deviceId: 'dev-1', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  usd = (await store.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
  await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-10-01' });
  debtId = (await store.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' })).id;
  await store.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId });
});
afterEach(() => store.close());

const plan = (over: Partial<TopUpPlan> = {}): TopUpPlan => ({
  debtId,
  direction: 'lent',
  amountMinor: 30_000,
  occurredOn: '2026-10-10',
  note: '',
  movement: { walletId: cash, txId: newId() },
  ...over,
});
const balance = async (walletId: string) => {
  const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await store.db.transactions.toArray()).get(walletId);
};
const snapshot = async () => JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray()]);

describe('saveTopUp: рост долга и операция выдачи одной транзакцией', () => {
  it('«Я дал ещё»: сумма долга выросла, РАСХОД с debtId, без категории; кошелёк уменьшился', async () => {
    const p = plan({ note: ' ещё на запчасти ' });
    const r = await saveTopUp(store, p);
    expect(r.debt.principalMinor).toBe(80_000);
    expect(r.tx).toMatchObject({ id: p.movement!.txId, kind: 'expense', walletId: cash, amountMinor: 30_000, occurredOn: '2026-10-10', categoryId: null, debtId, note: 'ещё на запчасти' });
    expect(await balance(cash)).toBe(20_000); // 1 000 − 500 − 300
    const st = computeDebtState((await store.db.debts.get(debtId))!, await store.db.transactions.toArray(), await store.db.wallets.toArray());
    expect(st).toMatchObject({ principalMinor: 80_000, issuedMinor: 80_000, remainingMinor: 80_000 });
  });

  it('«Я взял ещё»: ДОХОД на кошелёк', async () => {
    const borrowed = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' });
    const r = await saveTopUp(store, plan({ debtId: borrowed.id, direction: 'borrowed' }));
    expect(r.tx?.kind).toBe('income');
    expect(await balance(cash)).toBe(80_000); // 500 после выдачи + 300
  });

  it('«на бумаге»: операции нет, кошельки не меняются, сумма растёт', async () => {
    const before = await balance(cash);
    const r = await saveTopUp(store, plan({ movement: null }));
    expect(r.tx).toBeNull();
    expect(r.debt.principalMinor).toBe(80_000);
    expect(await balance(cash)).toBe(before);
  });

  it('пополнение не входит в доходы и расходы месяца', async () => {
    await saveTopUp(store, plan());
    const rows = await store.db.transactions.where('occurredOn').between('2026-10-01', '2026-10-31', true, true).toArray();
    expect(summarizeMonth(rows, '2026-10', 'TJS')).toMatchObject({ expenseMinor: 0, debtOutMinor: 80_000 });
  });

  it('повтор с тем же id операции ничего не меняет (двойное нажатие)', async () => {
    const p = plan();
    const first = await saveTopUp(store, p);
    const snap = await snapshot();
    const again = await saveTopUp(store, p);
    expect(again.tx?.id).toBe(first.tx?.id);
    expect(again.debt.principalMinor).toBe(80_000);
    expect(await snapshot()).toBe(snap);
  });

  it('новый срок возврата применяется; не передан — прежний остаётся', async () => {
    await store.debts.update(debtId, { dueOn: '2026-11-01' });
    expect((await saveTopUp(store, plan())).debt.dueOn).toBe('2026-11-01');
    expect((await saveTopUp(store, plan({ dueOn: '2026-12-01' }))).debt.dueOn).toBe('2026-12-01');
    expect((await saveTopUp(store, plan({ dueOn: null }))).debt.dueOn).toBeNull();
  });

  describe('всё или ничего: ошибка операции откатывает и рост суммы', () => {
    it('кошелёк в другой валюте', async () => {
      const snap = await snapshot();
      await expect(saveTopUp(store, plan({ movement: { walletId: usd, txId: newId(), fx: { rate: 10.9, source: 'manual' } } }))).rejects.toThrow(ValidationError);
      expect(await snapshot()).toBe(snap);
    });

    it('кошелёк в архиве', async () => {
      await store.wallets.archive(cash);
      const snap = await snapshot();
      await expect(saveTopUp(store, plan())).rejects.toThrow(ValidationError);
      expect(await snapshot()).toBe(snap);
    });

    it('не хватает курса (кошелёк не в основной валюте)', async () => {
      const usdDebt = await store.debts.create({ direction: 'lent', counterparty: 'Джон', principalMinor: 1_000, currency: 'USD', openedOn: '2026-10-02' });
      const snap = await snapshot();
      await expect(saveTopUp(store, plan({ debtId: usdDebt.id, movement: { walletId: usd, txId: newId() } }))).rejects.toThrow(FxRequiredError);
      expect(await snapshot()).toBe(snap);
    });

    it('долг в архиве и неизвестный долг', async () => {
      await store.debts.archive(debtId);
      const snap = await snapshot();
      await expect(saveTopUp(store, plan())).rejects.toThrow(/в архиве/);
      await expect(saveTopUp(store, plan({ debtId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' }))).rejects.toThrow(/Долг не найден/);
      expect(await snapshot()).toBe(snap);
    });

    it('сумма больше предела сервера', async () => {
      const snap = await snapshot();
      await expect(saveTopUp(store, plan({ amountMinor: 1_000_000_000_000_000 }))).rejects.toThrow(/слишком велика|Сумма/);
      expect(await snapshot()).toBe(snap);
    });
  });
});
