import { describe, expect, it } from 'vitest';
import { computeBalances } from '@/domain/balances';
import { computeDebtState } from '@/domain/debts';
import { summarizeMonth, ValidationError, type Store } from '@/db';
import { basics, makeStore } from './helpers';

const base = { direction: 'lent', counterparty: 'Али', currency: 'TJS' } as const;

/**
 * Два долга Али («мне должны») с РАЗНЫМИ условиями: у первого 400 с процентами 24 % на 12 месяцев, выдачей и платежом 100;
 * у второго 300 без процентов, с выдачей, удалённым платежом и регулярным платежом.
 */
async function setup() {
  const store = await makeStore();
  const { cash, usd } = await basics(store);
  const d1 = await store.debts.create({
    ...base, principalMinor: 40_000, interestMinor: 5_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-05', dueOn: '2026-11-20', note: 'на ремонт',
  });
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
  const link = async (id: string) => (await store.db.debts.get(id))!.mergedIntoId;
  return { store, cash, usd, d1, d2, issue1, pay1, issue2, pay2, rule, balance, state, link };
}

const snapshot = async (store: Store) =>
  JSON.stringify([await store.db.debts.toArray(), await store.db.transactions.toArray(), await store.db.recurring_rules.toArray()]);

describe('DebtsRepo.merge: объединение долгов (составляющие, а не склейка)', () => {
  it('источник входит в состав главного долга; у каждого остаются свои сумма, проценты, ставка, срок, даты и заметка', async () => {
    const { store, d1, d2, link } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    expect(res).toEqual({ targetId: d1.id, links: [{ id: d2.id, from: null }] });
    expect(await link(d2.id)).toBe(d1.id);
    expect(await link(d1.id)).toBeNull();
    expect(await store.db.debts.get(d2.id)).toMatchObject({
      principalMinor: 30_000, interestMinor: null, interestRateBp: null, termMonths: null, openedOn: '2026-10-01', dueOn: '2026-11-10', note: 'на учёбу',
      deletedAt: null, closedAt: null, dirty: 1,
    });
    expect(await store.db.debts.get(d1.id)).toMatchObject({
      principalMinor: 40_000, interestMinor: 5_000, interestRateBp: 2400, termMonths: 12, openedOn: '2026-10-05', dueOn: '2026-11-20', note: 'на ремонт', deletedAt: null,
    });
  });

  it('операции и регулярные платежи остаются при своих долгах (ничего не переезжает), в том числе удалённая операция', async () => {
    const { store, d1, d2, issue1, pay1, issue2, pay2, rule } = await setup();
    await store.debts.merge(d1.id, [d2.id]);
    for (const [t, debtId] of [[issue1, d1.id], [pay1, d1.id], [issue2, d2.id], [pay2, d2.id]] as const) {
      expect(await store.db.transactions.get(t.id)).toMatchObject({ debtId });
    }
    expect(await store.db.transactions.get(pay2.id)).toMatchObject({ deletedAt: expect.any(String) }); // осталась удалённой
    expect(await store.db.recurring_rules.get(rule.id)).toMatchObject({ debtId: d2.id, deletedAt: null });
  });

  it('деньги в кошельках не двигаются, в доходы и расходы месяца ничего не попадает, остаток каждой части свой', async () => {
    const { store, d1, d2, balance, state } = await setup();
    const before = await balance();
    await store.debts.merge(d1.id, [d2.id]);
    expect(await balance()).toEqual(before);
    expect(summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS')).toMatchObject({ expenseMinor: 0, incomeMinor: 0 });
    // у первого сумма 400 + проценты 50 − платёж 100 = 350; у второго 300 − 0 (платёж удалён) = 300
    expect(await state(d1.id)).toMatchObject({ principalMinor: 40_000, interestMinor: 5_000, paidMinor: 10_000, remainingMinor: 35_000, issues: [] });
    expect(await state(d2.id)).toMatchObject({ principalMinor: 30_000, interestMinor: 0, paidMinor: 0, remainingMinor: 30_000, issues: [] });
  });

  it('объединяет сразу несколько долгов', async () => {
    const { store, d1, d2, link } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    const res = await store.debts.merge(d1.id, [d2.id, d3.id]);
    expect(res.links.map((l) => l.id).sort()).toEqual([d2.id, d3.id].sort());
    expect(await link(d2.id)).toBe(d1.id);
    expect(await link(d3.id)).toBe(d1.id);
  });

  it('повтор источника в списке ничего не удваивает; повторное объединение не меняет и не пачкает строки', async () => {
    const { store, d1, d2 } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id, d2.id]);
    expect(res.links).toEqual([{ id: d2.id, from: null }]);
    const snap = await snapshot(store);
    expect((await store.debts.merge(d1.id, [d2.id])).links).toEqual([]);
    expect(await snapshot(store)).toBe(snap);
  });

  it('закрытые долги входят в состав, как есть: закрытость остаётся у каждой части', async () => {
    const { store, d1, d2 } = await setup();
    await store.debts.close(d2.id);
    await store.debts.merge(d1.id, [d2.id]);
    expect((await store.db.debts.get(d1.id))!.closedAt).toBeNull();
    expect((await store.db.debts.get(d2.id))!.closedAt).not.toBeNull();
  });

  it('объединение ничего не пишет в основной долг: он не помечается изменённым из-за составляющих', async () => {
    const { store, d1, d2 } = await setup();
    const before = await store.db.debts.get(d1.id);
    await store.debts.merge(d1.id, [d2.id]);
    expect(await store.db.debts.get(d1.id)).toEqual(before);
  });

  describe('главный долг объединения', () => {
    it('присоединяемый долг приводит с собой свои составляющие: вложенности нет', async () => {
      const { store, d1, d2, link } = await setup();
      const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
      await store.debts.merge(d1.id, [d2.id]); // d1 — главный, d2 — составляющая
      const res = await store.debts.merge(d3.id, [d1.id]); // d1 переходит в состав d3 вместе с d2
      expect(res.links.map((l) => l.id).sort()).toEqual([d1.id, d2.id].sort());
      expect(await link(d1.id)).toBe(d3.id);
      expect(await link(d2.id)).toBe(d3.id);
      expect(await link(d3.id)).toBeNull();
    });

    it('составляющую нельзя сделать главным: понятная ошибка, ничего не меняется', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.merge(d1.id, [d2.id]);
      const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
      const snap = await snapshot(store);
      await expect(store.debts.merge(d2.id, [d3.id])).rejects.toThrow(/уже входит в состав долга «Али»/);
      expect(await snapshot(store)).toBe(snap);
    });

    it('составляющую чужого состава нельзя взять в свой: сначала вывести из прежнего', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.merge(d1.id, [d2.id]);
      const other = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
      const snap = await snapshot(store);
      await expect(store.debts.merge(other.id, [d2.id])).rejects.toThrow(/сначала выведите его из объединения/);
      expect(await snapshot(store)).toBe(snap);
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

    it('пустой список, долг с самим собой, неизвестный id — отказ, ничего не меняется', async () => {
      const { store, d1 } = await setup();
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [])).rejects.toThrow(ValidationError);
      await expect(store.debts.merge(d1.id, [d1.id])).rejects.toThrow(/с самим собой/);
      await expect(store.debts.merge(d1.id, ['00000000-0000-4000-8000-000000000000'])).rejects.toThrow(/не найден/);
      expect(await snapshot(store)).toBe(snap);
    });

    it('удалённый долг', async () => {
      const { store, d1, d2 } = await setup();
      await store.debts.softDelete(d2.id, 'keep-operations');
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [d2.id])).rejects.toThrow(/удалён/);
      expect(await snapshot(store)).toBe(snap);
    });

    it('одна плохая строка в списке отменяет всё: остальные источники не входят в состав', async () => {
      const { store, d1, d2 } = await setup();
      const usd = await store.debts.create({ ...base, currency: 'USD', principalMinor: 100, openedOn: '2026-10-02' });
      const snap = await snapshot(store);
      await expect(store.debts.merge(d1.id, [d2.id, usd.id])).rejects.toThrow(ValidationError);
      expect(await snapshot(store)).toBe(snap);
    });
  });

  it('нельзя менять валюту или направление долга, который объединён с другими', async () => {
    const { store, d1, d2 } = await setup();
    const free = await store.debts.create({ ...base, principalMinor: 100, openedOn: '2026-10-02' });
    const part = await store.debts.create({ ...base, principalMinor: 50, openedOn: '2026-10-03' }); // без операций
    await store.debts.merge(free.id, [part.id, d2.id]);
    await expect(store.debts.update(free.id, { currency: 'USD' })).rejects.toThrow(/объединён с другими/);
    await expect(store.debts.update(part.id, { direction: 'borrowed' })).rejects.toThrow(/объединён с другими/);
    // у долга с операциями прежнее правило про операции остаётся в силе
    await expect(store.debts.update(d2.id, { direction: 'borrowed' })).rejects.toThrow(/по нему уже есть операции/);
    // другие поля правятся как обычно, и связь при правке не слетает
    await store.debts.update(part.id, { note: 'изменено', interestMinor: 700, interestRateBp: 1200, termMonths: 6 });
    expect(await store.db.debts.get(part.id)).toMatchObject({ mergedIntoId: free.id, note: 'изменено', interestMinor: 700 });
    expect(d1.id).not.toBe(free.id);
  });
});

