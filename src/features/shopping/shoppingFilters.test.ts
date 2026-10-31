import { describe, expect, it } from 'vitest';
import { viewItem } from '@/domain/shopping';
import type { ShoppingItem, ShoppingUnit } from '@/domain/types';
import { boughtItems, filterBought, filterViews, shoppingFilterFields, showsBought } from './shoppingFilters';

const item = (id: string, over: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  name: id,
  qtyMilli: 1000,
  unit: 'pcs',
  priceMinor: null,
  checkedAt: null,
  purchasedAt: null,
  transactionId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  clientUpdatedAt: '2026-10-01T00:00:00.000Z',
  deviceId: 'd',
  deletedAt: null,
  ...over,
});
const view = (it: ShoppingItem) => viewItem(it, new Map());
const inCart = (id: string, unit: ShoppingUnit = 'pcs') => item(id, { unit, checkedAt: '2026-10-02T00:00:00.000Z', priceMinor: 500 });
const bought = (id: string, at: string, unit: ShoppingUnit = 'pcs') => item(id, { unit, purchasedAt: at, priceMinor: 500, checkedAt: at, transactionId: `t-${id}` });

describe('фильтры покупок', () => {
  it('boughtItems: только купленные и живые, свежие первыми', () => {
    const list = [
      bought('a', '2026-10-01T10:00:00.000Z'),
      bought('b', '2026-10-03T10:00:00.000Z'),
      item('c'),
      { ...bought('d', '2026-10-05T10:00:00.000Z'), deletedAt: '2026-10-06T00:00:00.000Z' },
    ];
    expect(boughtItems(list).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('поля: «Куплено» только когда покупки были; единицы — только если их больше одной', () => {
    const views = [view(item('x', { unit: 'kg' })), view(inCart('y', 'pcs'))];
    const f = shoppingFilterFields(views, []);
    expect(f.map((x) => x.key)).toEqual(['state', 'unit']);
    expect(f[0]?.options.map((o) => o.label)).toEqual(['В списке', 'В корзине']);
    expect(f[1]?.options.map((o) => o.label)).toEqual(['шт', 'кг']);

    const withBought = shoppingFilterFields(views, [bought('z', '2026-10-01T00:00:00.000Z', 'l')]);
    expect(withBought[0]?.options.map((o) => o.label)).toEqual(['В списке', 'В корзине', 'Куплено']);
    expect(withBought[1]?.options.map((o) => o.label)).toEqual(['шт', 'кг', 'л']);

    const oneUnit = shoppingFilterFields([view(item('p')), view(item('q'))], []);
    expect(oneUnit.map((x) => x.key)).toEqual(['state']);
  });

  it('нечего фильтровать: одна позиция и нет покупок — полей нет', () => {
    expect(shoppingFilterFields([view(item('x'))], [])).toEqual([]);
    expect(shoppingFilterFields([], [])).toEqual([]);
  });

  it('filterViews: «В списке» / «В корзине» / единица; пустой выбор — всё по порядку', () => {
    const views = [view(item('a', { unit: 'kg' })), view(inCart('b', 'kg')), view(item('c')), view(inCart('d'))];
    const ids = (v: Record<string, string>) => filterViews(views, v).map((x) => x.item.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ state: 'list' })).toEqual(['a', 'c']);
    expect(ids({ state: 'cart' })).toEqual(['b', 'd']);
    expect(ids({ unit: 'kg' })).toEqual(['a', 'b']);
    expect(ids({ state: 'cart', unit: 'pcs' })).toEqual(['d']);
    // «Куплено» активный список не сужает: экран в этот момент показывает другой список
    expect(ids({ state: 'bought' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filterBought: по единице, порядок сохраняется; showsBought', () => {
    const list = [bought('a', '2026-10-03T00:00:00.000Z', 'kg'), bought('b', '2026-10-02T00:00:00.000Z', 'l'), bought('c', '2026-10-01T00:00:00.000Z', 'kg')];
    expect(filterBought(list, { unit: 'kg' }).map((i) => i.id)).toEqual(['a', 'c']);
    expect(filterBought(list, {}).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(showsBought({ state: 'bought' })).toBe(true);
    expect(showsBought({ state: 'cart' })).toBe(false);
    expect(showsBought({})).toBe(false);
  });
});
