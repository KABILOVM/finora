import { describe, expect, it } from 'vitest';
import {
  categoryCovers,
  computeBudgetProgress,
  hottestBudgets,
  pickWidgetBudgets,
  levelOf,
  percentOf,
  type BudgetLike,
  type BudgetProgress,
  type SpendRow,
} from './budgetProgress';

const FOOD = 'cat-food';
const CAFE = 'cat-cafe'; // подкатегория «Еды»
const LATTE = 'cat-latte'; // под-подкатегория (внучка «Еды»)
const BUS = 'cat-bus';
const PARENTS = new Map<string, string | null>([
  [FOOD, null],
  [CAFE, FOOD],
  [LATTE, CAFE],
  [BUS, null],
]);

const budget = (over: Partial<BudgetLike> & Pick<BudgetLike, 'id'>): BudgetLike => ({
  categoryId: null,
  amountMinor: 100_000,
  currency: 'TJS',
  archivedAt: null,
  deletedAt: null,
  ...over,
});

const run = (budgets: BudgetLike[], byCategory: SpendRow[], expenseMinor?: number, base = 'TJS') =>
  computeBudgetProgress({
    budgets,
    byCategory,
    expenseMinor: expenseMinor ?? byCategory.reduce((s, r) => s + r.totalMinor, 0),
    parentOf: PARENTS,
    base,
  });

const ok = (r: ReturnType<typeof run>) => {
  if (!r.ok) throw new Error('ожидался успешный расчёт');
  return r;
};
const comparable = (p: BudgetProgress | undefined) => {
  if (!p || !p.comparable) throw new Error('ожидался сравнимый бюджет');
  return p;
};

describe('percentOf и levelOf', () => {
  it('целый процент, округление ВНИЗ', () => {
    expect(percentOf(699, 1000)).toBe(69);
    expect(percentOf(700, 1000)).toBe(70);
    expect(percentOf(899, 1000)).toBe(89);
    expect(percentOf(900, 1000)).toBe(90);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(1000, 1000)).toBe(100);
    expect(percentOf(1999, 1000)).toBe(199);
  });

  it('границы уровней: 69 ok · 70 warn · 89 warn · 90 danger · 99 danger · 100 over · 250 over', () => {
    expect(levelOf(0)).toBe('ok');
    expect(levelOf(69)).toBe('ok');
    expect(levelOf(70)).toBe('warn');
    expect(levelOf(89)).toBe('warn');
    expect(levelOf(90)).toBe('danger');
    expect(levelOf(99)).toBe('danger');
    expect(levelOf(100)).toBe('over');
    expect(levelOf(250)).toBe('over');
  });

  it('нет трат, нет лимита, мусор — 0, а не NaN и не исключение', () => {
    expect(percentOf(0, 1000)).toBe(0);
    expect(percentOf(-5, 1000)).toBe(0);
    expect(percentOf(500, 0)).toBe(0);
    expect(percentOf(Number.NaN, 1000)).toBe(0);
    expect(percentOf(1.5, 1000)).toBe(0);
  });

  it('огромные суммы не теряют точность (произведение на 100 выходит за 2^53)', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(percentOf(max, max)).toBe(100);
    expect(percentOf(max - 1, max)).toBe(99); // 99,99999…% — это ещё не 100
    expect(levelOf(percentOf(max - 1, max))).toBe('danger');
    expect(percentOf(max, 1)).toBeGreaterThan(1e17);
  });

  it('копейка в лимите, потрачено много — процент огромный, но число конечное', () => {
    expect(Number.isFinite(percentOf(1_000_000, 1))).toBe(true);
    expect(percentOf(1_000_000, 1)).toBe(100_000_000);
  });
});

