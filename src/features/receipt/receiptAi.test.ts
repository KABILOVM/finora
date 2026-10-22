import { describe, expect, it } from 'vitest';
import { checkReceipt, emptyLine, MAX_RECEIPT_LINES, normalizeAiReceipt, type ReceiptContext, type ReceiptDraft, type ReceiptLineDraft } from './receiptAi';

const ctx: ReceiptContext = {
  categories: [
    { id: 'food', name: 'Продукты' },
    { id: 'home', name: 'Быт' },
  ],
  today: '2026-10-15',
  currency: 'TJS',
};

describe('normalizeAiReceipt', () => {
  it('собирает чек: магазин, дата, итог, позиции с количеством, единицей, ценой и категорией', () => {
    const d = normalizeAiReceipt(
      {
        merchant: '  Корзинка ',
        date: '2026-10-14',
        total: 56.7,
        items: [
          { name: 'молоко 2,5%', qty: 2, unit: 'l', price: 26, category: 'продукты' },
          { name: 'яблоки', qty: 1.4, unit: 'kg', price: 18.2, category: 'Фрукты' },
          { name: 'порошок', qty: 1, unit: 'pcs', price: 12.5, category: 'быт' },
        ],
      },
      ctx,
    );
    expect(d.merchant).toBe('Корзинка');
    expect(d.date).toBe('2026-10-14');
    expect(d.totalText).toBe('56,7');
    expect(d.lines).toEqual([
      { rid: 1, name: 'Молоко 2,5%', qtyText: '2', unit: 'l', priceText: '26', categoryId: 'food', newCategory: '' },
      { rid: 2, name: 'Яблоки', qtyText: '1,4', unit: 'kg', priceText: '18,2', categoryId: '', newCategory: 'Фрукты' },
      { rid: 3, name: 'Порошок', qtyText: '1', unit: 'pcs', priceText: '12,5', categoryId: 'home', newCategory: '' },
    ]);
  });

  it('мусор вместо ответа — пустой чек; даты из будущего и неверные заменяются сегодняшней', () => {
    expect(normalizeAiReceipt('x', ctx).lines).toEqual([]);
    expect(normalizeAiReceipt(null, ctx)).toEqual({ merchant: '', date: '2026-10-15', totalText: '', lines: [] });
    expect(normalizeAiReceipt({ date: '2026-12-01', items: [] }, ctx).date).toBe('2026-10-15');
    expect(normalizeAiReceipt({ date: '2026-02-30', items: [] }, ctx).date).toBe('2026-10-15');
  });

  it('отбрасывает пустые строки; неизвестная единица — штуки; штуки округляются до целых; нет количества — единица', () => {
    const d = normalizeAiReceipt(
      { items: [null, 5, { name: '', price: 0 }, { name: 'ок', qty: 2.6, unit: 'box', price: 3 }, { name: 'вес', qty: 0, unit: 'kg', price: 4 }, { name: 'нан', qty: NaN, price: NaN }] },
      ctx,
    );
    expect(d.lines.map((l) => [l.name, l.qtyText, l.unit, l.priceText])).toEqual([
      ['Ок', '3', 'pcs', '3'],
      ['Вес', '1', 'kg', '4'],
      ['Нан', '1', 'pcs', ''],
    ]);
  });

  it('позиций не больше предела; номера строк идут подряд от первого', () => {
    const items = Array.from({ length: MAX_RECEIPT_LINES + 20 }, (_, i) => ({ name: `Т${i}`, qty: 1, unit: 'pcs', price: 1, category: '' }));
    const d = normalizeAiReceipt({ items }, ctx, 7);
    expect(d.lines).toHaveLength(MAX_RECEIPT_LINES);
    expect([d.lines[0]!.rid, d.lines[MAX_RECEIPT_LINES - 1]!.rid]).toEqual([7, 7 + MAX_RECEIPT_LINES - 1]);
  });
});