describe('DebtsRepo.undoMerge', () => {
  it('возвращает каждого туда, где он был; платежи и суммы не трогает', async () => {
    const { store, d1, d2, link, state } = await setup();
    const before = await state(d2.id);
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.undoMerge(res);
    expect(await link(d2.id)).toBeNull();
    expect(await state(d2.id)).toEqual(before);
  });

  it('вместе с составляющими присоединённого главного долга: все возвращаются на прежние места', async () => {
    const { store, d1, d2, link } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(d1.id, [d2.id]);
    const res = await store.debts.merge(d3.id, [d1.id]);
    await store.debts.undoMerge(res);
    expect(await link(d1.id)).toBeNull();
    expect(await link(d2.id)).toBe(d1.id); // d2 снова при d1
  });

  it('долг успели править — отмена всё равно проходит: связь возвращается, правки остаются', async () => {
    const { store, d1, d2, link } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.update(d2.id, { note: 'поправили после объединения' });
    await store.debts.undoMerge(res);
    expect(await link(d2.id)).toBeNull();
    expect((await store.db.debts.get(d2.id))!.note).toBe('поправили после объединения');
  });

  it('кого с тех пор перенесли в другой состав, отмена не трогает; повтор безопасен', async () => {
    const { store, d1, d2, link } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.unmerge(d2.id);
    const other = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(other.id, [d2.id]);
    await store.debts.undoMerge(res);
    expect(await link(d2.id)).toBe(other.id);
    await store.debts.undoMerge(res); // повтор
    expect(await link(d2.id)).toBe(other.id);
  });

  it('главный долг удалён — отменять нечего, ошибки нет, составляющая не получает ссылку на удалённый долг', async () => {
    const { store, d1, d2, link } = await setup();
    const res = await store.debts.merge(d1.id, [d2.id]);
    await store.debts.softDelete(d1.id, 'keep-operations'); // составляющая выходит из состава сама
    await expect(store.debts.undoMerge(res)).resolves.toBeTruthy();
    expect(await link(d2.id)).toBeNull();
  });
});

