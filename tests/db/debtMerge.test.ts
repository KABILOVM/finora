import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { summarizeMonth, ValidationError, type Store } from '@/db';
import { basics, makeStore } from './helpers';

const base = { direction: 'lent', counterparty: 'Али', currency: 'TJS' } as const;

/** Два долга Али («мне должны»): 400 с выдачей и платежом 100, и 300 с выдачей, удалённым платежом и регулярным платежом. */
async function setup() {
  const store = await makeStore();
  const { cash, usd } = await basics(store);
  const d1 = await store.debts.create({ ...base, principalMinor: 40_000, openedOn: '2026-10-05', dueOn: '2026-11-20', note: 'на ремонт' });
  const d2 = await store.debts.create({ ...base, principalMinor: 30_000, openedOn: '2026-10-01', dueOn: '2026-11-10', note: 'на учёбу' });
  const issue1 = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 40_000, occurredOn: '2026-10-05', debtId: d1.id });
  const pay1 = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 10_000, occurredOn: '2026-10-08', debtId: d1.id });
  const issue2 = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 30_000, occurredOn: '2026-10-01', debtId: d2.id });
  const pay2 = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 5_000, occurredOn: '2026-10-09', debtId: d2.id });
  await store.transactions.softDelete(pay2.id);
  const rule = await store.recurring.create({ kind: 'income', walletId: cash.id, amountMinor: 5_000, frequency: 'monthly', startOn: '2026-11-01', debtId: d2.id });
  const balance = async () => computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray()).get(cash.id);
  const state = async (id: string) => {
    const d = (await store.db.debts.get(id))!;
    return computeDebtState(d, await store.db.transactions.toArray(), await store.db.wallets.toArray());
  };
  return { store, cash, usd, d1, d2, issue1, pay1, issue2, pay2, rule, balance, state };
}

const snapshot = async (store: Store) =>
  JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray(), await store.db.recurring_rules.toArray()]);

