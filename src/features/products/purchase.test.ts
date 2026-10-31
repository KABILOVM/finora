import { describe, expect, it } from 'vitest';
import { buildPriceBook } from '@/domain/products/stats';
import type { ShoppingItem } from '@/domain/types';
import { checkLines, isGroceryCategory, statsOfName, totalOfLines, viewLine, type PurchaseLine } from './purchase';

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({ rid: 1, name: 'Картошка', unit: 'kg', qtyText: '2', amountText: '24', ...over });

describe('viewLine: строка «Что куплено»', () => {
  it('количество и сумма читаются, цена за единицу считается сама: 2 кг за 24 с. — 12 с. за кг', () => {
    const v = viewLine(line(), 'TJS');
    expect(v).toEqual({ qtyMilli: 2000, amountMinor: 2400, unitMinor: 1200, problem: null });
  });

  it('запятая и дробное количество: 1,5 кг за 18,75 с. — 12,50 за кг', () => {
    const v = viewLine(line({ qtyText: '1,5', amountText: '18,75' }), 'TJS');
    expect(v.qtyMilli).toBe(1500);
    expect(v.amountMinor).toBe(1875);
    expect(v.unitMinor).toBe(1250);
  });

  it('штуки — только целые; без суммы и без названия строка не готова и говорит почему', () => {
    expect(viewLine(line({ unit: 'pcs', qtyText: '1,5' }), 'TJS').problem).toMatch(/целое число/);
    expect(viewLine(line({ amountText: '' }), 'TJS').problem).toMatch(/Введите сумму/);
    expect(viewLine(line({ amountText: '0' }), 'TJS').problem).toMatch(/больше нуля/);
    expect(viewLine(line({ amountText: 'abc' }), 'TJS').problem).toMatch(/не читается/);
    expect(viewLine(line({ name: '   ' }), 'TJS').problem).toMatch(/название/);
    expect(viewLine(line({ qtyText: '0' }), 'TJS').problem).toMatch(/Количество/);
    expect(viewLine(line({ name: 'х'.repeat(81) }), 'TJS').problem).toMatch(/не длиннее 80/);
  });

  it('пока сумма не введена, цены за единицу нет', () => {
    expect(viewLine(line({ amountText: '' }), 'TJS').unitMinor).toBeNull();
  });
});

describe('totalOfLines: сумма расхода', () => {
  it('складывает суммы строк; недописанные строки в сумму не входят', () => {
    const lines = [line({ rid: 1, amountText: '24' }), line({ rid: 2, name: 'Молоко', unit: 'l', qtyText: '1', amountText: '13,50' }), line({ rid: 3, amountText: '' })];
    expect(totalOfLines(lines, 'TJS')).toBe(3750);
  });

  it('нет ни одной суммы — null', () => {
    expect(totalOfLines([], 'TJS')).toBeNull();
    expect(totalOfLines([line({ amountText: '' })], 'TJS')).toBeNull();
  });
});

describe('checkLines: строки → чек', () => {
  it('готовые строки становятся строками чека, названия приводятся к каталожным; итог — сумма', () => {
    const r = checkLines([line({ name: ' картошка ' }), line({ rid: 2, name: 'Мой сыр', unit: 'pcs', qtyText: '2', amountText: '30' })], 'TJS');
    expect(r).toEqual({
      ok: true,
      total: 5400,
      lines: [
        { name: 'Картофель', qtyMilli: 2000, unit: 'kg', priceMinor: 2400 },
        { name: 'Мой сыр', qtyMilli: 2000, unit: 'pcs', priceMinor: 3000 },
      ],
    });
  });

  it('первая негодная строка останавливает проверку и называет себя', () => {
    const r = checkLines([line({ rid: 1 }), line({ rid: 7, amountText: '' }), line({ rid: 9, name: '' })], 'TJS');
    expect(r).toMatchObject({ ok: false, rid: 7 });
  });

  it('пустой список — нечего записывать', () => {
    expect(checkLines([], 'TJS')).toMatchObject({ ok: false, rid: null });
  });
});

describe('isGroceryCategory: «Продукты» и её подкатегории', () => {
  const cats = [
    { id: 'g', name: 'Продукты', parentId: null },
    { id: 'veg', name: 'Овощи', parentId: 'g' },
    { id: 'food', name: 'Еда', parentId: null },
    { id: 'cafe', name: 'Кафе', parentId: 'food' },
    { id: 'loop', name: 'Петля', parentId: 'loop' },
  ];

  it('сама категория, подкатегория, регистр не важен', () => {
    expect(isGroceryCategory('g', cats)).toBe(true);
    expect(isGroceryCategory('veg', cats)).toBe(true);
    expect(isGroceryCategory('g', [{ id: 'g', name: ' ПРОДУКТЫ ', parentId: null }])).toBe(true);
  });

  it('другие категории, их подкатегории, пустой выбор и неизвестный id — нет; цикл не зацикливает', () => {
    expect(isGroceryCategory('food', cats)).toBe(false);
    expect(isGroceryCategory('cafe', cats)).toBe(false);
    expect(isGroceryCategory('loop', cats)).toBe(false);
    expect(isGroceryCategory(null, cats)).toBe(false);
    expect(isGroceryCategory('нет такой', cats)).toBe(false);
  });
});

describe('statsOfName: прошлые цены по названию и единице', () => {
  const item = (over: Partial<ShoppingItem>): ShoppingItem =>
    ({
      id: 'i1',
      name: 'Картофель',
      qtyMilli: 2000,
      unit: 'kg',
      priceMinor: 2400,
      checkedAt: '2026-10-01T10:00:00.000Z',
      purchasedAt: '2026-10-01T10:00:00.000Z',
      transactionId: 't1',
      createdAt: '2026-10-01T10:00:00.000Z',
      deletedAt: null,
      ...over,
    }) as ShoppingItem;
  const book = buildPriceBook([item({})], '2026-10-15T10:00:00.000Z');

  it('«картошка» и «Картофель» — один продукт; другая единица — другая цена', () => {
    expect(statsOfName(book, 'картошка', 'kg')?.lastUnitMinor).toBe(1200);
    expect(statsOfName(book, 'Картофель', 'kg')?.lastUnitMinor).toBe(1200);
    expect(statsOfName(book, 'Картофель', 'pcs')).toBeNull();
    expect(statsOfName(book, '', 'kg')).toBeNull();
    expect(statsOfName(book, 'Неведомое', 'kg')).toBeNull();
  });
});
