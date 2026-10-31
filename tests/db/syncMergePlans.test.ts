import { describe, expect, it } from 'vitest';
import type { Budget, Debt, RecurringRule, Transaction } from '@/domain/types';
import { ValidationError } from '@/db';
import { MERGE_GROUPS } from '@/db/mergeGroups';
import { basics, makeStore, stamp } from './helpers';

/**
 * Слияние по группам для НОВЫХ таблиц (бюджеты, долги, регулярные платежи) и новых групп операций (debtId в money, recurringRuleId в origin).
 * Те же правила, что у старых таблиц (см. syncMerge.test.ts): свои группы остаются своими, остальные берутся с сервера.
 */

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const NEW = stamp(T0 + 5_000);
const OLD = stamp(T0 - 5_000);
const REMOTE = 'device-r-0001';

/** Строка как её отдаёт сервер: без локальных служебных полей. */
function wire<T extends object>(r: T, over: Partial<T> = {}): any {
  const { dirty: _d, serverSeq: _s, syncError: _e, dirtyGroups: _g, dirtyBase: _b, ...entity } = r as Record<string, unknown>;
  void [_d, _s, _e, _g, _b];
  return { ...entity, ...over };
}

async function device() {
  const store = await makeStore({ now: () => T0, deviceId: 'device-local-0001' });
  const k = await basics(store);
  return { store, ...k };
}

/** Доводит локальную строку до «чистой, подтверждённой сервером» (как после первой синхронизации). */
async function settle<T extends 'budgets' | 'debts' | 'recurring_rules' | 'transactions'>(
  store: Awaited<ReturnType<typeof makeStore>>,
  table: T,
  id: string,
  seq: number,
) {
  const row = (await store.db.syncTable(table).get(id)) as any;
  await store.sync.markPushed(table, [{ id, clientUpdatedAt: row.clientUpdatedAt, deviceId: row.deviceId }]);
  const clean = (await store.db.syncTable(table).get(id)) as any;
  const echo = wire(clean);
  await store.sync.applyRemotePage(table, [{ entity: echo, serverSeq: seq }] as never, seq);
  return (await store.db.syncTable(table).get(id)) as any;
}

describe('новые таблицы принимаются с сервера', () => {
  it('вставка бюджета, долга и регулярного платежа с другого устройства; строки чистые, курсоры двигаются', async () => {
    const { store, cash, food } = await device();
    const base = { createdAt: stamp(T0 - 9_000), clientUpdatedAt: OLD, deviceId: REMOTE, deletedAt: null };
    const budget: Budget = { ...base, id: 'b-1', categoryId: food.id, amountMinor: 1_000, currency: 'TJS', period: 'month', archivedAt: null };
    const debt: Debt = { ...base, id: 'd-1', direction: 'lent', counterparty: 'Али', principalMinor: 5_000, interestMinor: null, interestRateBp: null, termMonths: null, mergedIntoId: null, category: '', currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null };
    const rule: RecurringRule = {
      ...base, id: 'r-1', kind: 'expense', walletId: cash.id, toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: null, debtId: 'd-1', note: '',
      frequency: 'monthly', intervalN: 1, startOn: '2026-10-15', endOn: null, autoPost: 0, archivedAt: null,
    };
    expect(await store.sync.applyRemotePage('budgets', [{ entity: budget, serverSeq: 1 }], 1)).toMatchObject({ applied: 1 });
    expect(await store.sync.applyRemotePage('debts', [{ entity: debt, serverSeq: 2 }], 2)).toMatchObject({ applied: 1 });
    expect(await store.sync.applyRemotePage('recurring_rules', [{ entity: rule, serverSeq: 3 }], 3)).toMatchObject({ applied: 1 });
    expect(await store.db.budgets.get('b-1')).toMatchObject({ amountMinor: 1_000, dirty: 0, serverSeq: 1 });
    expect(await store.db.debts.get('d-1')).toMatchObject({ counterparty: 'Али', dirty: 0, serverSeq: 2 });
    expect(await store.db.recurring_rules.get('r-1')).toMatchObject({ debtId: 'd-1', frequency: 'monthly', dirty: 0, serverSeq: 3 });
    expect(await store.sync.getCursor('budgets')).toBe(1);
    expect(await store.sync.getCursor('debts')).toBe(2);
    expect(await store.sync.getCursor('recurring_rules')).toBe(3);
  });

  it('лишние поля отбрасываются, обязательное пустое — ошибка и в базе ничего не меняется', async () => {
    const { store } = await device();
    const base = { createdAt: stamp(T0 - 9_000), clientUpdatedAt: OLD, deviceId: REMOTE, deletedAt: null };
    const debt = { ...base, id: 'd-1', direction: 'lent', counterparty: 'Али', principalMinor: 5_000, category: '', currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null };
    await store.sync.applyRemotePage('debts', [{ entity: { ...debt, dirty: 0, лишнее: 1 } as never, serverSeq: 1 }], 1);
    expect(Object.keys((await store.db.debts.get('d-1'))!)).not.toContain('лишнее');
    await expect(store.sync.applyRemotePage('debts', [{ entity: { ...debt, id: 'd-2', counterparty: null } as never, serverSeq: 2 }], 2)).rejects.toBeInstanceOf(ValidationError);
    expect(await store.db.debts.get('d-2')).toBeUndefined();
    expect(await store.sync.getCursor('debts')).toBe(1);
  });
});

