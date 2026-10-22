import { describe, expect, it } from 'vitest';
import {
  bigPurchases,
  duplicateGroups,
  findAnomalies,
  hasAnomalies,
  newCategories,
  type AnomalyTx,
} from './anomalies';

const BASE = 'TJS';
const TODAY = '2026-10-15';
let seq = 0;
const tx = (over: Partial<AnomalyTx> & { occurredOn: string; amountMinor: number }): AnomalyTx => ({
  id: over.id ?? `t${String(++seq).padStart(4, '0')}`,
  kind: 'expense',
  walletId: 'w1',
  categoryId: 'food',
  baseAmountMinor: over.amountMinor,
  baseCurrency: BASE,
  note: '',
  debtId: null,
  recurringRuleId: null,
  deletedAt: null,
  ...over,
});

/** Пять прошлых трат «еды» по 100: обычная — 100, самая большая — 100. */
const foodHistory = (): AnomalyTx[] => ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10'].map((d) => tx({ occurredOn: d, amountMinor: 10_000 }));

describe('bigPurchases: необычно крупная трата', () => {
  it('больше любой прошлой в категории и не меньше 2,5 обычной — находка', () => {
    const big = tx({ occurredOn: '2026-10-12', amountMinor: 40_000, note: ' банкет ' });
    const out = bigPurchases([...foodHistory(), big, tx({ occurredOn: '2026-10-13', amountMinor: 10_000 })], '2026-10', TODAY, BASE);
    expect(out).toEqual([{ key: `big:${big.id}`, txId: big.id, categoryId: 'food', amountMinor: 40_000, usualMinor: 10_000, occurredOn: '2026-10-12', note: 'банкет' }]);
  });

  it('граница: ровно 2,5 раза — ещё находка, чуть меньше — нет', () => {
    const at = tx({ occurredOn: '2026-10-12', amountMinor: 25_000 });
    expect(bigPurchases([...foodHistory(), at, tx({ occurredOn: '2026-10-14', amountMinor: 5_000 })], '2026-10', TODAY, BASE)).toHaveLength(1);
    const below = tx({ occurredOn: '2026-10-12', amountMinor: 24_999 });
    expect(bigPurchases([...foodHistory(), below, tx({ occurredOn: '2026-10-14', amountMinor: 5_000 })], '2026-10', TODAY, BASE)).toHaveLength(0);
  });

  it('если в прошлом была трата не меньше — это не рекорд, находки нет', () => {
    const history = [...foodHistory(), tx({ occurredOn: '2026-04-20', amountMinor: 50_000 })];
    // 2026-04 — дальше пяти месяцев от октября (май–сентябрь), поэтому в историю не входит
    expect(bigPurchases([...history, tx({ occurredOn: '2026-10-12', amountMinor: 40_000 })], '2026-10', TODAY, BASE)).toHaveLength(1);
    const inWindow = [...foodHistory(), tx({ occurredOn: '2026-09-20', amountMinor: 45_000 })];
    expect(bigPurchases([...inWindow, tx({ occurredOn: '2026-10-12', amountMinor: 40_000 })], '2026-10', TODAY, BASE)).toHaveLength(0);
  });

  it('мало истории (меньше пяти трат) — «обычного» нет', () => {
    const few = foodHistory().slice(0, 4);
    expect(bigPurchases([...few, tx({ occurredOn: '2026-10-12', amountMinor: 90_000 })], '2026-10', TODAY, BASE)).toEqual([]);
  });

  it('мелочь не показываем: трата меньше 5% расходов месяца', () => {
    const history = ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10'].map((d) => tx({ occurredOn: d, amountMinor: 100 }));
    const small = tx({ occurredOn: '2026-10-12', amountMinor: 300 }); // втрое больше обычной, но месяц — 100 000
    const huge = tx({ occurredOn: '2026-10-13', amountMinor: 100_000, categoryId: 'rent' });
    expect(bigPurchases([...history, small, huge], '2026-10', TODAY, BASE)).toEqual([]);
  });

  it('не берутся: по расписанию, долги, корректировки, переводы, удалённые, будущее, другая основная валюта, без категории', () => {
    const base = foodHistory();
    const bad: AnomalyTx[] = [
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, recurringRuleId: 'r1' }),
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, debtId: 'd1' }),
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, fxSource: 'adjust' }),
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, kind: 'transfer' }),
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, deletedAt: '2026-10-13T00:00:00.000Z' }),
      tx({ occurredOn: '2026-10-20', amountMinor: 40_000 }), // позже сегодняшнего дня
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, baseCurrency: 'USD' }),
      tx({ occurredOn: '2026-10-12', amountMinor: 40_000, categoryId: null }),
    ];
    expect(bigPurchases([...base, ...bad, tx({ occurredOn: '2026-10-13', amountMinor: 10_000 })], '2026-10', TODAY, BASE)).toEqual([]);
  });

  it('самые заметные первыми, не больше трёх', () => {
    const cats = ['a', 'b', 'c', 'd'];
    const hist = cats.flatMap((c) => ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10'].map((d) => tx({ occurredOn: d, amountMinor: 1_000, categoryId: c })));
    const now = cats.map((c, i) => tx({ occurredOn: '2026-10-12', amountMinor: 10_000 * (i + 1), categoryId: c, id: `n${i}` }));
    const out = bigPurchases([...hist, ...now], '2026-10', TODAY, BASE);
    expect(out.map((o) => o.txId)).toEqual(['n3', 'n2', 'n1']);
  });

  it('прошедший месяц: «сегодня» не ограничивает, история — пять месяцев до него', () => {
    const hist = ['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10'].map((d) => tx({ occurredOn: d, amountMinor: 10_000 }));
    const big = tx({ occurredOn: '2026-07-31', amountMinor: 40_000 });
    expect(bigPurchases([...hist, big], '2026-07', TODAY, BASE).map((o) => o.txId)).toEqual([big.id]);
  });
});

