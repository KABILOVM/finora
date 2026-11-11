import { describe, expect, it } from 'vitest';
import type { CategoryTotal } from '@/db/queries';
import { topSpending } from './spending';

const cat = (name: string, parentId: string | null = null, color = '#112233') => ({ name, icon: 'i:food', color, parentId });
const CATS = new Map([
  ['food', cat('Еда')],
  ['cafe', cat('Кафе', 'food')],
  ['market', cat('Рынок', 'food')],
  ['bus', cat('Транспорт', null, '#445566')],
]);

describe('topSpending: на что ушло больше всего', () => {
  it('подкатегории складываются с родителем; строки от большего к меньшему с долей от всех расходов', () => {
    const rows: CategoryTotal[] = [
      { categoryId: 'bus', totalMinor: 3000 },
      { categoryId: 'cafe', totalMinor: 2000 },
      { categoryId: 'market', totalMinor: 4000 },
      { categoryId: 'food', totalMinor: 1000 },
    ];
    expect(topSpending(rows, CATS, 3)).toEqual([
      { key: 'food', name: 'Еда', icon: 'i:food', color: '#112233', totalMinor: 7000, percent: 70 },
      { key: 'bus', name: 'Транспорт', icon: 'i:food', color: '#445566', totalMinor: 3000, percent: 30 },
    ]);
  });

  it('«Без категории» и комиссии переводов — отдельными строками', () => {
    const rows: CategoryTotal[] = [
      { categoryId: null, totalMinor: 500 },
      { categoryId: null, totalMinor: 300, kind: 'fee' },
      { categoryId: 'bus', totalMinor: 200 },
    ];
    expect(topSpending(rows, CATS, 5).map((r) => [r.name, r.totalMinor, r.percent])).toEqual([
      ['Без категории', 500, 50],
      ['Комиссии', 300, 30],
      ['Транспорт', 200, 20],
    ]);
  });

  it('не больше limit строк; доля считается от ВСЕХ расходов, а не от показанных', () => {
    const rows: CategoryTotal[] = [
      { categoryId: 'bus', totalMinor: 600 },
      { categoryId: 'food', totalMinor: 300 },
      { categoryId: null, totalMinor: 100 },
    ];
    expect(topSpending(rows, CATS, 1)).toEqual([{ key: 'bus', name: 'Транспорт', icon: 'i:food', color: '#445566', totalMinor: 600, percent: 60 }]);
  });

  it('категория, которой уже нет в списке, показана как «Без категории»; нулевые строки пропускаются; пусто — пусто', () => {
    expect(topSpending([{ categoryId: 'gone', totalMinor: 100 }, { categoryId: 'bus', totalMinor: 0 }], CATS, 3).map((r) => r.name)).toEqual(['Без категории']);
    expect(topSpending([], CATS, 3)).toEqual([]);
  });

  it('петля в родителях (испорченные данные) не зацикливает расчёт', () => {
    const loop = new Map([
      ['a', cat('А', 'b')],
      ['b', cat('Б', 'a')],
    ]);
    expect(topSpending([{ categoryId: 'a', totalMinor: 100 }], loop, 3)).toHaveLength(1);
  });

  it('суммы за пределами безопасного целого — RangeError, а не неверное число', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(() => topSpending([{ categoryId: 'bus', totalMinor: big }, { categoryId: 'food', totalMinor: big }], CATS, 3)).toThrow(RangeError);
  });

  it('доля не теряет точность на больших суммах', () => {
    const rows: CategoryTotal[] = [
      { categoryId: 'bus', totalMinor: 3_000_000_000_000_000 },
      { categoryId: 'food', totalMinor: 1_000_000_000_000_000 },
    ];
    expect(topSpending(rows, CATS, 2).map((r) => r.percent)).toEqual([75, 25]);
  });
});