describe('DebtsRepo.unmerge: выход из объединения', () => {
  it('составляющая выходит одна и становится отдельным долгом; остальные остаются', async () => {
    const { store, d1, d2, link } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(d1.id, [d2.id, d3.id]);
    const res = await store.debts.unmerge(d2.id);
    expect(res).toEqual({ targetId: d1.id, partIds: [d2.id] });
    expect(await link(d2.id)).toBeNull();
    expect(await link(d3.id)).toBe(d1.id);
  });

  it('у главного долга выходят все составляющие', async () => {
    const { store, d1, d2, link } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(d1.id, [d2.id, d3.id]);
    const res = await store.debts.unmerge(d1.id);
    expect(res.targetId).toBe(d1.id);
    expect(res.partIds.sort()).toEqual([d2.id, d3.id].sort());
    expect(await link(d2.id)).toBeNull();
    expect(await link(d3.id)).toBeNull();
  });

  it('долг сам по себе — ничего не меняет; повторное объединение тем же списком возвращает всё как было', async () => {
    const { store, d1, d2, link } = await setup();
    const snap = await snapshot(store);
    expect(await store.debts.unmerge(d1.id)).toEqual({ targetId: d1.id, partIds: [] });
    expect(await snapshot(store)).toBe(snap);
    await store.debts.merge(d1.id, [d2.id]);
    const res = await store.debts.unmerge(d1.id);
    await store.debts.merge(res.targetId, res.partIds);
    expect(await link(d2.id)).toBe(d1.id);
  });
});