describe('newCategories: новая статья расходов', () => {
  const history = (): AnomalyTx[] => [
    tx({ occurredOn: '2026-07-10', amountMinor: 10_000 }),
    tx({ occurredOn: '2026-08-10', amountMinor: 10_000 }),
    tx({ occurredOn: '2026-09-10', amountMinor: 10_000, categoryId: 'transport' }),
  ];

  it('заметная доля месяца в категории, которой не было три месяца — находка с долей', () => {
    const out = newCategories([...history(), tx({ occurredOn: '2026-10-05', amountMinor: 30_000, categoryId: 'repair' }), tx({ occurredOn: '2026-10-06', amountMinor: 70_000 })], '2026-10', TODAY, BASE);
    expect(out).toEqual([{ key: 'new:2026-10:repair', categoryId: 'repair', spentMinor: 30_000, sharePercent: 30 }]);
  });

  it('если категория была хоть раз за три месяца — не новая', () => {
    const out = newCategories([...history(), tx({ occurredOn: '2026-10-05', amountMinor: 30_000, categoryId: 'transport' }), tx({ occurredOn: '2026-10-06', amountMinor: 70_000 })], '2026-10', TODAY, BASE);
    expect(out).toEqual([]);
  });

  it('меньше 10% расходов месяца — не показываем', () => {
    const out = newCategories([...history(), tx({ occurredOn: '2026-10-05', amountMinor: 9_999, categoryId: 'repair' }), tx({ occurredOn: '2026-10-06', amountMinor: 90_001 })], '2026-10', TODAY, BASE);
    expect(out).toEqual([]);
    const edge = newCategories([...history(), tx({ occurredOn: '2026-10-05', amountMinor: 10_000, categoryId: 'repair' }), tx({ occurredOn: '2026-10-06', amountMinor: 90_000 })], '2026-10', TODAY, BASE);
    expect(edge.map((e) => e.categoryId)).toEqual(['repair']);
  });

  it('нет истории (расходы были меньше чем в двух прошлых месяцах) — «новым» было бы всё подряд', () => {
    const fresh = [tx({ occurredOn: '2026-09-10', amountMinor: 10_000 }), tx({ occurredOn: '2026-10-05', amountMinor: 30_000, categoryId: 'repair' }), tx({ occurredOn: '2026-10-06', amountMinor: 70_000 })];
    expect(newCategories(fresh, '2026-10', TODAY, BASE)).toEqual([]);
  });

  it('«без категории» новой не бывает; расходы позже сегодняшнего дня и по долгам не считаются', () => {
    const out = newCategories(
      [...history(), tx({ occurredOn: '2026-10-05', amountMinor: 30_000, categoryId: null }), tx({ occurredOn: '2026-10-20', amountMinor: 30_000, categoryId: 'repair' }), tx({ occurredOn: '2026-10-05', amountMinor: 30_000, categoryId: 'loan', debtId: 'd' }), tx({ occurredOn: '2026-10-06', amountMinor: 70_000 })],
      '2026-10',
      TODAY,
      BASE,
    );
    expect(out).toEqual([]);
  });
});