describe('categoryCovers', () => {
  it('сама категория, дочерняя и внучатая охвачены; соседняя и родительская — нет', () => {
    expect(categoryCovers(FOOD, FOOD, PARENTS)).toBe(true);
    expect(categoryCovers(FOOD, CAFE, PARENTS)).toBe(true);
    expect(categoryCovers(FOOD, LATTE, PARENTS)).toBe(true);
    expect(categoryCovers(CAFE, LATTE, PARENTS)).toBe(true);
    expect(categoryCovers(CAFE, FOOD, PARENTS)).toBe(false);
    expect(categoryCovers(FOOD, BUS, PARENTS)).toBe(false);
  });

  it('«без категории» и неизвестная категория не охвачены; петля в данных не зацикливает', () => {
    expect(categoryCovers(FOOD, null, PARENTS)).toBe(false);
    expect(categoryCovers(FOOD, 'нет-такой', PARENTS)).toBe(false);
    const loop = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect(categoryCovers('x', 'a', loop)).toBe(false);
    expect(categoryCovers('b', 'a', loop)).toBe(true);
  });
});

describe('computeBudgetProgress', () => {
  it('пусто: нет бюджетов — нет строк, «Без лимита» не нужен', () => {
    const r = ok(run([], [{ categoryId: FOOD, totalMinor: 500 }]));
    expect(r.items).toEqual([]);
    expect(r.hasCategoryBudgets).toBe(false);
  });

  it('нет трат: 0 потрачено, 0%, уровень ok, остаток = лимит', () => {
    const r = ok(run([budget({ id: 'b1', categoryId: FOOD })], []));
    expect(comparable(r.items[0])).toMatchObject({ spentMinor: 0, percent: 0, level: 'ok', remainingMinor: 100_000, overMinor: 0 });
  });

  it('бюджет категории охватывает её и ПОДКАТЕГОРИИ (любой глубины), но не соседей', () => {
    const r = ok(
      run(
        [budget({ id: 'b1', categoryId: FOOD })],
        [
          { categoryId: FOOD, totalMinor: 10_000 },
          { categoryId: CAFE, totalMinor: 20_000 },
          { categoryId: LATTE, totalMinor: 5_000 },
          { categoryId: BUS, totalMinor: 99_999 },
        ],
      ),
    );
    expect(comparable(r.items[0])).toMatchObject({ spentMinor: 35_000, percent: 35, level: 'ok' });
  });

  it('бюджет подкатегории не включает родителя', () => {
    const r = ok(
      run(
        [budget({ id: 'b1', categoryId: CAFE })],
        [
          { categoryId: FOOD, totalMinor: 50_000 },
          { categoryId: CAFE, totalMinor: 7_000 },
          { categoryId: LATTE, totalMinor: 3_000 },
        ],
      ),
    );
    expect(comparable(r.items[0]).spentMinor).toBe(10_000);
  });

  it('родительский и дочерний лимиты существуют вместе: трата подкатегории считается в обоих', () => {
    const r = ok(
      run(
        [budget({ id: 'p', categoryId: FOOD }), budget({ id: 'c', categoryId: CAFE, amountMinor: 20_000 })],
        [{ categoryId: CAFE, totalMinor: 10_000 }],
      ),
    );
    expect(comparable(r.items[0]).spentMinor).toBe(10_000);
    expect(comparable(r.items[1])).toMatchObject({ spentMinor: 10_000, percent: 50 });
    expect(r.unlimitedMinor).toBe(0);
  });

  it('общий лимит — ВСЕ расходы, включая «Комиссии» и «Без категории»', () => {
    const rows: SpendRow[] = [
      { categoryId: FOOD, totalMinor: 30_000 },
      { categoryId: null, totalMinor: 10_000 }, // без категории
      { categoryId: null, totalMinor: 5_000, kind: 'fee' }, // комиссии
    ];
    const r = ok(run([budget({ id: 'total', categoryId: null })], rows, 45_000));
    expect(comparable(r.items[0])).toMatchObject({ spentMinor: 45_000, percent: 45, level: 'ok' });
  });

  it('комиссии и «без категории» не попадают в лимит категории, даже если у неё есть потомки', () => {
    const r = ok(
      run(
        [budget({ id: 'b1', categoryId: FOOD })],
        [
          { categoryId: null, totalMinor: 70_000 },
          { categoryId: null, totalMinor: 20_000, kind: 'fee' },
        ],
      ),
    );
    expect(comparable(r.items[0]).spentMinor).toBe(0);
  });

  it('«Без лимита»: всё, что не охвачено лимитами по категориям (комиссии и «без категории» — тоже)', () => {
    const r = ok(
      run(
        [budget({ id: 'b1', categoryId: FOOD }), budget({ id: 'total', categoryId: null, amountMinor: 1_000_000 })],
        [
          { categoryId: CAFE, totalMinor: 10_000 }, // охвачено «Едой»
          { categoryId: BUS, totalMinor: 4_000 }, // без лимита
          { categoryId: null, totalMinor: 700 }, // без категории
          { categoryId: null, totalMinor: 300, kind: 'fee' }, // комиссии
        ],
      ),
    );
    expect(r.hasCategoryBudgets).toBe(true);
    expect(r.unlimitedMinor).toBe(5_000);
  });

  it('только общий лимит: «Без лимита» не нужно (hasCategoryBudgets = false)', () => {
    const r = ok(run([budget({ id: 'total', categoryId: null })], [{ categoryId: BUS, totalMinor: 4_000 }]));
    expect(r.hasCategoryBudgets).toBe(false);
  });

  it('архивные и удалённые бюджеты не считаются и не прячут расходы от «Без лимита»', () => {
    const r = ok(
      run(
        [
          budget({ id: 'a', categoryId: FOOD, archivedAt: '2026-10-01T00:00:00.000Z' }),
          budget({ id: 'd', categoryId: BUS, deletedAt: '2026-10-01T00:00:00.000Z' }),
          budget({ id: 'live', categoryId: null }),
        ],
        [
          { categoryId: FOOD, totalMinor: 1_000 },
          { categoryId: BUS, totalMinor: 2_000 },
        ],
      ),
    );
    expect(r.items.map((i) => i.id)).toEqual(['live']);
    expect(r.hasCategoryBudgets).toBe(false);
    expect(r.unlimitedMinor).toBe(3_000);
  });

  it('порог 70%: 69,9% → ok (потрачено 69%), ровно 70% → warn', () => {
    const at = (spent: number) => comparable(ok(run([budget({ id: 'b', categoryId: FOOD, amountMinor: 1000 })], [{ categoryId: FOOD, totalMinor: spent }])).items[0]);
    expect(at(699)).toMatchObject({ percent: 69, level: 'ok' });
    expect(at(700)).toMatchObject({ percent: 70, level: 'warn' });
    expect(at(899)).toMatchObject({ percent: 89, level: 'warn' });
    expect(at(900)).toMatchObject({ percent: 90, level: 'danger' });
    expect(at(999)).toMatchObject({ percent: 99, level: 'danger', remainingMinor: 1, overMinor: 0 });
  });

  it('ровно лимит: «over», остаток 0, превышения нет; больше лимита — превышение в минорных единицах', () => {
    const at = (spent: number) => comparable(ok(run([budget({ id: 'b', categoryId: FOOD, amountMinor: 1000 })], [{ categoryId: FOOD, totalMinor: spent }])).items[0]);
    expect(at(1000)).toMatchObject({ percent: 100, level: 'over', remainingMinor: 0, overMinor: 0 });
    expect(at(1001)).toMatchObject({ percent: 100, level: 'over', remainingMinor: 0, overMinor: 1 });
    expect(at(2500)).toMatchObject({ percent: 250, level: 'over', remainingMinor: 0, overMinor: 1500 });
  });

  it('лимит в прежней основной валюте: процентов нет (comparable: false), а не «0%»', () => {
    const r = ok(run([budget({ id: 'b', categoryId: FOOD, currency: 'USD' })], [{ categoryId: FOOD, totalMinor: 500 }]));
    expect(r.items[0]).toMatchObject({ comparable: false, currency: 'USD', limitMinor: 100_000 });
    expect(r.items[0]).not.toHaveProperty('percent');
    // категория «под лимитом» (хоть и несравнимым): её траты не считаются «без лимита»
    expect(r.unlimitedMinor).toBe(0);
  });

  it('переполнение сумм — признак ошибки, а не исключение', () => {
    const r = run(
      [budget({ id: 'b', categoryId: FOOD })],
      [
        { categoryId: FOOD, totalMinor: Number.MAX_SAFE_INTEGER },
        { categoryId: CAFE, totalMinor: Number.MAX_SAFE_INTEGER },
      ],
      0,
    );
    expect(r).toEqual({ ok: false, error: 'overflow' });
  });

  it('бюджет с некорректным лимитом (0, дробный) пропускается, остальные считаются', () => {
    const r = ok(
      run(
        [budget({ id: 'zero', amountMinor: 0 }), budget({ id: 'frac', amountMinor: 1.5 }), budget({ id: 'fine', categoryId: BUS })],
        [{ categoryId: BUS, totalMinor: 10 }],
      ),
    );
    expect(r.items.map((i) => i.id)).toEqual(['fine']);
  });
});

