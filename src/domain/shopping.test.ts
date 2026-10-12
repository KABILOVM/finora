import { describe, expect, it } from 'vitest';
import {
  activeItems,
  expectedPrice,
  formatQty,
  itemTitle,
  parseQty,
  priceKey,
  priceMemory,
  totalsOf,
  unitPrice,
  viewItem,
} from './shopping';
import type { ShoppingItem } from './types';

let n = 0;
const item = (o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  createdAt: `2026-10-0${1 + (n % 9)}T10:00:00.000Z`,
  clientUpdatedAt: '2026-10-10T10:00:00.000Z',
  deviceId: 'd',
  deletedAt: null,
  name: 'Молоко',
  qtyMilli: 2000,
  unit: 'l',
  priceMinor: null,
  checkedAt: null,
  purchasedAt: null,
  transactionId: null,
  ...o,
});
const bought = (name: string, unit: ShoppingItem['unit'], qtyMilli: number, priceMinor: number, at: string): ShoppingItem =>
  item({ name, unit, qtyMilli, priceMinor, checkedAt: at, purchasedAt: at, transactionId: '11111111-1111-4111-8111-111111111111' });

describe('количество без плавающей точки', () => {
  it.each([
    ['1', 'kg', 1000],
    ['1,4', 'kg', 1400],
    ['1.4', 'kg', 1400],
    ['0,25', 'l', 250],
    ['0,001', 'kg', 1],
    [' 2 ', 'l', 2000],
    ['3', 'pcs', 3000],
    ['1 000', 'pcs', 1_000_000],
    ['1000000', 'kg', 1_000_000_000],
  ] as const)('«%s» (%s) → %i тысячных', (text, unit, want) => {
    expect(parseQty(text, unit)).toBe(want);
  });

  it.each([
    ['', 'kg'],
    ['0', 'kg'],
    ['0,0004', 'kg'],
    ['0,0001', 'kg'],
    ['1,2345', 'kg'],
    ['-1', 'kg'],
    ['abc', 'l'],
    ['1e3', 'l'],
    ['1,5', 'pcs'],
    ['1000001', 'kg'],
    ['99999999999999', 'kg'],
  ] as const)('«%s» (%s) отвергается', (text, unit) => {
    expect(parseQty(text, unit)).toBeNull();
  });

  it('штуки допускают нули после запятой: «2,0» = 2 шт', () => {
    expect(parseQty('2,0', 'pcs')).toBe(2000);
  });

  it('формат количества', () => {
    expect([1400, 3000, 250, 1, 1_000_000_000].map(formatQty)).toEqual(['1,4', '3', '0,25', '0,001', '1000000']);
  });

  it('заголовок позиции: «Молоко 2 л», «Яблоки 1,4 кг», «Хлеб × 3»', () => {
    expect(itemTitle('Молоко', 2000, 'l')).toBe('Молоко 2 л');
    expect(itemTitle('Яблоки', 1400, 'kg')).toBe('Яблоки 1,4 кг');
    expect(itemTitle('Хлеб', 3000, 'pcs')).toBe('Хлеб × 3');
    expect(itemTitle('Хлеб', 1000, 'pcs')).toBe('Хлеб');
  });
});