describe('checkReceipt', () => {
  const line = (over: Partial<ReceiptLineDraft>): ReceiptLineDraft => ({ ...emptyLine(1), name: 'Хлеб', priceText: '10', ...over });
  const draft = (lines: ReceiptLineDraft[], totalText = ''): ReceiptDraft => ({ merchant: '', date: '2026-10-15', totalText, lines });

  it('позиции делятся на группы по категориям; у группы своя сумма; общая сумма сходится', () => {
    const r = checkReceipt(
      draft(
        [
          line({ rid: 1, name: 'Молоко', priceText: '26', categoryId: 'food' }),
          line({ rid: 2, name: 'Порошок', priceText: '12,5', categoryId: 'home' }),
          line({ rid: 3, name: 'Хлеб', priceText: '10,5', categoryId: 'food' }),
          line({ rid: 4, name: 'Пакет', priceText: '0,5' }),
        ],
        '49,5',
      ),
      'TJS',
    );
    expect(r.errors.size).toBe(0);
    expect(r.groups.map((g) => [g.key, g.totalMinor, g.lines.length])).toEqual([['food', 3650, 2], ['home', 1250, 1], ['', 50, 1]]);
    expect(r.sumMinor).toBe(4950);
    expect(r.totalMinor).toBe(4950);
    expect(r.diffMinor).toBe(0);
    expect(r.error).toBeNull();
  });

  it('новые категории с одним названием (без регистра) — одна группа', () => {
    const r = checkReceipt(draft([line({ rid: 1, newCategory: 'Фрукты' }), line({ rid: 2, newCategory: 'фрукты' })]), 'TJS');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ key: 'new:фрукты', categoryId: '', newCategory: 'Фрукты' });
  });

  it('расхождение с итогом чека: плюс — позиций не хватает, минус — лишнее', () => {
    expect(checkReceipt(draft([line({ priceText: '10' })], '12,5'), 'TJS').diffMinor).toBe(250);
    expect(checkReceipt(draft([line({ priceText: '10' })], '9'), 'TJS').diffMinor).toBe(-100);
    expect(checkReceipt(draft([line({ priceText: '10' })], ''), 'TJS').diffMinor).toBeNull();
  });

  it('ошибки по строкам: название, количество, цена; пока они есть, суммы нет', () => {
    const r = checkReceipt(
      draft([line({ rid: 1, name: ' ' }), line({ rid: 2, qtyText: '1,5', unit: 'pcs' }), line({ rid: 3, qtyText: '0' }), line({ rid: 4, priceText: '' }), line({ rid: 5, priceText: 'abc' }), line({ rid: 6 })]),
      'TJS',
    );
    expect(r.errors.get(1)).toBe('Введите название');
    expect(r.errors.get(2)).toMatch(/Штуки/);
    expect(r.errors.get(3)).toMatch(/Штуки|Количество/);
    expect(r.errors.get(4)).toBe('Укажите цену позиции');
    expect(r.errors.get(5)).toBe('Укажите цену позиции');
    expect(r.errors.has(6)).toBe(false);
    expect(r.sumMinor).toBeNull();
  });

  it('пустой чек и группа с нулевой суммой — ошибка чека', () => {
    expect(checkReceipt(draft([]), 'TJS').error).toBe('Добавьте хотя бы одну позицию');
    expect(checkReceipt(draft([line({ priceText: '0' })]), 'TJS').error).toMatch(/нулевая/);
  });

  it('килограммы и литры принимают до трёх знаков', () => {
    const r = checkReceipt(draft([line({ qtyText: '1,425', unit: 'kg', priceText: '14,25' })]), 'TJS');
    expect(r.groups[0]!.lines[0]).toMatchObject({ qtyMilli: 1425, unit: 'kg', priceMinor: 1425 });
    expect(checkReceipt(draft([line({ qtyText: '1,4251', unit: 'kg' })]), 'TJS').errors.get(1)).toMatch(/Количество/);
  });
});