describe('DebtsRepo.merge: объединение долгов', () => {
  it('всё собирается в один долг: сумма, самая ранняя дата, ближайший срок, склеенные заметки', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    expect(res).toMatchObject({ targetId: d1.id, sourceIds: [d2.id] });
    expect(await store.db.debts.get(d1.id)).toMatchObject({
      principalMinor: 70_000,
      openedOn: '2026-10-01',
      dueOn: '2026-11-10',
      note: 'на ремонт\nна учёбу',
      closedAt: null,
      deletedAt: null,
      dirty: 1,
    });
    expect(await store.db.debts.get(d2.id)).toMatchObject({ deletedAt: expect.any(String), dirty: 1 });
  });

  it('операции источника, в том числе удалённая, и регулярный платёж переходят к общему долгу', async () => {
    const { store, d1, d2, issue2, pay2, rule } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    expect(res.txs.map((t) => t.id).sort()).toEqual([issue2.id, pay2.id].sort());
    expect(res.txs.every((t) => t.from === d2.id)).toBe(true);
    expect(res.rules).toEqual([{ id: rule.id, from: d2.id }]);
    for (const t of [issue2, pay2]) expect(await store.db.transactions.get(t.id)).toMatchObject({ debtId: d1.id, dirty: 1 });
    expect(await store.db.transactions.get(pay2.id)).toMatchObject({ deletedAt: expect.any(String) }); // осталась удалённой
    expect(await store.db.recurring_rules.get(rule.id)).toMatchObject({ debtId: d1.id, deletedAt: null });
  });

  it('деньги в кошельках не двигаются, в доходы и расходы месяца ничего не попадает, остаток общий', async () => {
    const { store, d1, d2, balance, state } = await setup();
    const before = await balance();
    await store.debts.merge(d1.id, [d2.id]);
    expect(await balance()).toEqual(before);
    expect(summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS')).toMatchObject({ expenseMinor: 0, incomeMinor: 0 });
    // сумма 700, выдано 700, оплачено 100 (удалённый платёж 50 не считается): осталось 600
    expect(await state(d1.id)).toMatchObject({ principalMinor: 70_000, issuedMinor: 70_000, paidMinor: 10_000, remainingMinor: 60_000, issues: [] });
  });

  it('объединяет сразу несколько долгов', async () => {
    const { store, d1, d2 } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(d1.id, [d2.id, d3.id]);
    expect((await store.db.debts.get(d1.id))!.principalMinor).toBe(71_000);
    for (const d of [d2, d3]) expect((await store.db.debts.get(d.id))!.deletedAt).not.toBeNull();
  });

  it('повтор источника в списке не удваивает сумму', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id, d2.id]);
    expect(res.sourceIds).toEqual([d2.id]);
    expect((await store.db.debts.get(d1.id))!.principalMinor).toBe(70_000);
  });

  it('сроков нет ни у кого — срока нет и у общего долга; срок только у одного — он и остаётся', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...base, principalMinor: 200, openedOn: '2026-10-02' });
    expect((await store.debts.merge(a.id, [b.id])).after.dueOn).toBeNull();
    const c = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01' });
    const d = await store.debts.create({ ...base, principalMinor: 200, openedOn: '2026-10-02', dueOn: '2026-12-01' });
    expect((await store.debts.merge(c.id, [d.id])).after.dueOn).toBe('2026-12-01');
  });

  describe('закрытые долги', () => {
    it('открыт хоть один — общий долг открыт', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.close(d1.id);
      await store.debts.merge(d1.id, [d2.id]);
      expect((await store.db.debts.get(d1.id))!.closedAt).toBeNull();
    });

    it('все закрыты — общий остаётся закрытым', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.close(d1.id);
      await store.debts.close(d2.id);
      await store.debts.merge(d1.id, [d2.id]);
      expect((await store.db.debts.get(d1.id))!.closedAt).not.toBeNull();
    });
  });

  describe('что объединять нельзя (и тогда не меняется ничего)', () => {
    it('другое направление', async () => {
      const { store, d1 } = await setup();
      const other = await store.debts.create({ ...base, direction: 'borrowed', principalMinor: 100, openedOn: '2026-10-02' });
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [other.id])).rejects.toThrow(/одного направления и одной валюты/);
      expect(await snapshot(store)).toBe(snap);
    });

    it('другая валюта', async () => {
      const { store, d1 } = await setup();
      const usd = await store.debts.create({ ...base, currency: 'USD', principalMinor: 100, openedOn: '2026-10-02' });
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [usd.id])).rejects.toThrow(/одного направления и одной валюты/);
      expect(await snapshot(store)).toBe(snap);
    });

    it('долг в архиве (и источник, и основной)', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.archive(d2.id);
      await expect(store.debts.merge(d1.id, [d2.id])).rejects.toThrow(/в архиве/);
      await store.debts.restore(d2.id);
      await store.debts.archive(d1.id);
      await expect(store.debts.merge(d1.id, [d2.id])).rejects.toThrow(/в архиве/);
    });

    it('сам с собой и пустой список', async () => {
      const { store, d1 } = await setup();
      await expect(store.debts.merge(d1.id, [d1.id])).rejects.toThrow(/с самим собой/);
      await expect(store.debts.merge(d1.id, [])).rejects.toThrow(/Выберите долги/);
    });

    it('удалённый и неизвестный долг', async () => {
      const { store, d1, d2 } = await setup();
      await expect(store.debts.merge(d1.id, ['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'])).rejects.toThrow(/Долг не найден/);
      await store.debts.softDelete(d2.id, 'keep-operations');
      await expect(store.debts.merge(d1.id, [d2.id])).rejects.toThrow(/удалён/);
    });

    it('сумма не помещается в предел сервера: ошибка и ни одна строка не изменена (всё или ничего)', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.increase(d1.id, 1_000_000_000_000_000 - 40_000);
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [d2.id])).rejects.toThrow(ValidationError);
      expect(await snapshot(store)).toBe(snap);
    });
  });

  it('очень длинные заметки обрезаются до предела с «…», а объединение проходит', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: 'а'.repeat(400) });
    const b = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: 'б'.repeat(400) });
    const res = await store.debts.merge(a.id, [b.id]);
    expect(res.after.note.length).toBeLessThanOrEqual(500);
    expect(res.after.note.endsWith('…')).toBe(true);
    expect(res.after.note.startsWith('а'.repeat(400))).toBe(true);
  });

  it('обрезка не разрывает смайлик пополам', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: 'а'.repeat(497) });
    const b = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: '😀😀' });
    // 497 знаков + «\n» + смайлик (2 знака): обрезка до 499 знаков оставила бы «голову» смайлика последней — её нужно убрать целиком
    const res = await store.debts.merge(a.id, [b.id]);
    expect(res.after.note.length).toBeLessThanOrEqual(500);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(res.after.note)).toBe(false);
    expect(res.after.note).toBe(`${'а'.repeat(497)}…`);
  });

  it('одинаковые заметки не дублируются', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: 'аванс' });
    const b = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-01', note: ' аванс ' });
    expect((await store.debts.merge(a.id, [b.id])).after.note).toBe('аванс');
  });
});