describe('объединение целиком: закрыть, архивировать, удалить', () => {
  it('архив и возврат с withParts касаются всех составляющих; без него — только долга', async () => {
    const { store, d1, d2 } = await setup();
    await store.debts.merge(d1.id, [d2.id]);
    await store.debts.archive(d1.id);
    expect((await store.db.debts.get(d1.id))!.archivedAt).not.toBeNull();
    expect((await store.db.debts.get(d2.id))!.archivedAt).toBeNull();
    await store.debts.restore(d1.id);
    await store.debts.archive(d1.id, { withParts: true });
    expect((await store.db.debts.get(d2.id))!.archivedAt).not.toBeNull();
    await store.debts.restore(d1.id, { withParts: true });
    expect((await store.db.debts.get(d1.id))!.archivedAt).toBeNull();
    expect((await store.db.debts.get(d2.id))!.archivedAt).toBeNull();
  });

  it('закрыть и открыть снова с withParts — всем составляющим сразу', async () => {
    const { store, d1, d2 } = await setup();
    await store.debts.merge(d1.id, [d2.id]);
    await store.debts.close(d1.id, { withParts: true });
    expect((await store.db.debts.get(d1.id))!.closedAt).not.toBeNull();
    expect((await store.db.debts.get(d2.id))!.closedAt).not.toBeNull();
    await store.debts.reopen(d1.id, { withParts: true });
    expect((await store.db.debts.get(d2.id))!.closedAt).toBeNull();
  });

  it('удаление главного долга: составляющие остаются отдельными долгами со своими платежами; отмена возвращает объединение', async () => {
    const { store, d1, d2, rule, link } = await setup();
    await store.debts.merge(d1.id, [d2.id]);
    const deletion = await store.debts.softDelete(d1.id, 'keep-operations');
    expect(deletion.unmergedIds).toEqual([d2.id]);
    expect(await link(d2.id)).toBeNull();
    expect((await store.db.debts.get(d2.id))!.deletedAt).toBeNull();
    expect(await store.db.recurring_rules.get(rule.id)).toMatchObject({ debtId: d2.id, archivedAt: null });
    await store.debts.undoDelete(deletion);
    expect(await link(d2.id)).toBe(d1.id);
  });

  it('удаление составляющей: главный долг и остальные не затронуты', async () => {
    const { store, d1, d2, link } = await setup();
    const d3 = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(d1.id, [d2.id, d3.id]);
    const deletion = await store.debts.softDelete(d2.id, 'keep-operations');
    expect(deletion.unmergedIds).toBeUndefined();
    expect(await link(d3.id)).toBe(d1.id);
    expect((await store.db.debts.get(d1.id))!.deletedAt).toBeNull();
  });

  it('отмена удаления не отнимает составляющую у нового состава, в который её успели включить', async () => {
    const { store, d1, d2, link } = await setup();
    await store.debts.merge(d1.id, [d2.id]);
    const deletion = await store.debts.softDelete(d1.id, 'keep-operations');
    const other = await store.debts.create({ ...base, principalMinor: 1_000, openedOn: '2026-10-12' });
    await store.debts.merge(other.id, [d2.id]);
    await store.debts.undoDelete(deletion);
    expect(await link(d2.id)).toBe(other.id);
  });
});
