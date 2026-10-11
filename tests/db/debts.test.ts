import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { basics, makeStore } from './helpers';

const input = { direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01' } as const;

describe('DebtsRepo.create', () => {
  it('создаёт долг: dirty, метки, пустые закрытие и архив; обрезает пробелы', async () => {
    const store = await makeStore({ deviceId: 'device-d-1' });
    const d = await store.debts.create({ ...input, counterparty: '  Али  ', dueOn: '2026-12-01', note: ' на ремонт ' });
    expect(d).toMatchObject({
      direction: 'lent', counterparty: 'Али', principalMinor: 100_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-12-01', note: 'на ремонт',
      closedAt: null, archivedAt: null, deletedAt: null, dirty: 1, serverSeq: null, deviceId: 'device-d-1', dirtyGroups: [],
    });
    expect(d.createdAt).toBe(d.clientUpdatedAt);
    expect(await store.db.debts.get(d.id)).toEqual(d);
  });

  it('срок и заметка необязательны', async () => {
    const store = await makeStore();
    expect(await store.debts.create(input)).toMatchObject({ dueOn: null, note: '' });
  });

  it.each([
    ['пустое имя', { counterparty: '  ' }, /Кто должен/],
    ['имя 81 символ', { counterparty: 'я'.repeat(81) }, /от 1 до 80/],
    ['сумма 0', { principalMinor: 0 }, /больше нуля/],
    ['сумма дробная', { principalMinor: 1.5 }, /целое/],
    ['сумма больше 1e15', { principalMinor: 1_000_000_000_000_001 }, /слишком велика/],
    ['направление', { direction: 'gift' }, /допустимо только lent, borrowed/],
    ['валюта', { currency: 'tjs' }, /код валюты/],
    ['дата 31 февраля', { openedOn: '2026-02-31' }, /настоящая дата/],
    ['дата вне 2000–2100', { openedOn: '1999-12-31' }, /допустимы даты/],
    ['срок раньше даты долга', { dueOn: '2026-09-30' }, /раньше/],
    ['срок не дата', { dueOn: 'завтра' }, /настоящая дата/],
    ['заметка 501 символ', { note: 'я'.repeat(501) }, /не длиннее 500/],
    ['NUL в имени', { counterparty: 'А\u0000ли' }, /нулевого символа/],
    ['обрезанный смайлик', { counterparty: 'Али\uD83D' }, /Некорректный символ/],
    ['лишнее поле', { closedAt: '2026-10-01T00:00:00.000Z' }, /менять нельзя/],
  ])('отвергает: %s', async (_n, bad, re) => {
    const store = await makeStore();
    await expect(store.debts.create({ ...input, ...bad } as never)).rejects.toThrow(re);
    expect(await store.db.debts.count()).toBe(0);
  });

  it('граница суммы 1e15 и имя 80 символов принимаются', async () => {
    const store = await makeStore();
    const d = await store.debts.create({ ...input, principalMinor: 1_000_000_000_000_000, counterparty: 'я'.repeat(80) });
    expect(d.principalMinor).toBe(1_000_000_000_000_000);
  });

  it('явный id: повтор — ошибка, не дубль', async () => {
    const store = await makeStore();
    await store.debts.create(input, { id: 'debt-1' });
    await expect(store.debts.create(input, { id: 'debt-1' })).rejects.toThrow(/уже существует/);
    expect(await store.db.debts.count()).toBe(1);
  });
});

describe('DebtsRepo.update / close / reopen / archive / restore', () => {
  it('update: меняет поля, пустая правка не пишет, dirtyGroups по смыслу', async () => {
    const store = await makeStore();
    const d = await store.debts.create(input);
    const same = await store.debts.update(d.id, { counterparty: 'Али' });
    expect(same.clientUpdatedAt).toBe(d.clientUpdatedAt);
    const u = await store.debts.update(d.id, { counterparty: 'Вали', note: 'новое', principalMinor: 90_000 });
    expect(u).toMatchObject({ counterparty: 'Вали', note: 'новое', principalMinor: 90_000 });
    expect(u.dirtyGroups).toEqual(['party', 'amount', 'note']);
    await expect(store.debts.update(d.id, { dueOn: '2020-01-01' })).rejects.toThrow(/раньше/);
    await expect(store.debts.update(d.id, { id: 'x' } as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(store.debts.update('нет', { note: 'x' })).rejects.toThrow(/не найден/);
  });

  it('close/reopen: закрытие метит время, не трогает остальное; повтор безопасен', async () => {
    const store = await makeStore();
    const d = await store.debts.create(input);
    const c = await store.debts.close(d.id);
    expect(c.closedAt).not.toBeNull();
    expect(c.dirtyGroups).toEqual(['closed']);
    expect((await store.debts.close(d.id)).clientUpdatedAt).toBe(c.clientUpdatedAt);
    const r = await store.debts.reopen(d.id);
    expect(r.closedAt).toBeNull();
    expect((await store.debts.reopen(d.id)).clientUpdatedAt).toBe(r.clientUpdatedAt);
  });

  it('archive/restore независимы от close', async () => {
    const store = await makeStore();
    const d = await store.debts.create(input);
    await store.debts.close(d.id);
    const a = await store.debts.archive(d.id);
    expect(a.archivedAt).not.toBeNull();
    expect(a.closedAt).not.toBeNull();
    const r = await store.debts.restore(d.id);
    expect(r).toMatchObject({ archivedAt: null });
    expect(r.closedAt).not.toBeNull();
  });

  it('направление и валюту нельзя менять, когда есть операции (даже удалённые) или регулярные платежи', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const d = await store.debts.create(input);
    // без операций — можно
    expect((await store.debts.update(d.id, { currency: 'USD' })).currency).toBe('USD');
    await store.debts.update(d.id, { currency: 'TJS' });
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', debtId: d.id });
    await expect(store.debts.update(d.id, { currency: 'USD' })).rejects.toThrow(/по нему уже есть операции/);
    await expect(store.debts.update(d.id, { direction: 'borrowed' })).rejects.toThrow(/по нему уже есть операции/);
    await store.transactions.softDelete(t.id);
    await expect(store.debts.update(d.id, { direction: 'borrowed' })).rejects.toThrow(/по нему уже есть операции/);
    // сумма и имя при этом меняются свободно
    expect((await store.debts.update(d.id, { principalMinor: 5 })).principalMinor).toBe(5);
    // регулярный платёж тоже закрепляет
    const d2 = await store.debts.create(input);
    await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 100, frequency: 'monthly', startOn: '2026-10-01', debtId: d2.id });
    await expect(store.debts.update(d2.id, { currency: 'USD' })).rejects.toThrow(/по нему уже есть операции/);
  });
});

