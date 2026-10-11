import { describe, expect, it } from 'vitest';
import type { Store } from '@/db';
import { basics, makeStore } from '../../../tests/db/helpers';
import { emptyPopularity, loadPopularity, rankByPopularity, rankCategories, rankWallets } from './popularity';

const TODAY = '2026-10-11';
/** 365 дней назад от 2026-10-11 */
const EDGE = '2025-10-11';
const BEFORE_EDGE = '2025-10-10';

async function setup() {
  const store = await makeStore();
  const b = await basics(store);
  const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#2563eb', icon: '💳' });
  const taxi = await store.categories.create({ name: 'Такси', kind: 'expense', color: '#f97316', icon: '🚕' });
  const gift = await store.categories.create({ name: 'Подарок', kind: 'income', color: '#16a34a', icon: '🎁' });
  return { store, ...b, card, taxi, gift };
}

const exp = (s: Store, walletId: string, categoryId: string | null, occurredOn = '2026-10-05') =>
  s.transactions.create({ kind: 'expense', walletId, categoryId, amountMinor: 100, occurredOn });

describe('popularity: подсчёт', () => {
  it('пустая база: везде нули, порядок прежний', async () => {
    const store = await makeStore();
    const p = await loadPopularity(store, TODAY);
    expect(p.wallets.size).toBe(0);
    expect(p.categories.expense.size + p.categories.income.size).toBe(0);
    const w = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(rankWallets(w, emptyPopularity()).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('считает по виду: расход и доход отдельно, чаще — раньше', async () => {
    const { store, cash, food, taxi, salary, gift } = await setup();
    await exp(store, cash.id, taxi.id);
    await exp(store, cash.id, taxi.id);
    await exp(store, cash.id, food.id);
    await store.transactions.create({ kind: 'income', walletId: cash.id, categoryId: gift.id, amountMinor: 100, occurredOn: '2026-10-01' });
    await store.transactions.create({ kind: 'income', walletId: cash.id, categoryId: gift.id, amountMinor: 100, occurredOn: '2026-10-02' });
    const p = await loadPopularity(store, TODAY);
    const cats = await store.db.categories.toArray();
    expect(rankCategories(cats, 'expense', p).map((c) => c.name)).toEqual(['Такси', 'Еда']);
    expect(rankCategories(cats, 'income', p).map((c) => c.name)).toEqual(['Подарок', 'Зарплата']);
    expect(p.categories.income.get(salary.id)).toBeUndefined();
  });

  it('равенство (в том числе ноль): sortOrder, затем название', async () => {
    const { store, cash, food, taxi } = await setup();
    const cats = await store.db.categories.toArray();
    const base = rankCategories(cats, 'expense', emptyPopularity()).map((c) => c.name);
    await exp(store, cash.id, food.id);
    await exp(store, cash.id, taxi.id);
    const p = await loadPopularity(store, TODAY);
    const tied = rankCategories(cats, 'expense', p).map((c) => c.name);
    // у «Еды» и «Такси» по одной операции — между собой прежний порядок, остальные после них
    expect(tied.slice(0, 2)).toEqual(base.filter((n) => n === 'Еда' || n === 'Такси'));
    expect(tied.slice(2)).toEqual(base.filter((n) => n !== 'Еда' && n !== 'Такси'));
  });

  it('удалённые операции не считаются', async () => {
    const { store, cash, food, taxi } = await setup();
    const a = await exp(store, cash.id, taxi.id);
    const b = await exp(store, cash.id, taxi.id);
    await exp(store, cash.id, food.id);
    await store.transactions.softDelete(a.id);
    await store.transactions.softDelete(b.id);
    const p = await loadPopularity(store, TODAY);
    expect(p.categories.expense.get(taxi.id)).toBeUndefined();
    expect(p.categories.expense.get(food.id)).toBe(1);
    expect(p.wallets.get(cash.id)).toBe(1);
  });

  it('перевод считается для обоих кошельков', async () => {
    const { store, cash, card } = await setup();
    await store.transactions.create({ kind: 'transfer', walletId: cash.id, toWalletId: card.id, amountMinor: 100, occurredOn: '2026-10-05' });
    const p = await loadPopularity(store, TODAY);
    expect(p.wallets.get(cash.id)).toBe(1);
    expect(p.wallets.get(card.id)).toBe(1);
    expect(p.categories.expense.size + p.categories.income.size).toBe(0);
  });

  it('кошельки: самый используемый первым, остальные по убыванию, при равенстве прежний порядок', async () => {
    const { store, cash, card } = await setup();
    const usd = await store.wallets.create({ name: 'Копилка', currency: 'TJS', kind: 'cash', openingBalanceMinor: 0, color: '#2563eb', icon: '🐷' });
    await exp(store, card.id, null);
    await exp(store, card.id, null);
    await exp(store, usd.id, null);
    const p = await loadPopularity(store, TODAY);
    const order = [cash, usd, card];
    expect(rankWallets(order, p).map((w) => w.name)).toEqual(['Карта', 'Копилка', 'Нал']);
    expect(order.map((w) => w.name)).toEqual(['Нал', 'Копилка', 'Карта']); // исходный список не тронут
  });

  it('граница 365 дней по локальной дате: ровно 365 дней назад считается, на день раньше — нет', async () => {
    const { store, cash, card, food, taxi } = await setup();
    await exp(store, cash.id, food.id, EDGE);
    await exp(store, card.id, taxi.id, BEFORE_EDGE);
    const p = await loadPopularity(store, TODAY);
    expect(p.categories.expense.get(food.id)).toBe(1);
    expect(p.categories.expense.get(taxi.id)).toBeUndefined();
    expect(p.wallets.get(cash.id)).toBe(1);
    expect(p.wallets.get(card.id)).toBeUndefined();
  });

  it('архивные категории не показываются, как и раньше (список приходит уже без них)', async () => {
    const { store, cash, taxi } = await setup();
    await exp(store, cash.id, taxi.id);
    await store.categories.archive(taxi.id);
    const p = await loadPopularity(store, TODAY);
    const visible = (await store.db.categories.toArray()).filter((c) => c.archivedAt === null && c.deletedAt === null);
    expect(rankCategories(visible, 'expense', p).map((c) => c.name)).not.toContain('Такси');
  });

  it('rankByPopularity устойчива', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(rankByPopularity(items, new Map([['c', 2], ['b', 1], ['d', 1]])).map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});
