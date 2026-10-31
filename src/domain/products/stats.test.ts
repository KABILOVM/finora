import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from '../types';
import { AVG_FALLBACK_COUNT, AVG_WINDOW_DAYS, bookKey, buildPriceBook, ownProducts, productKeyOf, statsForProduct } from './stats';

const NOW = '2026-10-31T12:00:00.000Z';
const day = (daysAgo: number, hour = 10) => new Date(Date.parse(NOW) - daysAgo * 86_400_000 + (hour - 12) * 3_600_000).toISOString();

let n = 0;
const bought = (name: string, unit: ShoppingItem['unit'], qtyMilli: number, priceMinor: number | null, at: string | null, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  createdAt: at ?? NOW,
  clientUpdatedAt: NOW,
  deviceId: 'd',
  deletedAt: null,
  name,
  qtyMilli,
  unit,
  priceMinor,
  checkedAt: at,
  purchasedAt: at,
  transactionId: at === null ? null : '11111111-1111-4111-8111-111111111111',
  ...extra,
});

describe('ключ продукта', () => {
  it('«Картошка» и «Картофель» — один продукт каталога; чужое название — своё', () => {
    expect(productKeyOf('Картошка')).toBe(productKeyOf(' КАРТОФЕЛЬ '));
    expect(productKeyOf('Картошка')).toMatch(/^c:/);
    expect(productKeyOf('Курт  Сушёный')).toBe('n:курт сушеный');
  });
});

describe('книга цен', () => {
  it('последняя цена — из самой свежей покупки, цена за единицу = цена позиции / количество', () => {
    const book = buildPriceBook(
      [bought('Картофель', 'kg', 2000, 1200, day(10)), bought('Картофель', 'kg', 1500, 1350, day(2)), bought('Картофель', 'kg', 1000, 500, day(30))],
      NOW,
    );
    const s = book.get(bookKey(productKeyOf('Картофель'), 'kg'));
    expect(s).toMatchObject({ lastUnitMinor: 900, lastAt: day(2), count: 3, unit: 'kg', name: 'Картофель' });
  });

  it('средняя — взвешенная по количеству: 3 кг по 6 и 1 кг по 10 дают 7, а не 8', () => {
    const book = buildPriceBook([bought('Картофель', 'kg', 3000, 1800, day(5)), bought('Картофель', 'kg', 1000, 1000, day(3))], NOW);
    const s = statsForProduct(book, { id: productKeyOf('Картофель').slice(2), unit: 'kg' });
    expect(s).toMatchObject({ avgUnitMinor: 700, avgBasis: 'days', avgCount: 2 });
  });

  it('в среднюю входят покупки за 90 дней; более старые считаются в «всего покупок», но среднюю не тянут', () => {
    const items = [
      bought('Молоко', 'l', 1000, 1000, day(AVG_WINDOW_DAYS + 5)), // старая, дорогая
      bought('Молоко', 'l', 1000, 1000, day(AVG_WINDOW_DAYS + 20)),
      bought('Молоко', 'l', 1000, 1200, day(60)),
      bought('Молоко', 'l', 1000, 1400, day(20)),
    ];
    const s = buildPriceBook(items, NOW).get(bookKey(productKeyOf('Молоко'), 'l'));
    expect(s).toMatchObject({ count: 4, avgBasis: 'days', avgCount: 2, avgUnitMinor: 1300 });
    // граница: ровно 90 дней назад ещё входит
    const edge = buildPriceBook([bought('Молоко', 'l', 1000, 1000, daysBefore(AVG_WINDOW_DAYS))], NOW).get(bookKey(productKeyOf('Молоко'), 'l'));
    expect(edge?.avgBasis).toBe('days');
  });

  it('если за 90 дней покупок нет — средняя по последним пяти', () => {
    const items = Array.from({ length: 8 }, (_, i) => bought('Сахар', 'kg', 1000, 1000 + i * 100, day(AVG_WINDOW_DAYS + 10 + (7 - i) * 3)));
    // цены по возрастанию во времени: самые свежие — самые дорогие (1700, 1600, 1500, 1400, 1300)
    const s = buildPriceBook(items, NOW).get(bookKey(productKeyOf('Сахар'), 'kg'));
    expect(s).toMatchObject({ count: 8, avgBasis: 'recent', avgCount: AVG_FALLBACK_COUNT, avgUnitMinor: 1500, lastUnitMinor: 1700 });
  });

  it('килограммы и штуки не смешиваются; названия разных написаний одного продукта объединяются', () => {
    const items = [bought('Молоко', 'l', 1000, 1300, day(1)), bought('молоко', 'pcs', 1000, 1500, day(2)), bought('Картошка', 'kg', 1000, 600, day(3)), bought('Картофель', 'kg', 1000, 800, day(1))];
    const book = buildPriceBook(items, NOW);
    expect(book.get(bookKey(productKeyOf('Молоко'), 'l'))?.lastUnitMinor).toBe(1300);
    expect(book.get(bookKey(productKeyOf('Молоко'), 'pcs'))?.lastUnitMinor).toBe(1500);
    const pot = book.get(bookKey(productKeyOf('Картофель'), 'kg'));
    expect(pot).toMatchObject({ count: 2, lastUnitMinor: 800, avgUnitMinor: 700, name: 'Картофель' });
  });

  it('не считаются: не купленные, удалённые, без цены, с нулевой ценой', () => {
    const items = [
      bought('Хлеб', 'pcs', 1000, 500, null),
      bought('Хлеб', 'pcs', 1000, 500, day(1), { deletedAt: day(0) }),
      bought('Хлеб', 'pcs', 1000, null, day(1)),
      bought('Хлеб', 'pcs', 1000, 0, day(1)),
    ];
    expect(buildPriceBook(items, NOW).size).toBe(0);
    expect(buildPriceBook([], NOW).size).toBe(0);
  });

  it('округление: половинка вверх; цены порядка миллиардов не ломают расчёт', () => {
    const s = buildPriceBook([bought('Рис', 'kg', 3000, 100, day(1))], NOW).get(bookKey(productKeyOf('Рис'), 'kg'));
    expect(s?.lastUnitMinor).toBe(33);
    const half = buildPriceBook([bought('Рис', 'kg', 2000, 3, day(1))], NOW).get(bookKey(productKeyOf('Рис'), 'kg'));
    expect(half?.lastUnitMinor).toBe(2); // 1,5 → 2
    const big = buildPriceBook([bought('Рис', 'kg', 1000, 4_000_000_000, day(1)), bought('Рис', 'kg', 1000, 2_000_000_000, day(2))], NOW).get(bookKey(productKeyOf('Рис'), 'kg'));
    expect(big).toMatchObject({ lastUnitMinor: 4_000_000_000, avgUnitMinor: 3_000_000_000 });
  });

  it('порядок покупок с одинаковым временем определён по id: результат не зависит от порядка во входе', () => {
    const a = bought('Лук', 'kg', 1000, 500, day(1));
    const b = bought('Лук', 'kg', 1000, 900, day(1));
    const k = bookKey(productKeyOf('Лук'), 'kg');
    expect(buildPriceBook([a, b], NOW).get(k)?.lastUnitMinor).toBe(buildPriceBook([b, a], NOW).get(k)?.lastUnitMinor);
  });
});