describe('цена за единицу и ожидаемая цена', () => {
  it('26,00 за 2 л → 13,00 за л; 18,00 за 2 кг → 9,00 за кг', () => {
    expect(unitPrice(2600, 2000)).toBe(1300);
    expect(unitPrice(1800, 2000)).toBe(900);
  });

  it('округление до ближайшей минорной единицы, половинка вверх', () => {
    expect(unitPrice(1000, 3000)).toBe(333); // 3,333… → 333
    expect(unitPrice(2000, 3000)).toBe(667); // 6,666… → 667
    expect(unitPrice(1, 2000)).toBe(1); // 0,5 → 1
    expect(unitPrice(1, 3000)).toBe(0); // 0,333 → 0
    expect(expectedPrice(333, 3000)).toBe(999);
    expect(expectedPrice(1, 500)).toBe(1); // 0,5 → 1
    expect(expectedPrice(1, 499)).toBe(0);
  });

  it('ожидаемая = цена за единицу × количество: 9,00 за кг × 1,4 кг = 12,60', () => {
    expect(expectedPrice(900, 1400)).toBe(1260);
    expect(expectedPrice(1300, 2000)).toBe(2600);
  });

  it('большие суммы не теряют точность (BigInt)', () => {
    const big = 1_000_000_000_000_000; // 1e15, предел сервера
    expect(unitPrice(big, 1000)).toBe(big);
    expect(unitPrice(big, 1_000_000_000)).toBe(1_000_000_000);
    expect(expectedPrice(big, 1000)).toBe(big);
    expect(expectedPrice(big, 3000)).toBe(3 * big);
  });

  it('результат за пределами безопасных целых — null, а не искажённое число', () => {
    expect(expectedPrice(Number.MAX_SAFE_INTEGER, 1_000_000_000)).toBeNull();
    expect(unitPrice(Number.MAX_SAFE_INTEGER, 1)).toBeNull();
  });

  it('мусорные входы — null', () => {
    expect(unitPrice(-1, 1000)).toBeNull();
    expect(unitPrice(100, 0)).toBeNull();
    expect(unitPrice(1.5, 1000)).toBeNull();
    expect(expectedPrice(-5, 1000)).toBeNull();
    expect(expectedPrice(100, 0)).toBeNull();
  });

  it('цена 0 законна (товар в подарок)', () => {
    expect(unitPrice(0, 1000)).toBe(0);
    expect(expectedPrice(0, 1000)).toBe(0);
  });
});

describe('память цен', () => {
  it('ключ не зависит от регистра, пробелов и «ё»; единица входит в ключ', () => {
    expect(priceKey('  Мёд  липовый ', 'kg')).toBe(priceKey('мед ЛИПОВЫЙ', 'kg'));
    expect(priceKey('Хлеб', 'pcs')).not.toBe(priceKey('Хлеб', 'kg'));
  });

  it('помнит цену за единицу из последней покупки; побеждает более поздняя', () => {
    const mem = priceMemory([
      bought('Молоко', 'l', 2000, 2400, '2026-09-01T10:00:00.000Z'), // 12,00 за л
      bought('молоко', 'l', 2000, 2600, '2026-10-01T10:00:00.000Z'), // 13,00 за л — новее
      bought('Молоко', 'l', 1000, 999, '2026-08-01T10:00:00.000Z'),
    ]);
    expect(mem.get(priceKey('Молоко', 'l'))).toBe(1300);
  });

  it('не покупали / удалены / не куплены (только в корзине) — не запоминаются', () => {
    const mem = priceMemory([
      item({ name: 'Хлеб', unit: 'pcs', qtyMilli: 1000, priceMinor: 500, checkedAt: '2026-10-01T10:00:00.000Z' }),
      { ...bought('Сыр', 'kg', 1000, 5000, '2026-10-01T10:00:00.000Z'), deletedAt: '2026-10-02T10:00:00.000Z' },
    ]);
    expect(mem.size).toBe(0);
  });

  it('цена за кг и за штуку не смешиваются', () => {
    const mem = priceMemory([bought('Яблоки', 'kg', 1000, 1200, '2026-10-01T10:00:00.000Z')]);
    expect(mem.get(priceKey('Яблоки', 'pcs'))).toBeUndefined();
  });
});