describe('операции с debtId', () => {
  it('создаются только для расхода/дохода; долг жив; валюта кошелька = валюте долга', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const d = await store.debts.create(input);
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100_000, occurredOn: '2026-10-01', debtId: d.id });
    expect(t).toMatchObject({ debtId: d.id, recurringRuleId: null });
    const pay = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 40_000, occurredOn: '2026-10-09', debtId: d.id });
    expect(pay.debtId).toBe(d.id);

    await expect(store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 100, toAmountMinor: 10, occurredOn: '2026-10-01', debtId: d.id })).rejects.toThrow(/не бывает долга/);
    await expect(store.transactions.create({ kind: 'expense', walletId: usd.id, amountMinor: 100, occurredOn: '2026-10-01', debtId: d.id, fx: { rate: 10, source: 'manual' } })).rejects.toThrow(/не совпадает с валютой долга/);
    await expect(store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-01', debtId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' })).rejects.toThrow(/Долг не найден/);
    expect(await store.db.transactions.count()).toBe(2);
  });

  it('долг в архиве выбрать заново нельзя, прежний выбор остаётся; закрытый долг выбрать можно', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const d = await store.debts.create(input);
    const t = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-01', debtId: d.id });
    await store.debts.close(d.id);
    expect((await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-02', debtId: d.id })).debtId).toBe(d.id);
    await store.debts.archive(d.id);
    await expect(store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-03', debtId: d.id })).rejects.toThrow(/в архиве/);
    // правка заметки уже привязанной операции не упирается в архив долга
    expect((await store.transactions.update(t.id, { note: 'вернул' })).note).toBe('вернул');
  });

  it('update: привязать к долгу, отвязать; нельзя сменить кошелёк на кошелёк другой валюты; перевод без долга', async () => {
    const store = await makeStore();
    const { cash, usd } = await basics(store);
    const d = await store.debts.create(input);
    const t = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 500, occurredOn: '2026-10-01' });
    const linked = await store.transactions.update(t.id, { debtId: d.id });
    expect(linked.debtId).toBe(d.id);
    expect(linked.dirtyGroups).toContain('money');
    await expect(store.transactions.update(t.id, { walletId: usd.id, fx: { rate: 10, source: 'manual' } })).rejects.toThrow(/не совпадает с валютой долга/);
    expect((await store.transactions.update(t.id, { debtId: null })).debtId).toBeNull();
    await store.transactions.update(t.id, { debtId: d.id });
    // смена вида на перевод сбрасывает долг сама
    const tr = await store.transactions.update(t.id, { kind: 'transfer', toWalletId: (await store.wallets.create({ name: 'Вторая', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#000000', icon: 'x' })).id });
    expect(tr).toMatchObject({ kind: 'transfer', debtId: null });
  });

  it('restore операции с удалённым долгом отказывает', async () => {
    const store = await makeStore();
    const { cash } = await basics(store);
    const d = await store.debts.create(input);
    const t = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 100, occurredOn: '2026-10-01', debtId: d.id });
    await store.transactions.softDelete(t.id);
    await store.db.debts.put({ ...d, deletedAt: '2026-10-10T00:00:00.000Z' });
    await expect(store.transactions.restore(t.id)).rejects.toThrow(/Долг этой операции удалён/);
  });

  it('операция по долгу не входит в итоги месяца, но меняет остаток кошелька', async () => {
    const store = await makeStore();
    const { cash, food } = await basics(store);
    const d = await store.debts.create(input);
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 30_000, occurredOn: '2026-10-02', debtId: d.id });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1_000, occurredOn: '2026-10-03', categoryId: food.id });
    const { summarizeMonth } = await import('@/db');
    const s = summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS');
    expect(s).toMatchObject({ expenseMinor: 1_000, incomeMinor: 0, debtOutMinor: 30_000, debtInMinor: 0, debtFlowMinor: -30_000 });
    const { computeBalances } = await import('@/domain/balances');
    expect(computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id)).toBe(100_000 - 30_000 - 1_000);
  });
});
