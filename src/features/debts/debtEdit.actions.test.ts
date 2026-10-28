import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, FxRequiredError, newId, openStore, summarizeMonth, ValidationError, type Store } from '@/db';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { saveDebtEdit, saveTopUp, type DebtEditPlan } from './debtActions';
import { debtEntryLines, editMoneyText, entryEditText, planEntryAdjustment, walletGoesDown } from './debtEditMoney';

let store: Store;
let cash: string;
let usd: string;
let debtId: string;
let issueId: string;

beforeEach(async () => {
  store = await openStore('user-debt-edit', { deviceId: 'dev-1', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  usd = (await store.wallets.create({ name: 'Доллары', currency: 'USD', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '💲' })).id;
  await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-10-01' });
  debtId = (await store.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' })).id;
  issueId = (await store.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId })).id;
});
afterEach(() => store.close());

const plan = (over: Partial<DebtEditPlan> = {}): DebtEditPlan => ({ debtId, patch: { principalMinor: 70_000 }, money: true, ...over });
const balance = async (walletId: string) => {
  const wallets = (await store.db.wallets.toArray()).filter((w) => w.deletedAt === null);
  return computeBalances(wallets, await store.db.transactions.toArray()).get(walletId);
};
const snapshot = async () => JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray()]);
const stateOf = async (id = debtId) =>
  computeDebtState((await store.db.debts.get(id))!, await store.db.transactions.toArray(), await store.db.wallets.toArray());

describe('saveDebtEdit: правка суммы двигает деньги', () => {
  it('«Я дал»: сумма выросла — выдача выросла, кошелёк уменьшился, долг и «выдано деньгами» совпадают', async () => {
    const r = await saveDebtEdit(store, plan());
    expect(r.moved).toBe(true);
    expect(r.debt.principalMinor).toBe(70_000);
    expect(await store.db.transactions.get(issueId)).toMatchObject({ kind: 'expense', amountMinor: 70_000, walletId: cash, debtId });
    expect(await balance(cash)).toBe(30_000); // 1 000 − 700
    expect(await stateOf()).toMatchObject({ principalMinor: 70_000, issuedMinor: 70_000, remainingMinor: 70_000 });
  });

  it('«Я дал»: сумма уменьшилась — деньги вернулись в кошелёк', async () => {
    const r = await saveDebtEdit(store, plan({ patch: { principalMinor: 20_000 } }));
    expect(r.moved).toBe(true);
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(20_000);
    expect(await balance(cash)).toBe(80_000);
    expect(await stateOf()).toMatchObject({ principalMinor: 20_000, issuedMinor: 20_000 });
  });

  it('«Я взял»: сумма выросла — доход на кошелёк, уменьшилась — кошелёк уменьшился', async () => {
    const borrowed = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' });
    const inc = await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 10_000, occurredOn: '2026-10-02', debtId: borrowed.id });
    const before = (await balance(cash))!;
    await saveDebtEdit(store, plan({ debtId: borrowed.id, patch: { principalMinor: 15_000 } }));
    expect((await store.db.transactions.get(inc.id))?.amountMinor).toBe(15_000);
    expect(await balance(cash)).toBe(before + 5_000);
    await saveDebtEdit(store, plan({ debtId: borrowed.id, patch: { principalMinor: 4_000 } }));
    expect(await balance(cash)).toBe(before - 6_000);
  });

  it('правка не входит в доходы и расходы месяца и не создаёт платежей', async () => {
    await saveDebtEdit(store, plan());
    const rows = await store.db.transactions.where('occurredOn').between('2026-10-01', '2026-10-31', true, true).toArray();
    expect(summarizeMonth(rows, '2026-10', 'TJS')).toMatchObject({ expenseMinor: 0, debtOutMinor: 70_000 });
    expect((await stateOf()).paidMinor).toBe(0);
    expect(rows.filter((t) => t.debtId === debtId)).toHaveLength(1); // новых операций нет — поправлена прежняя
  });

  it('есть пополнения: правится самая поздняя выдача; уменьшение, большее неё, забирает и с прежней', async () => {
    const topUp = await saveTopUp(store, { debtId, direction: 'lent', amountMinor: 30_000, occurredOn: '2026-10-10', note: '', movement: { walletId: cash, txId: newId() } });
    await saveDebtEdit(store, plan({ patch: { principalMinor: 90_000 } })); // 80 000 → 90 000
    expect((await store.db.transactions.get(topUp.tx!.id))?.amountMinor).toBe(40_000);
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(50_000);

    await saveDebtEdit(store, plan({ patch: { principalMinor: 30_000 } })); // −60 000: пополнение уходит целиком, прежняя выдача — на 20 000
    expect((await store.db.transactions.get(topUp.tx!.id))?.deletedAt).not.toBeNull();
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(30_000);
    expect(await stateOf()).toMatchObject({ principalMinor: 30_000, issuedMinor: 30_000 });
    expect(await balance(cash)).toBe(70_000);
  });

  it('деньги выдавались не на всю сумму: возвращается только то, что выдано', async () => {
    await store.db.transactions.update(issueId, { amountMinor: 10_000 }); // так могла прийти старая запись: выдано 100 из 500
    const r = await saveDebtEdit(store, plan({ patch: { principalMinor: 20_000 } })); // −300, а выдано всего 100
    expect(r.moved).toBe(true);
    expect((await store.db.transactions.get(issueId))?.deletedAt).not.toBeNull();
    expect(await balance(cash)).toBe(100_000);
  });
});