describe('DebtsRepo.undoMerge', () => {
  it('возвращает долги, операции и правила как были', async () => {
    const { store, d1, d2, issue2, pay2, rule, state } = await setup();
    const before = await snapshot(store);
    const stateBefore = [await state(d1.id), await state(d2.id)];
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.undoMerge(res);
    expect(await store.db.debts.get(d1.id)).toMatchObject({ principalMinor: 40_000, openedOn: '2026-10-05', dueOn: '2026-11-20', note: 'на ремонт' });
    expect((await store.db.debts.get(d2.id))!.deletedAt).toBeNull();
    for (const t of [issue2, pay2]) expect((await store.db.transactions.get(t.id))!.debtId).toBe(d2.id);
    expect((await store.db.recurring_rules.get(rule.id))!.debtId).toBe(d2.id);
    expect([await state(d1.id), await state(d2.id)]).toEqual(stateBefore);
    // по содержимому всё как до (служебные метки правок, конечно, новые)
    const strip = (s: string) => s.replace(/"(clientUpdatedAt|dirtyGroups|dirtyBase|dirty)":(\[[^\]]*\]|\{[^}]*\}|"[^"]*"|\d+|null),?/g, '');
    expect(strip(await snapshot(store))).toBe(strip(before));
  });

  it('повтор безопасен', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.undoMerge(res);
    const snap = await snapshot(store);
    await store.debts.undoMerge(res);
    expect(await snapshot(store)).toBe(snap);
  });

  it('долг успели изменить — отмена отказывает и ничего не трогает', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.update(d1.id, { note: 'новая заметка' });
    const snap = await snapshot(store);
    await expect(store.debts.undoMerge(res)).rejects.toThrow(/уже изменили/);
    expect(await snapshot(store)).toBe(snap);
  });

  it('платёж, добавленный после объединения, остаётся у общего долга; перепривязанную другим долгом операцию не трогает', async () => {
    const { store, cash, d1, d2, issue2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    const late = await store.transactions.create({ kind: 'income', walletId: cash.id, amountMinor: 1_000, occurredOn: '2026-10-20', debtId: d1.id });
    const other = await store.debts.create({ ...base, principalMinor: 5_000, openedOn: '2026-10-02' });
    await store.transactions.update(issue2.id, { debtId: other.id });
    await store.debts.undoMerge(res);
    expect((await store.db.transactions.get(late.id))!.debtId).toBe(d1.id);
    expect((await store.db.transactions.get(issue2.id))!.debtId).toBe(other.id);
  });

  it('общий долг удалён — отменить нельзя, понятная ошибка', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.softDelete(d1.id, 'keep-operations');
    await expect(store.debts.undoMerge(res)).rejects.toThrow(/удалён/);
  });
});

describe('DebtsRepo.merge: с кем объединён (другое имя в заметке)', () => {
  it('другое имя — строка «Объединён с: Бобур (от 05.03.2026)» сразу после своей заметки, перед заметками источников', async () => {
    const { store, d1 } = await setup();
    const bobur = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 10_000, openedOn: '2026-03-05', note: 'за телефон' });
    const res = await store.debts.merge(d1.id, [bobur.id]);
    expect(res.after.note).toBe('на ремонт\nОбъединён с: Бобур (от 05.03.2026)\nза телефон');
    expect((await store.db.debts.get(d1.id))!.note).toBe('на ремонт\nОбъединён с: Бобур (от 05.03.2026)\nза телефон');
    expect(res.after.counterparty).toBe('Али'); // имя основного долга остаётся
  });

  it('тот же человек (регистр, лишние пробелы, ё/е) — строки «Объединён с» нет', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, counterparty: 'Алишер', principalMinor: 100, openedOn: '2026-10-01', note: 'первый' });
    const b = await store.debts.create({ ...base, counterparty: '  АЛИШЁР ', principalMinor: 200, openedOn: '2026-03-05', note: 'второй' });
    const res = await store.debts.merge(a.id, [b.id]);
    expect(res.after.note).toBe('первый\nвторой');
    expect(res.after.note).not.toContain('Объединён с');
  });

  it('без заметок у всех — в заметке только строка про другое имя; одноимённый источник строки не добавляет', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, counterparty: 'Алишер', principalMinor: 100, openedOn: '2026-10-01' });
    const same = await store.debts.create({ ...base, counterparty: 'алишер', principalMinor: 100, openedOn: '2026-10-02' });
    const other = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 100, openedOn: '2026-03-05' });
    const res = await store.debts.merge(a.id, [same.id, other.id]);
    expect(res.after.note).toBe('Объединён с: Бобур (от 05.03.2026)');
  });

  it('несколько других имён — по строке на каждый долг в порядке выбора, совпадающие строки не дублируются', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, counterparty: 'Алишер', principalMinor: 100, openedOn: '2026-10-01' });
    const vali = await store.debts.create({ ...base, counterparty: 'Вали', principalMinor: 100, openedOn: '2026-09-15', note: 'на свадьбу' });
    const b1 = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 100, openedOn: '2026-03-05' });
    const b2 = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 100, openedOn: '2026-03-05' });
    const b3 = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 100, openedOn: '2026-04-10' });
    const res = await store.debts.merge(a.id, [vali.id, b1.id, b2.id, b3.id]);
    expect(res.after.note).toBe(
      ['Объединён с: Вали (от 15.09.2026)', 'Объединён с: Бобур (от 05.03.2026)', 'Объединён с: Бобур (от 10.04.2026)', 'на свадьбу'].join('\n'),
    );
    expect(res.after.principalMinor).toBe(500);
  });

  it('длинные заметки: строка «Объединён с» стоит сразу после заметки основного и при обрезке не теряется', async () => {
    const { store } = await setup();
    const a = await store.debts.create({ ...base, counterparty: 'Алишер', principalMinor: 100, openedOn: '2026-10-01', note: 'а'.repeat(400) });
    const b = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 100, openedOn: '2026-03-05', note: 'б'.repeat(400) });
    const res = await store.debts.merge(a.id, [b.id]);
    expect(res.after.note.length).toBeLessThanOrEqual(500);
    expect(res.after.note.startsWith(`${'а'.repeat(400)}\nОбъединён с: Бобур (от 05.03.2026)\nб`)).toBe(true);
    expect(res.after.note.endsWith('…')).toBe(true);
  });

  it('отмена объединения возвращает прежнюю заметку основного долга, без строки «Объединён с»', async () => {
    const { store, d1 } = await setup();
    const bobur = await store.debts.create({ ...base, counterparty: 'Бобур', principalMinor: 10_000, openedOn: '2026-03-05', note: 'за телефон' });
    const res = await store.debts.merge(d1.id, [bobur.id]);
    await store.debts.undoMerge(res);
    expect(await store.db.debts.get(d1.id)).toMatchObject({ note: 'на ремонт', counterparty: 'Али', principalMinor: 40_000, openedOn: '2026-10-05' });
    expect(await store.db.debts.get(bobur.id)).toMatchObject({ note: 'за телефон', counterparty: 'Бобур', deletedAt: null });
  });
});