describe('duplicateGroups: возможный дубль', () => {
  const day = (over: Partial<AnomalyTx> = {}) => tx({ occurredOn: '2026-10-12', amountMinor: 1_500, note: 'кофе', ...over });

  it('одинаковые кошелёк, категория, сумма, заметка и день — группа; заметка без регистра и лишних пробелов', () => {
    const a = day({ id: 'a1' });
    const b = day({ id: 'a2', note: '  Кофе ' });
    const out = duplicateGroups([a, b], '2026-10-01', '2026-10-31', BASE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ txIds: ['a1', 'a2'], amountMinor: 1_500, occurredOn: '2026-10-12', walletId: 'w1', categoryId: 'food', note: 'кофе' });
  });

  it('не дубль: другой кошелёк, сумма, категория, заметка или день', () => {
    const rows = [day({ id: 'a' }), day({ id: 'b', walletId: 'w2' }), day({ id: 'c', amountMinor: 1_600 }), day({ id: 'd', categoryId: 'other' }), day({ id: 'e', note: 'чай' }), day({ id: 'f', occurredOn: '2026-10-13' })];
    expect(duplicateGroups(rows, '2026-10-01', '2026-10-31', BASE)).toEqual([]);
  });

  it('по расписанию, долги, удалённые, переводы и другие основные валюты не считаются', () => {
    const rows = [day({ id: 'a' }), day({ id: 'b', recurringRuleId: 'r' }), day({ id: 'c', debtId: 'd' }), day({ id: 'd', deletedAt: 'x' }), day({ id: 'e', kind: 'transfer' }), day({ id: 'f', baseCurrency: 'USD' })];
    expect(duplicateGroups(rows, '2026-10-01', '2026-10-31', BASE)).toEqual([]);
  });

  it('три одинаковых — одна группа из трёх; свежие дни первыми; вне границ не берутся', () => {
    const rows = [day({ id: 'a' }), day({ id: 'b' }), day({ id: 'c' }), day({ id: 'x', occurredOn: '2026-10-14' }), day({ id: 'y', occurredOn: '2026-10-14' }), day({ id: 'o1', occurredOn: '2026-09-30' }), day({ id: 'o2', occurredOn: '2026-09-30' })];
    const out = duplicateGroups(rows, '2026-10-01', '2026-10-31', BASE);
    expect(out.map((g) => g.txIds)).toEqual([['x', 'y'], ['a', 'b', 'c']]);
  });
});

describe('findAnomalies', () => {
  it('собирает три вида; пусто — hasAnomalies ложно', () => {
    expect(hasAnomalies(findAnomalies([], '2026-10', TODAY, BASE))).toBe(false);
    const a = findAnomalies([tx({ occurredOn: '2026-10-12', amountMinor: 1_500, note: 'кофе' }), tx({ occurredOn: '2026-10-12', amountMinor: 1_500, note: 'кофе' })], '2026-10', TODAY, BASE);
    expect(a.dupes).toHaveLength(1);
    expect(hasAnomalies(a)).toBe(true);
  });

  it('прошедший месяц целиком, идущий — по сегодня', () => {
    const rows = [tx({ occurredOn: '2026-10-20', amountMinor: 1_500, note: 'кофе' }), tx({ occurredOn: '2026-10-20', amountMinor: 1_500, note: 'кофе' })];
    expect(findAnomalies(rows, '2026-10', TODAY, BASE).dupes).toEqual([]); // 20 октября ещё не наступило
    expect(findAnomalies(rows, '2026-10', '2026-10-31', BASE).dupes).toHaveLength(1);
  });
});
