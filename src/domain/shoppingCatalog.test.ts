import { describe, expect, it } from 'vitest';
import { bindToCatalog, buildCatalog, findInCatalog, nameKey, suggestFromCatalog } from './shoppingCatalog';
import type { ShoppingItem, ShoppingUnit } from './types';

const item = (name: string, unit: ShoppingUnit, over: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({
    id: name + unit,
    name,
    unit,
    qtyMilli: 1000,
    priceMinor: null,
    checkedAt: null,
    purchasedAt: null,
    transactionId: null,
    deletedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }) as ShoppingItem;

describe('каталог покупок', () => {
  it('nameKey: без регистра, ё и лишних пробелов', () => {
    expect(nameKey('  Ёжик   В Тумане ')).toBe('ежик в тумане');
  });

  it('buildCatalog: одна запись на название, побеждает свежая позиция; удалённые не в счёт; свежие первыми', () => {
    const c = buildCatalog([
      item('Молоко', 'pcs', { createdAt: '2026-10-01T10:00:00.000Z' }),
      item('молоко', 'l', { createdAt: '2026-10-05T10:00:00.000Z' }),
      item('Хлеб', 'pcs', { createdAt: '2026-10-03T10:00:00.000Z' }),
      item('Соль', 'kg', { deletedAt: '2026-10-06T10:00:00.000Z' }),
      item('Мука', 'kg', { purchasedAt: '2026-10-09T10:00:00.000Z' }),
    ]);
    expect(c).toEqual([
      { name: 'Мука', unit: 'kg' },
      { name: 'молоко', unit: 'l' },
      { name: 'Хлеб', unit: 'pcs' },
    ]);
  });

  it('findInCatalog: точное совпадение и другое число/падеж; чужое слово не цепляется', () => {
    const c = [
      { name: 'Яблоки', unit: 'kg' as const },
      { name: 'Молоко', unit: 'l' as const },
    ];
    expect(findInCatalog('яблоки', c)?.name).toBe('Яблоки');
    expect(findInCatalog('Яблоко', c)?.name).toBe('Яблоки');
    expect(findInCatalog('молока', c)?.name).toBe('Молоко');
    expect(findInCatalog('мука', c)).toBeNull();
    expect(findInCatalog('', c)).toBeNull();
  });

  it('bindToCatalog: название как у человека; единица каталога только если количество не называли', () => {
    const c = [
      { name: 'Молоко', unit: 'l' as const },
      { name: 'Хлеб', unit: 'pcs' as const },
    ];
    expect(bindToCatalog({ name: 'молока', qtyMilli: 1000, unit: 'pcs' }, c)).toEqual({ name: 'Молоко', qtyMilli: 1000, unit: 'l' });
    expect(bindToCatalog({ name: 'молоко', qtyMilli: 2000, unit: 'pcs' }, c)).toEqual({ name: 'Молоко', qtyMilli: 2000, unit: 'pcs' });
    expect(bindToCatalog({ name: 'молоко', qtyMilli: 500, unit: 'kg' }, c)).toEqual({ name: 'Молоко', qtyMilli: 500, unit: 'kg' });
    expect(bindToCatalog({ name: 'хлеб', qtyMilli: 1000, unit: 'pcs' }, c)).toEqual({ name: 'Хлеб', qtyMilli: 1000, unit: 'pcs' });
    const none = { name: 'сыр', qtyMilli: 1000, unit: 'pcs' as const };
    expect(bindToCatalog(none, c)).toBe(none);
  });

  it('suggestFromCatalog: названия со словом, без точного совпадения, не больше limit', () => {
    const c = [
      { name: 'Масло сливочное', unit: 'pcs' as const },
      { name: 'Масло', unit: 'l' as const },
      { name: 'Подсолнечное масло', unit: 'l' as const },
    ];
    expect(suggestFromCatalog('масло', c).map((x) => x.name)).toEqual(['Масло сливочное', 'Подсолнечное масло']);
    expect(suggestFromCatalog('масло', c, 1)).toHaveLength(1);
    expect(suggestFromCatalog('', c)).toEqual([]);
  });
});