describe('бюджеты: группы limit / target / archived / deleted', () => {
  it('сумма у нас, архив у сервера — объединяются', async () => {
    const { store, food } = await device();
    const b = await store.budgets.create({ categoryId: food.id, amountMinor: 1_000 });
    const clean = await settle(store, 'budgets', b.id, 1);
    await store.budgets.update(b.id, { amountMinor: 2_000 });
    const r = await store.sync.applyRemotePage('budgets', [{ entity: wire(clean, { archivedAt: NEW, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(r.merged).toBe(1);
    expect(await store.db.budgets.get(b.id)).toMatchObject({ amountMinor: 2_000, archivedAt: NEW, dirty: 1, dirtyGroups: ['limit'] });
  });

  it('одна и та же группа правлена на обоих: побеждает более поздняя правка, группа берётся целиком', async () => {
    const { store, food } = await device();
    const b = await store.budgets.create({ categoryId: food.id, amountMinor: 1_000 });
    const clean = await settle(store, 'budgets', b.id, 1);
    await store.budgets.update(b.id, { amountMinor: 2_000 }); // наша правка: T0
    await store.sync.applyRemotePage('budgets', [{ entity: wire(clean, { amountMinor: 3_000, currency: 'TJS', clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(await store.db.budgets.get(b.id)).toMatchObject({ amountMinor: 3_000, dirty: 0 }); // серверная правка позже нашей
  });
});

describe('долги: группы party / amount / dates / note / closed / archived / deleted', () => {
  async function debtDevice() {
    const d0 = await device();
    const d = await d0.store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-12-01' });
    const clean = await settle(d0.store, 'debts', d.id, 1);
    return { ...d0, d, clean };
  }

  it('сумма и заметка у нас, закрытие и срок у сервера', async () => {
    const { store, d, clean } = await debtDevice();
    await store.debts.update(d.id, { principalMinor: 6_000, note: 'моя' });
    const r = await store.sync.applyRemotePage('debts', [{ entity: wire(clean, { closedAt: NEW, dueOn: '2027-01-01', clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(r.merged).toBe(1);
    expect(await store.db.debts.get(d.id)).toMatchObject({ principalMinor: 6_000, note: 'моя', closedAt: NEW, dueOn: '2027-01-01', dirtyGroups: ['amount', 'note'] });
  });

  it('имя у нас, закрытие у нас, сервер сменил сумму: каждая группа из своего источника', async () => {
    const { store, d, clean } = await debtDevice();
    await store.debts.update(d.id, { counterparty: 'Вали' });
    await store.debts.close(d.id);
    await store.sync.applyRemotePage('debts', [{ entity: wire(clean, { principalMinor: 7_000, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    const row = (await store.db.debts.get(d.id))!;
    expect(row).toMatchObject({ counterparty: 'Вали', principalMinor: 7_000, dirtyGroups: ['party', 'closed'] });
    expect(row.closedAt).not.toBeNull();
  });

  it('удаление на сервере (группа deleted) побеждает нашу правку другой группы, когда оно позже; строка не теряется', async () => {
    const { store, d, clean } = await debtDevice();
    await store.debts.update(d.id, { note: 'правка' });
    await store.sync.applyRemotePage('debts', [{ entity: wire(clean, { deletedAt: NEW, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(await store.db.debts.get(d.id)).toMatchObject({ deletedAt: NEW, note: 'правка', dirty: 1 });
  });
});

describe('регулярные платежи: группы money / schedule / mode / note / archived / deleted', () => {
  async function ruleDevice() {
    const d0 = await device();
    const r = await d0.store.recurring.create({ kind: 'expense', walletId: d0.cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-10-15', note: 'аренда' });
    const clean = await settle(d0.store, 'recurring_rules', r.id, 1);
    return { ...d0, r, clean };
  }

  it('автопроведение у нас, расписание у сервера', async () => {
    const { store, r, clean } = await ruleDevice();
    await store.recurring.update(r.id, { autoPost: 1 });
    await store.sync.applyRemotePage('recurring_rules', [{ entity: wire(clean, { frequency: 'weekly', intervalN: 2, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(await store.db.recurring_rules.get(r.id)).toMatchObject({ autoPost: 1, frequency: 'weekly', intervalN: 2, dirtyGroups: ['mode'] });
  });

  it('сумма платежа у нас, заметка и архив у сервера', async () => {
    const { store, r, clean } = await ruleDevice();
    await store.recurring.update(r.id, { amountMinor: 6_000 });
    await store.sync.applyRemotePage('recurring_rules', [{ entity: wire(clean, { note: 'квартира', archivedAt: NEW, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(await store.db.recurring_rules.get(r.id)).toMatchObject({ amountMinor: 6_000, note: 'квартира', archivedAt: NEW });
  });

  it('поля одной группы едут вместе: кошелёк+сумма не разрываются между устройствами', async () => {
    const { store, r, clean, usd } = await ruleDevice();
    await store.recurring.update(r.id, { amountMinor: 6_000 });
    await store.sync.applyRemotePage('recurring_rules', [{ entity: wire(clean, { walletId: usd.id, amountMinor: 9_000, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    const row = (await store.db.recurring_rules.get(r.id))!;
    expect([row.walletId, row.amountMinor]).toEqual([usd.id, 9_000]); // группа money целиком серверная (правка позже)
  });
});

describe('операции: debtId в группе money, recurringRuleId в группе origin', () => {
  it('состав групп', () => {
    expect(MERGE_GROUPS.transactions['money']).toContain('debtId');
    expect(MERGE_GROUPS.transactions['origin']).toEqual(['recurringRuleId']);
  });

  it('заметка у нас, привязка к долгу у сервера: объединяются', async () => {
    const { store, cash } = await device();
    const debt = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-10-01' });
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-05' });
    const clean = await settle(store, 'transactions', t.id, 1);
    await store.transactions.update(t.id, { note: 'моя' });
    await store.sync.applyRemotePage('transactions', [{ entity: wire(clean, { debtId: debt.id, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    expect(await store.db.transactions.get(t.id)).toMatchObject({ note: 'моя', debtId: debt.id, dirtyGroups: ['note'] });
  });

  it('сумма у нас, а привязку к долгу сервер снял: money — одна группа, побеждает более поздняя целиком', async () => {
    const { store, cash } = await device();
    const debt = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-10-01' });
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-05', debtId: debt.id });
    const clean = await settle(store, 'transactions', t.id, 1);
    await store.transactions.update(t.id, { amountMinor: 700 });
    await store.sync.applyRemotePage('transactions', [{ entity: wire(clean, { debtId: null, clientUpdatedAt: NEW, deviceId: REMOTE }), serverSeq: 2 }] as never, 2);
    const row = (await store.db.transactions.get(t.id))!;
    // сервер позже: группа money целиком серверная — и сумма 500 (не наша 700), и debtId = null; договорённость «целиком»
    expect([row.amountMinor, row.debtId]).toEqual([500, null]);
  });

  it('старая серверная строка без новых полей (null) не затирает локальные debtId/recurringRuleId у чистой строки молча: чистая берёт серверное', async () => {
    const { store, cash } = await device();
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-05' });
    const clean = await settle(store, 'transactions', t.id, 1);
    const withoutNew = wire(clean) as Transaction;
    delete (withoutNew as Partial<Transaction>).debtId;
    delete (withoutNew as Partial<Transaction>).recurringRuleId;
    await store.sync.applyRemotePage('transactions', [{ entity: { ...withoutNew, clientUpdatedAt: NEW, deviceId: REMOTE }, serverSeq: 2 }], 2);
    expect(await store.db.transactions.get(t.id)).toMatchObject({ debtId: null, recurringRuleId: null, dirty: 0 });
  });
});

describe('примитивы синхронизации работают для новых таблиц без особых случаев', () => {
  it('очередь отправки, счётчики, карантин и повтор по всем трём новым таблицам', async () => {
    const { store, cash, food } = await device();
    const b = await store.budgets.create({ categoryId: food.id, amountMinor: 100 });
    const d = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 5, interestMinor: null, interestRateBp: null, termMonths: null, currency: 'TJS', openedOn: '2026-10-01' });
    const r = await store.recurring.create({ kind: 'expense', walletId: cash.id, amountMinor: 10, frequency: 'daily', startOn: '2026-10-01' });
    for (const [table, id] of [['budgets', b.id], ['debts', d.id], ['recurring_rules', r.id]] as const) {
      expect((await store.sync.listDirty(table, 10)).map((x) => x.id)).toEqual([id]);
    }
    const before = await store.sync.counts();
    expect(before.quarantined).toBe(0);
    expect(before.pending).toBeGreaterThanOrEqual(3);
    expect(await store.sync.quarantine('debts', [d.id], 'Сервер отверг')).toBe(1);
    expect((await store.sync.counts()).quarantined).toBe(1);
    expect(await store.sync.listDirty('debts', 10)).toEqual([]); // в карантине — не отправляется
    expect(await store.sync.retryQuarantined()).toBe(1);
    expect((await store.sync.listDirty('debts', 10)).map((x) => x.id)).toEqual([d.id]);
    // отправлено → строка чистая и больше не в очереди; память о правках остаётся до подтверждения (как у старых таблиц)
    const row = (await store.db.budgets.get(b.id))!;
    expect(await store.sync.markPushed('budgets', [{ id: b.id, clientUpdatedAt: row.clientUpdatedAt, deviceId: row.deviceId }])).toBe(1);
    expect(await store.sync.listDirty('budgets', 10)).toEqual([]);
    // правка во время отправки не теряется
    const cur = (await store.db.recurring_rules.get(r.id))!;
    await store.recurring.update(r.id, { note: 'после чтения' });
    expect(await store.sync.markPushed('recurring_rules', [{ id: r.id, clientUpdatedAt: cur.clientUpdatedAt, deviceId: cur.deviceId }])).toBe(0);
    expect((await store.sync.listDirty('recurring_rules', 10)).map((x) => x.id)).toEqual([r.id]);
    expect(await store.sync.hasMergeableEdits()).toBe(true); // правка существующего регулярного платежа (заметка) перед отправкой сверяется с сервером
  });

  it('курсоры новых таблиц независимы и сбрасываются вместе с остальными', async () => {
    const { store } = await device();
    const base = { createdAt: stamp(T0 - 9_000), clientUpdatedAt: OLD, deviceId: REMOTE, deletedAt: null };
    const debt: Debt = { ...base, id: 'd-9', direction: 'lent', counterparty: 'Али', principalMinor: 5, interestMinor: null, interestRateBp: null, termMonths: null, mergedIntoId: null, category: '', currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null };
    await store.sync.applyRemotePage('debts', [{ entity: debt, serverSeq: 5 }], 5);
    expect(await store.sync.getCursor('debts')).toBe(5);
    expect(await store.sync.getCursor('budgets')).toBe(0);
    await store.sync.resetCursors();
    expect(await store.sync.getCursor('debts')).toBe(0);
  });
});