describe('hottestBudgets', () => {
  const mk = (id: string, percent: number | null): BudgetProgress =>
    percent === null
      ? { comparable: false, id, categoryId: null, limitMinor: 1, currency: 'USD' }
      : { comparable: true, id, categoryId: null, limitMinor: 100, currency: 'TJS', spentMinor: percent, percent, level: levelOf(percent), remainingMinor: 0, overMinor: 0 };

  it('по убыванию процента, равные — по id; несравнимые пропускаются; не больше limit', () => {
    const top = hottestBudgets([mk('a', 10), mk('b', 95), mk('c', null), mk('d', 95), mk('e', 40)], 3);
    expect(top.map((t) => t.id)).toEqual(['b', 'd', 'e']);
  });

  it('пусто и limit ≤ 0 — пусто; исходный массив не меняется', () => {
    expect(hottestBudgets([], 3)).toEqual([]);
    const src = [mk('a', 1), mk('b', 2)];
    expect(hottestBudgets(src, 0)).toEqual([]);
    expect(hottestBudgets(src, -2)).toEqual([]);
    hottestBudgets(src, 2);
    expect(src.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('pickWidgetBudgets', () => {
  const cat = (id: string, percent: number): BudgetProgress => ({
    comparable: true,
    id,
    categoryId: `c-${id}`,
    limitMinor: 100,
    currency: 'TJS',
    spentMinor: percent,
    percent,
    level: levelOf(percent),
    remainingMinor: 0,
    overMinor: 0,
  });
  const total = (percent: number): BudgetProgress => ({ ...cat('total', percent), categoryId: null });

  it('без общего лимита — три самых «горячих» по категориям', () => {
    const rows = pickWidgetBudgets([cat('a', 10), cat('b', 95), cat('c', 50), cat('d', 72)]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'd', 'c']);
  });

  it('с общим лимитом — он первым, и до двух категорий, которые уже не «в пределах»', () => {
    const rows = pickWidgetBudgets([cat('a', 10), cat('b', 95), cat('c', 120), cat('d', 72), total(30)]);
    expect(rows.map((r) => r.id)).toEqual(['total', 'c', 'b']);
  });

  it('с общим лимитом и спокойными категориями — только общий', () => {
    expect(pickWidgetBudgets([total(10), cat('a', 20), cat('b', 69)]).map((r) => r.id)).toEqual(['total']);
  });

  it('пусто — пусто', () => {
    expect(pickWidgetBudgets([])).toEqual([]);
  });
});
