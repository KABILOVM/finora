import { describe, expect, it } from 'vitest';
import { budgetLevelsOf, categoryCovers, levelOf, percentOf, type LevelBudget, type LevelTx } from './budgetLevels';

const FOOD = 'cat-food';
const CAFE = 'cat-cafe';
const BUS = 'cat-bus';
const PARENTS = new Map<string, string | null>([
  [FOOD, null],
  [CAFE, FOOD],
  [BUS, null],
]);
const budget = (id: string, categoryId: string | null, amountMinor = 1000, currency = 'TJS'): LevelBudget => ({ id, categoryId, amountMinor, currency });
const tx = (over: Partial<LevelTx> = {}): LevelTx => ({ kind: 'expense', categoryId: FOOD, debtId: null, baseCurrency: 'TJS', baseAmountMinor: 100, ...over });
const run = (budgets: LevelBudget[], txs: LevelTx[], base = 'TJS') => budgetLevelsOf({ budgets, txs, parentOf: PARENTS, base });
const pct = (budgets: LevelBudget[], txs: LevelTx[]) => run(budgets, txs).map((r) => r.percent);

describe('percentOf, levelOf, categoryCovers', () => {
  it('проценты вниз, пороги 70 / 90 / 100', () => {
    expect([percentOf(699, 1000), percentOf(700, 1000), percentOf(1999, 1000)]).toEqual([69, 70, 199]);
    expect([0, 69, 70, 89, 90, 99, 100, 250].map(levelOf)).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'danger', 'over', 'over']);
  });
  it('мусорные суммы — 0 процентов', () => {
    expect([percentOf(0, 1000), percentOf(-5, 1000), percentOf(5, 0), percentOf(1.5, 10), percentOf(Number.NaN, 10)]).toEqual([0, 0, 0, 0, 0]);
  });
  it('категория охватывает себя и потомков; петля в данных не зависает', () => {
    expect(categoryCovers(FOOD, FOOD, PARENTS)).toBe(true);
    expect(categoryCovers(FOOD, CAFE, PARENTS)).toBe(true);
    expect(categoryCovers(CAFE, FOOD, PARENTS)).toBe(false);
    expect(categoryCovers(BUS, CAFE, PARENTS)).toBe(false);
    expect(categoryCovers(FOOD, null, PARENTS)).toBe(false);
    const loop = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);
    expect(categoryCovers('x', 'a', loop)).toBe(false);
  });
});

describe('budgetLevelsOf: что считается тратой', () => {
  it('общий лимит — все расходы, лимит категории — её и подкатегории; доходы не считаются', () => {
    const txs = [tx({ categoryId: FOOD, baseAmountMinor: 300 }), tx({ categoryId: CAFE, baseAmountMinor: 200 }), tx({ categoryId: BUS, baseAmountMinor: 100 }), tx({ kind: 'income', categoryId: null, baseAmountMinor: 9999 })];
    expect(pct([budget('all', null), budget('food', FOOD), budget('cafe', CAFE), budget('bus', BUS)], txs)).toEqual([60, 50, 20, 10]);
  });
  it('операции по долгам не входят; «без категории» — только в общий лимит', () => {
    const txs = [tx({ debtId: 'debt-1', baseAmountMinor: 900 }), tx({ categoryId: null, baseAmountMinor: 100 })];
    expect(pct([budget('all', null), budget('food', FOOD)], txs)).toEqual([10, 0]);
  });
  it('комиссия перевода — расход общего лимита; перевод без комиссии и в другой валюте не считается', () => {
    const txs = [
      tx({ kind: 'transfer', categoryId: null, baseAmountMinor: 50 }),
      tx({ kind: 'transfer', categoryId: null, baseAmountMinor: 0 }),
      tx({ kind: 'transfer', categoryId: null, baseAmountMinor: 500, baseCurrency: 'USD' }),
    ];
    expect(pct([budget('all', null), budget('food', FOOD)], txs)).toEqual([5, 0]);
  });
  it('снимок в другой валюте пропускается; лимит в другой валюте не проверяется вовсе', () => {
    expect(pct([budget('all', null)], [tx({ baseAmountMinor: 500, baseCurrency: 'USD' })])).toEqual([0]);
    expect(run([budget('usd', null, 1000, 'USD'), budget('all', null)], [tx({ baseAmountMinor: 500 })]).map((r) => r.id)).toEqual(['all']);
  });
  it('лимит 0 или дробный пропускается; пустой набор — нет строк', () => {
    expect(run([budget('zero', null, 0), budget('frac', null, 10.5)], [tx()])).toEqual([]);
    expect(run([], [tx()])).toEqual([]);
  });
  it('границы процента: 69 → ok, 70 → warn, 90 → danger, 100 → over', () => {
    const level = (spent: number) => run([budget('b', null, 1000)], [tx({ baseAmountMinor: spent })])[0]?.level;
    expect([level(699), level(700), level(899), level(900), level(999), level(1000), level(5000)]).toEqual(['ok', 'warn', 'warn', 'danger', 'danger', 'over', 'over']);
  });
  it('суммы около 1e15 не переполняются: BigInt (в приложении это ошибка «слишком велика», здесь — просто уровень)', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const txs = [tx({ baseAmountMinor: big }), tx({ baseAmountMinor: big }), tx({ baseAmountMinor: big })];
    const [row] = run([budget('b', null, 1e15)], txs);
    expect(row?.level).toBe('over');
    expect(row?.percent).toBe(Number((BigInt(big) * 3n * 100n) / 10n ** 15n));
  });
  it('не целая сумма операции пропускается, остальное считается', () => {
    expect(pct([budget('all', null)], [tx({ baseAmountMinor: 1.5 }), tx({ baseAmountMinor: 100 })])).toEqual([10]);
  });
});
