import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeeded, newId, openStore, ValidationError, type Store } from '@/db';
import { savePayInParts, type PayInPartsPlan } from './debtActions';

const PLAN_EXISTS = 'У долга уже есть план платежей: измените его на странице долга';

let store: Store;
let cash: string;
let lentId: string; // Алишер должен мне 500
let borrowedId: string; // я должен Алишеру 200

beforeEach(async () => {
  store = await openStore('user-debt-plan', { deviceId: 'dev-1', dexie: { indexedDB: new IDBFactory(), IDBKeyRange } });
  await ensureSeeded(store);
  cash = (await store.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  await store.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
  lentId = (await store.debts.create({ direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01' })).id;
  borrowedId = (await store.debts.create({ direction: 'borrowed', counterparty: 'Алишер', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-10-02' })).id;
});
afterEach(() => store.close());

const parts = (over: Partial<PayInPartsPlan> = {}): PayInPartsPlan => ({
  debtId: lentId,
  direction: 'lent',
  counterparty: 'Алишер',
  walletId: cash,
  amountMinor: 20_000,
  startOn: '2026-11-15',
  endOn: '2027-01-15',
  autoPost: false,
  ...over,
});
const rulesOf = async (debtId: string) => (await store.db.recurring_rules.toArray()).filter((r) => r.debtId === debtId);
const livePlansOf = async (debtId: string) => (await rulesOf(debtId)).filter((r) => r.deletedAt === null && r.archivedAt === null);

describe('savePayInParts: у долга один живой план', () => {
  it('второй план тому же долгу (другой id) — понятная ошибка; второе правило не создано, первое не тронуто', async () => {
    const first = await savePayInParts(store, parts(), newId());
    const err = await savePayInParts(store, parts({ amountMinor: 10_000, startOn: '2026-12-01', endOn: '2027-04-01' }), newId()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe(PLAN_EXISTS);
    const rules = await rulesOf(lentId);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: first.id, amountMinor: 20_000, startOn: '2026-11-15', endOn: '2027-01-15', archivedAt: null });
  });

  it('ошибка и у «я должен»: второй план расходом тоже не создаётся', async () => {
    await savePayInParts(store, parts({ debtId: borrowedId, direction: 'borrowed', amountMinor: 5_000 }), newId());
    await expect(savePayInParts(store, parts({ debtId: borrowedId, direction: 'borrowed', amountMinor: 7_000 }), newId())).rejects.toThrow(PLAN_EXISTS);
    expect(await rulesOf(borrowedId)).toHaveLength(1);
  });

  it('повтор с тем же id не считается «вторым планом»: отказ только из-за занятого id, правило одно', async () => {
    const id = newId();
    await savePayInParts(store, parts(), id);
    const err = await savePayInParts(store, parts(), id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toBe('Регулярный платёж с таким id уже существует');
    expect(await rulesOf(lentId)).toHaveLength(1);
  });

  it('план в архиве («Остановить») не мешает новому: новый создаётся, старый остаётся в архиве', async () => {
    const old = await savePayInParts(store, parts(), newId());
    await store.recurring.archive(old.id);
    const fresh = await savePayInParts(store, parts({ amountMinor: 25_000, startOn: '2026-11-20', endOn: '2027-01-20' }), newId());
    const live = await livePlansOf(lentId);
    expect(live.map((r) => r.id)).toEqual([fresh.id]);
    expect(live[0]).toMatchObject({ kind: 'income', amountMinor: 25_000 });
    expect((await store.db.recurring_rules.get(old.id))?.archivedAt).not.toBeNull();
  });

  it('план, вернувшийся из архива, снова мешает следующему', async () => {
    const old = await savePayInParts(store, parts(), newId());
    await store.recurring.archive(old.id);
    await store.recurring.restore(old.id);
    await expect(savePayInParts(store, parts(), newId())).rejects.toThrow(PLAN_EXISTS);
    expect(await rulesOf(lentId)).toHaveLength(1);
  });

  it('удалённый план (удаление пришло с другого устройства) не мешает новому', async () => {
    const old = await savePayInParts(store, parts(), newId());
    await store.db.recurring_rules.update(old.id, { deletedAt: '2026-10-14T10:00:00.000Z' });
    const fresh = await savePayInParts(store, parts({ amountMinor: 30_000 }), newId());
    expect((await livePlansOf(lentId)).map((r) => r.id)).toEqual([fresh.id]);
  });

  it('план другого долга того же человека не мешает: у «мне должны» и «я должен» по плану', async () => {
    const mine = await savePayInParts(store, parts({ debtId: borrowedId, direction: 'borrowed', amountMinor: 5_000 }), newId());
    const theirs = await savePayInParts(store, parts(), newId());
    expect(mine.kind).toBe('expense');
    expect(theirs.kind).toBe('income');
    expect(await livePlansOf(borrowedId)).toHaveLength(1);
    expect(await livePlansOf(lentId)).toHaveLength(1);
  });

  it('регулярная выдача по долгу (расход с debtId «мне должны») — не план платежей и не мешает', async () => {
    await store.recurring.create({
      kind: 'expense',
      walletId: cash,
      amountMinor: 10_000,
      categoryId: null,
      debtId: lentId,
      note: 'ещё в долг',
      frequency: 'monthly',
      intervalN: 1,
      startOn: '2026-11-01',
      endOn: null,
      autoPost: 0,
    });
    const plan = await savePayInParts(store, parts(), newId());
    expect(plan.kind).toBe('income');
    expect(await rulesOf(lentId)).toHaveLength(2);
  });

  it('план, который стоит из-за закрытого долга, всё равно мешает: после «Открыть снова» он продолжится сам', async () => {
    await savePayInParts(store, parts(), newId());
    await store.debts.close(lentId);
    await expect(savePayInParts(store, parts(), newId())).rejects.toThrow(PLAN_EXISTS);
    expect(await rulesOf(lentId)).toHaveLength(1);
  });

  it('два сохранения одновременно (два окна, разные id): создаётся ровно один план, второе — с ошибкой', async () => {
    const results = await Promise.allSettled([
      savePayInParts(store, parts({ amountMinor: 20_000 }), newId()),
      savePayInParts(store, parts({ amountMinor: 25_000 }), newId()),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ValidationError);
    expect((failed[0]!.reason as Error).message).toBe(PLAN_EXISTS);
    expect(await rulesOf(lentId)).toHaveLength(1);
  });
});