describe('saveDebtEdit: когда деньги не двигаются', () => {
  it('money: false — меняется только долг', async () => {
    const r = await saveDebtEdit(store, plan({ money: false }));
    expect(r.moved).toBe(false);
    expect(r.debt.principalMinor).toBe(70_000);
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(50_000);
  });

  it('сумма не менялась (имя, срок, заметка): операции не трогаются, даже при money: true', async () => {
    const snap = (await store.db.transactions.toArray()).map((t) => t.clientUpdatedAt);
    const r = await saveDebtEdit(store, plan({ patch: { counterparty: 'Алишер Р.', note: 'на ремонт' } }));
    expect(r).toMatchObject({ moved: false, debt: { counterparty: 'Алишер Р.', note: 'на ремонт', principalMinor: 50_000 } });
    expect((await store.db.transactions.toArray()).map((t) => t.clientUpdatedAt)).toEqual(snap);
  });

  it('долг «на бумаге», сумма уменьшилась: двигать нечего', async () => {
    const paper = await store.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' });
    const before = await balance(cash);
    const r = await saveDebtEdit(store, plan({ debtId: paper.id, patch: { principalMinor: 4_000 } }));
    expect(r).toMatchObject({ moved: false, debt: { principalMinor: 4_000 } });
    expect(await balance(cash)).toBe(before);
  });

  it('долг «на бумаге», сумма выросла, куда записать не сказали: деньги не двигаются', async () => {
    const paper = await store.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' });
    const r = await saveDebtEdit(store, plan({ debtId: paper.id, patch: { principalMinor: 15_000 } }));
    expect(r.moved).toBe(false);
    expect((await stateOf(paper.id)).issuedMinor).toBe(0);
  });
});