describe('DebtsRepo.merge: проценты', () => {
  const bank = { direction: 'borrowed', counterparty: 'Банк', currency: 'TJS' } as const;

  it('суммы процентов складываются; ставка и срок остаются, только если у всех долгов они одинаковые', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...bank, principalMinor: 100_000, interestMinor: 10_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...bank, principalMinor: 200_000, interestMinor: 30_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-02' });
    await store.debts.merge(a.id, [b.id]);
    expect(await store.db.debts.get(a.id)).toMatchObject({ principalMinor: 300_000, interestMinor: 40_000, interestRateBp: 2400, termMonths: 12 });
  });

  it('разные ставки или срок — остаётся сумма процентов без ставки и срока', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...bank, principalMinor: 100_000, interestMinor: 10_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...bank, principalMinor: 200_000, interestMinor: 30_000, interestRateBp: 1800, termMonths: 12, openedOn: '2026-10-02' });
    await store.debts.merge(a.id, [b.id]);
    expect(await store.db.debts.get(a.id)).toMatchObject({ interestMinor: 40_000, interestRateBp: null, termMonths: null });
  });

  it('долг без процентов в паре: проценты не «растекаются» на его сумму — ставка и срок убираются', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...bank, principalMinor: 100_000, interestMinor: 10_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...bank, principalMinor: 50_000, openedOn: '2026-10-02' });
    await store.debts.merge(a.id, [b.id]);
    expect(await store.db.debts.get(a.id)).toMatchObject({ principalMinor: 150_000, interestMinor: 10_000, interestRateBp: null, termMonths: null });
  });

  it('ни у кого нет процентов — их нет и после объединения', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...bank, principalMinor: 100_000, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...bank, principalMinor: 50_000, openedOn: '2026-10-02' });
    await store.debts.merge(a.id, [b.id]);
    expect(await store.db.debts.get(a.id)).toMatchObject({ interestMinor: null, interestRateBp: null, termMonths: null });
  });

  it('отмена объединения возвращает проценты как были', async () => {
    const store = await makeStore();
    const a = await store.debts.create({ ...bank, principalMinor: 100_000, interestMinor: 10_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-01' });
    const b = await store.debts.create({ ...bank, principalMinor: 200_000, interestMinor: 30_000, interestRateBp: 1800, termMonths: 6, openedOn: '2026-10-02' });
    const merged = await store.debts.merge(a.id, [b.id]);
    await store.debts.undoMerge(merged);
    expect(await store.db.debts.get(a.id)).toMatchObject({ principalMinor: 100_000, interestMinor: 10_000, interestRateBp: 2400, termMonths: 12 });
    expect(await store.db.debts.get(b.id)).toMatchObject({ deletedAt: null, interestMinor: 30_000, interestRateBp: 1800, termMonths: 6 });
  });
});
