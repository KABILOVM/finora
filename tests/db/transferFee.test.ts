import { describe, expect, it } from 'vitest';
import { FxRequiredError, summarizeMonth } from '@/db';
import { basics, makeStore } from './helpers';

/** Комиссия перевода — РАСХОД: baseAmountMinor перевода хранит комиссию в базовой валюте (курс у перевода остаётся пустым). */

async function setup() {
  const store = await makeStore();
  const { cash, usd, food } = await basics(store);
  const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  const usd2 = await store.wallets.create({ name: 'Доллары 2', currency: 'USD', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  return { store, cash, usd, usd2, card, food };
}

describe('комиссия при создании перевода', () => {
  it('базовая валюта: комиссия = списано − зачислено; курс и источник пусты', async () => {
    const { store, cash, card } = await setup();
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    expect(t).toMatchObject({ baseAmountMinor: 200, baseCurrency: 'TJS', fxRate: null, fxSource: null });
  });

  it('без комиссии (зачислено столько же или сумма не указана) — 0', async () => {
    const { store, cash, card } = await setup();
    const a = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 10_000, occurredOn: '2026-10-05' });
    const b = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, occurredOn: '2026-10-05' });
    expect([a.baseAmountMinor, b.baseAmountMinor]).toEqual([0, 0]);
  });

  it('обмен между разными валютами — не комиссия, 0 (даже если зачислено «меньше» по числу)', async () => {
    const { store, cash, usd } = await setup();
    const a = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: usd.id, amountMinor: 10_900, toAmountMinor: 1_000, occurredOn: '2026-10-05' });
    const b = await store.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: cash.id, amountMinor: 1_000, toAmountMinor: 10_900, occurredOn: '2026-10-05' });
    expect([a.baseAmountMinor, b.baseAmountMinor]).toEqual([0, 0]);
    expect(a.fxRate).toBeNull();
  });

  it('небазовая валюта: нужен курс (FxRequiredError); с курсом комиссия пересчитана, fxRate/fxSource остаются null', async () => {
    const { store, usd, usd2 } = await setup();
    const base = { kind: 'transfer', walletId: usd.id, toWalletId: usd2.id, amountMinor: 10_000, toAmountMinor: 9_900, occurredOn: '2026-10-05' } as const;
    await expect(store.transactions.create(base)).rejects.toBeInstanceOf(FxRequiredError);
    const t = await store.transactions.create({ ...base, fx: { rate: 10.9, source: 'manual' } });
    expect(t).toMatchObject({ baseAmountMinor: 1_090, baseCurrency: 'TJS', fxRate: null, fxSource: null }); // комиссия 100 центов × 10,9 = 1090 дирамов
    // без комиссии курс не нужен
    const free = await store.transactions.create({ ...base, toAmountMinor: 10_000 });
    expect(free.baseAmountMinor).toBe(0);
  });

  it('перевод вне границы: слишком большая комиссия в базовой валюте — понятная ошибка', async () => {
    const { store, usd, usd2 } = await setup();
    await expect(
      store.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: usd2.id, amountMinor: 1_000_000_000_000_000, toAmountMinor: 1, occurredOn: '2026-10-05', fx: { rate: 1e6, source: 'manual' } }),
    ).rejects.toThrow(/слишком велика/);
  });

  it('кривой курс для комиссии отвергается так же, как для расхода', async () => {
    const { store, usd, usd2 } = await setup();
    await expect(
      store.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: usd2.id, amountMinor: 100, toAmountMinor: 50, occurredOn: '2026-10-05', fx: { rate: 0, source: 'manual' } }),
    ).rejects.toThrow(/Курс/);
  });
});