describe('вид позиции в списке', () => {
  const mem = priceMemory([bought('Молоко', 'l', 1000, 1300, '2026-09-01T10:00:00.000Z'), bought('Яблоки', 'kg', 1000, 900, '2026-09-01T10:00:00.000Z')]);

  it('неотмеченная: «≈» и «обычно»; цена = запомненная × количество', () => {
    const v = viewItem(item({ name: 'Яблоки', unit: 'kg', qtyMilli: 2000 }), mem);
    expect(v).toMatchObject({ checked: false, approx: true, priceMinor: 1800, lastUnitMinor: 900, unitMinor: null });
  });

  it('отмеченная: цена из магазина, цена за единицу и «раньше»', () => {
    const v = viewItem(item({ name: 'Молоко', unit: 'l', qtyMilli: 2000, priceMinor: 2600, checkedAt: '2026-10-10T10:00:00.000Z' }), mem);
    expect(v).toMatchObject({ checked: true, approx: false, priceMinor: 2600, unitMinor: 1300, lastUnitMinor: 1300 });
  });

  it('новый товар без истории: цены нет', () => {
    expect(viewItem(item({ name: 'Манго' }), mem)).toMatchObject({ priceMinor: null, lastUnitMinor: null, approx: true });
  });
});

describe('итоги', () => {
  const mem = priceMemory([
    bought('Молоко', 'l', 1000, 1300, '2026-09-01T10:00:00.000Z'),
    bought('Яблоки', 'kg', 1000, 900, '2026-09-01T10:00:00.000Z'),
    bought('Хлеб', 'pcs', 1000, 350, '2026-09-01T10:00:00.000Z'),
  ]);
  const at = '2026-10-10T10:00:00.000Z';

  it('план = ожидаемые цены всех ещё не купленных; в корзине = сумма вписанных цен отмеченных', () => {
    const list = [
      item({ name: 'Молоко', unit: 'l', qtyMilli: 2000, priceMinor: 2600, checkedAt: at }), // ожидалось 26,00, вписано 26,00
      item({ name: 'Яблоки', unit: 'kg', qtyMilli: 1400 }), // 12,60
      item({ name: 'Хлеб', unit: 'pcs', qtyMilli: 3000, priceMinor: 1000, checkedAt: at }), // ожидалось 10,50, вписано 10,00
      item({ name: 'Манго', unit: 'pcs', qtyMilli: 1000 }), // цены нет
    ];
    expect(totalsOf(list, mem)).toEqual({ planMinor: 2600 + 1260 + 1050, unknownCount: 1, cartMinor: 3600, cartCount: 2 });
  });

  it('купленные и удалённые в итоги не входят', () => {
    const list = [
      bought('Молоко', 'l', 1000, 1300, at),
      item({ name: 'Яблоки', unit: 'kg', qtyMilli: 1000, deletedAt: at }),
      item({ name: 'Хлеб', unit: 'pcs', qtyMilli: 1000 }),
    ];
    expect(totalsOf(list, mem)).toEqual({ planMinor: 350, unknownCount: 0, cartMinor: 0, cartCount: 0 });
  });

  it('пустой список — нули', () => {
    expect(totalsOf([], mem)).toEqual({ planMinor: 0, unknownCount: 0, cartMinor: 0, cartCount: 0 });
  });

  it('переполнение суммы — RangeError, а не неверное число', () => {
    const big = Number.MAX_SAFE_INTEGER - 1;
    const list = [item({ priceMinor: big, checkedAt: at }), item({ priceMinor: big, checkedAt: at })];
    expect(() => totalsOf(list, mem)).toThrow(RangeError);
  });

  it('активные позиции — в порядке добавления, без купленных и удалённых', () => {
    const a = item({ name: 'A', createdAt: '2026-10-01T10:00:00.000Z' });
    const b = item({ name: 'B', createdAt: '2026-10-02T10:00:00.000Z' });
    const c = item({ name: 'C', createdAt: '2026-10-03T10:00:00.000Z', deletedAt: at });
    const d = bought('D', 'pcs', 1000, 100, at);
    expect(activeItems([b, d, c, a]).map((x) => x.name)).toEqual(['A', 'B']);
  });
});