describe('статистика продукта и свои продукты', () => {
  it('statsForProduct: в единице по умолчанию; иначе в той, где покупка свежее; нет покупок — null', () => {
    const id = productKeyOf('Молоко').slice(2);
    const book = buildPriceBook([bought('Молоко', 'pcs', 1000, 1500, day(2)), bought('Молоко', 'kg', 1000, 1100, day(1))], NOW);
    expect(statsForProduct(book, { id, unit: 'l' })?.unit).toBe('kg'); // в литрах не покупали: берём самую свежую покупку
    expect(statsForProduct(buildPriceBook([], NOW), { id, unit: 'l' })).toBeNull();
    const withL = buildPriceBook([bought('Молоко', 'l', 1000, 1300, day(5)), bought('Молоко', 'pcs', 1000, 1500, day(1))], NOW);
    expect(statsForProduct(withL, { id, unit: 'l' })?.unit).toBe('l');
  });

  it('ownProducts: только названия не из каталога, свежие первыми', () => {
    const book = buildPriceBook(
      [bought('Курт сушёный', 'kg', 1000, 9000, day(10)), bought('Лепёшка тандырная особая', 'pcs', 1000, 700, day(2)), bought('Картофель', 'kg', 1000, 600, day(1))],
      NOW,
    );
    expect(ownProducts(book).map((s) => s.name)).toEqual(['Лепёшка тандырная особая', 'Курт сушёный']);
  });
});

function daysBefore(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}