describe('комиссия при правке перевода', () => {
  it('смена суммы зачисления пересчитывает комиссию; правка заметки — нет', async () => {
    const { store, cash, card } = await setup();
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    expect(t.baseAmountMinor).toBe(200);
    const note = await store.transactions.update(t.id, { note: 'за обслуживание' });
    expect(note.baseAmountMinor).toBe(200);
    const more = await store.transactions.update(t.id, { toAmountMinor: 9_500 });
    expect(more.baseAmountMinor).toBe(500);
    const none = await store.transactions.update(t.id, { toAmountMinor: 10_000 });
    expect(none.baseAmountMinor).toBe(0);
    const again = await store.transactions.update(t.id, { amountMinor: 20_000, toAmountMinor: 19_000 });
    expect(again.baseAmountMinor).toBe(1_000);
  });

  it('смена вида: расход → перевод с комиссией и обратно', async () => {
    const { store, cash, card } = await setup();
    const e = await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1_000, occurredOn: '2026-10-05' });
    const tr = await store.transactions.update(e.id, { kind: 'transfer', toWalletId: card.id, toAmountMinor: 900 });
    expect(tr).toMatchObject({ kind: 'transfer', baseAmountMinor: 100, fxRate: null, fxSource: null });
    const back = await store.transactions.update(e.id, { kind: 'expense' });
    expect(back).toMatchObject({ kind: 'expense', baseAmountMinor: 1_000, fxRate: 1, fxSource: 'same' });
  });

  it('старый перевод с baseAmount 0 (до комиссии) остаётся без комиссии, пока его не меняют по сумме', async () => {
    const { store, cash, card } = await setup();
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    await store.db.transactions.put({ ...t, baseAmountMinor: 0 }); // так выглядели переводы до этапа 2
    const note = await store.transactions.update(t.id, { note: 'старый' });
    expect(note.baseAmountMinor).toBe(0);
    const amount = await store.transactions.update(t.id, { amountMinor: 11_000, toAmountMinor: 10_700 });
    expect(amount.baseAmountMinor).toBe(300);
  });

  it('небазовая валюта: правка суммы без курса — FxRequiredError, сама заметка курса не требует', async () => {
    const { store, usd, usd2 } = await setup();
    const t = await store.transactions.create({ kind: 'transfer', walletId: usd.id, toWalletId: usd2.id, amountMinor: 1_000, toAmountMinor: 900, occurredOn: '2026-10-05', fx: { rate: 10, source: 'manual' } });
    expect(t.baseAmountMinor).toBe(1_000); // 100 центов × 10
    expect((await store.transactions.update(t.id, { note: 'x' })).baseAmountMinor).toBe(1_000);
    await expect(store.transactions.update(t.id, { toAmountMinor: 800 })).rejects.toBeInstanceOf(FxRequiredError);
    expect((await store.transactions.update(t.id, { toAmountMinor: 800, fx: { rate: 10, source: 'manual' } })).baseAmountMinor).toBe(2_000);
    expect((await store.transactions.update(t.id, { toAmountMinor: 1_000 })).baseAmountMinor).toBe(0);
  });
});

describe('сводки: комиссия — расход месяца', () => {
  it('summarizeMonth: комиссия входит в расходы и отдельной строкой в категориях; перевод в доходы/расходы не входит', async () => {
    const { store, cash, card, food } = await setup();
    await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 1_000, categoryId: food.id, occurredOn: '2026-10-06' });
    await store.transactions.create({ kind: 'expense', walletId: cash.id, amountMinor: 50, occurredOn: '2026-10-06' });
    const s = summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS');
    expect(s.expenseMinor).toBe(1_000 + 50 + 200);
    expect(s.feeMinor).toBe(200);
    expect(s.incomeMinor).toBe(0);
    expect(s.byCategory).toEqual([
      { categoryId: food.id, totalMinor: 1_000 },
      { categoryId: null, totalMinor: 200, kind: 'fee' },
      { categoryId: null, totalMinor: 50 },
    ]);
  });

  it('удалённый перевод с комиссией не считается', async () => {
    const { store, cash, card } = await setup();
    const t = await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    await store.transactions.softDelete(t.id);
    expect(summarizeMonth(await store.db.transactions.toArray(), '2026-10', 'TJS')).toMatchObject({ expenseMinor: 0, feeMinor: 0, byCategory: [] });
  });

  it('остаток кошельков не зависит от снимка комиссии: списано и зачислено ровно столько, сколько указано', async () => {
    const { store, cash, card } = await setup();
    await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-05' });
    const { computeBalances } = await import('@/domain/balances');
    const b = computeBalances(await store.db.wallets.toArray(), await store.db.transactions.toArray());
    expect(b.get(cash.id)).toBe(100_000 - 10_000);
    expect(b.get(card.id)).toBe(9_800);
  });
});