describe('saveDebtEdit: долг «на бумаге» и рост суммы с кошельком', () => {
  let paperId: string;
  beforeEach(async () => {
    paperId = (await store.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-10-02' })).id;
  });
  const withEntry = (txId: string) => plan({ debtId: paperId, patch: { principalMinor: 15_000 }, newEntry: { walletId: cash, txId, occurredOn: '2026-10-02' } });

  it('на разницу записывается выдача, кошелёк уменьшается именно на разницу', async () => {
    const before = (await balance(cash))!;
    const txId = newId();
    const r = await saveDebtEdit(store, withEntry(txId));
    expect(r.moved).toBe(true);
    expect(await store.db.transactions.get(txId)).toMatchObject({ kind: 'expense', walletId: cash, amountMinor: 5_000, occurredOn: '2026-10-02', debtId: paperId, categoryId: null });
    expect(await balance(cash)).toBe(before - 5_000);
    expect(await stateOf(paperId)).toMatchObject({ principalMinor: 15_000, issuedMinor: 5_000 });
  });

  it('повтор с тем же id (двойное нажатие) не дублирует операцию', async () => {
    const txId = newId();
    await saveDebtEdit(store, withEntry(txId));
    const before = (await balance(cash))!;
    await saveDebtEdit(store, withEntry(txId));
    expect(await balance(cash)).toBe(before);
    expect((await store.db.transactions.where('debtId').equals(paperId).toArray()).length).toBe(1);
  });

  it('направление меняется вместе с суммой: выдача того вида, который выбран', async () => {
    const txId = newId();
    await saveDebtEdit(store, plan({ debtId: paperId, patch: { principalMinor: 15_000, direction: 'borrowed' }, newEntry: { walletId: cash, txId, occurredOn: '2026-10-02' } }));
    expect((await store.db.transactions.get(txId))?.kind).toBe('income');
  });
});

describe('saveDebtEdit: всё или ничего', () => {
  it('кошелёк выдачи в архиве: прежняя выдача всё равно правится (как и любая операция в архивном кошельке)', async () => {
    await store.wallets.archive(cash);
    const r = await saveDebtEdit(store, plan());
    expect(r.moved).toBe(true);
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(70_000);
  });

  it('операцию поправить не удалось (кошелёк выдачи пропал): откатывается и сумма долга', async () => {
    await store.db.wallets.update(cash, { deletedAt: '2026-10-05T00:00:00.000Z' });
    const snap = await snapshot();
    await expect(saveDebtEdit(store, plan())).rejects.toThrow(ValidationError);
    expect(await snapshot()).toBe(snap);
  });

  it('новая выдача не записалась (нет курса): сумма долга не выросла', async () => {
    const paper = await store.debts.create({ direction: 'lent', counterparty: 'Джон', principalMinor: 1_000, currency: 'USD', openedOn: '2026-10-02' });
    const snap = await snapshot();
    await expect(
      saveDebtEdit(store, plan({ debtId: paper.id, patch: { principalMinor: 2_000 }, newEntry: { walletId: usd, txId: newId(), occurredOn: '2026-10-02' } })),
    ).rejects.toThrow(FxRequiredError);
    expect(await snapshot()).toBe(snap);
  });

  it('сумма больше предела: ни долг, ни операция не меняются', async () => {
    const snap = await snapshot();
    await expect(saveDebtEdit(store, plan({ patch: { principalMinor: 1_000_000_000_000_001 } }))).rejects.toThrow(/слишком велика|Сумма/);
    expect(await snapshot()).toBe(snap);
  });

  it('долг удалён и неизвестный долг', async () => {
    await store.debts.softDelete(debtId, 'keep-operations');
    await expect(saveDebtEdit(store, plan())).rejects.toThrow(/удалён/);
    await expect(saveDebtEdit(store, plan({ debtId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' }))).rejects.toThrow(/Долг не найден/);
  });
});

describe('saveDebtEdit: правка считается от долга в базе, а не от того, что видели при открытии', () => {
  it('чужая правка суммы пришла, пока шит был открыт: деньги двигаются на реальную разницу', async () => {
    await store.debts.update(debtId, { principalMinor: 60_000 }); // чужая правка (долг без движения денег)
    await saveDebtEdit(store, plan({ patch: { principalMinor: 70_000 } })); // форма видела 500, ставит 700; в базе было 600
    expect((await store.db.transactions.get(issueId))?.amountMinor).toBe(60_000); // 500 + реальные 100
  });
});

describe('planEntryAdjustment', () => {
  const e = [
    { txId: 'a', amountMinor: 100 },
    { txId: 'b', amountMinor: 50 },
  ];
  it('рост — последняя выдача', () => expect(planEntryAdjustment(e, 30)).toEqual({ steps: [{ txId: 'b', fromMinor: 50, toMinor: 80 }], uncoveredMinor: 0 }));
  it('уменьшение внутри последней выдачи', () => expect(planEntryAdjustment(e, -20)).toEqual({ steps: [{ txId: 'b', fromMinor: 50, toMinor: 30 }], uncoveredMinor: 0 }));
  it('ровно последняя выдача убирается целиком', () => expect(planEntryAdjustment(e, -50)).toEqual({ steps: [{ txId: 'b', fromMinor: 50, toMinor: 0 }], uncoveredMinor: 0 }));
  it('больше последней — захватывает прежнюю', () =>
    expect(planEntryAdjustment(e, -120)).toEqual({
      steps: [
        { txId: 'b', fromMinor: 50, toMinor: 0 },
        { txId: 'a', fromMinor: 100, toMinor: 30 },
      ],
      uncoveredMinor: 0,
    }));
  it('больше всех выдач — остаток не покрыт', () => expect(planEntryAdjustment(e, -200).uncoveredMinor).toBe(50));
  it('выдач нет — всё не покрыто; нулевая разница — ничего', () => {
    expect(planEntryAdjustment([], 40)).toEqual({ steps: [], uncoveredMinor: 40 });
    expect(planEntryAdjustment(e, 0)).toEqual({ steps: [], uncoveredMinor: 0 });
  });
});

describe('тексты и выдачи долга', () => {
  it('куда пойдёт кошелёк', () => {
    expect(walletGoesDown('lent', 5)).toBe(true);
    expect(walletGoesDown('lent', -5)).toBe(false);
    expect(walletGoesDown('borrowed', 5)).toBe(false);
    expect(walletGoesDown('borrowed', -5)).toBe(true);
  });

  it('текст называет кошелёк, сумму и направление', () => {
    const adj = planEntryAdjustment([{ txId: 'a', amountMinor: 100 }], 30);
    const up = editMoneyText('lent', 'TJS', 30, adj, ['Наличные', 'Наличные']);
    expect(up).toMatch(/Остаток кошелька «Наличные» уменьшится на .*0[,.]30.*не войдёт/);
    expect(editMoneyText('borrowed', 'TJS', 30, adj, ['Наличные'])).toContain('вырастет');
    const short = planEntryAdjustment([{ txId: 'a', amountMinor: 10 }], -30);
    expect(editMoneyText('lent', 'TJS', -30, short, ['Наличные'])).toMatch(/вырастет на .*0[,.]10.*Ещё .*0[,.]20.* не проходили через кошелёк/);
    expect(editMoneyText('lent', 'TJS', -30, short, ['А', 'Б'])).toContain('кошельков «А», «Б»');
  });

  it('debtEntryLines и entryEditText: выдачи с кошельками, чужая валюта не входит', async () => {
    const debt = (await store.db.debts.get(debtId))!;
    const wallets = await store.db.wallets.toArray();
    const foreign = await store.transactions.create({ kind: 'expense', walletId: usd, amountMinor: 100, occurredOn: '2026-10-02', debtId, fx: { rate: 10, source: 'manual' } }).catch(() => null);
    expect(foreign).toBeNull(); // репозиторий не даёт: операция долга обязана быть в валюте долга
    const lines = debtEntryLines(debt, await store.db.transactions.where('debtId').equals(debtId).toArray(), wallets);
    expect(lines).toEqual([{ txId: issueId, walletId: cash, amountMinor: 50_000 }]);
    expect(entryEditText('lent', 'TJS', 20_000, lines, wallets)).toContain('«Наличные»');
  });
});
