import { describe, expect, it } from 'vitest';
import { emptyFilters, pruneFilters } from '@/components/filters/filterState';
import type { BudgetProgress } from '@/domain/budgetProgress';
import { budgetFilterFields, filterBudgets, levelBucket, TOTAL_LIMIT } from './budgetFilters';

type Compared = Extract<BudgetProgress, { comparable: true }>;
const cmp = (id: string, categoryId: string | null, level: Compared['level']): Compared => ({
  comparable: true,
  id,
  categoryId,
  limitMinor: 1000,
  currency: 'TJS',
  spentMinor: 0,
  percent: 0,
  level,
  remainingMinor: 1000,
  overMinor: 0,
});
const foreign = (id: string, categoryId: string | null): BudgetProgress => ({ comparable: false, id, categoryId, limitMinor: 1000, currency: 'USD' });

const cats = new Map([
  ['food', { name: 'Еда', icon: '🍎', color: '#f97316' }],
  ['fun', { name: 'Развлечения', icon: '🎬', color: '#f97316' }],
  ['auto', { name: 'Авто', icon: '🚗', color: '#f97316' }],
]);

const budgets = [
  { id: 'b0', categoryId: null },
  { id: 'b1', categoryId: 'food' },
  { id: 'b2', categoryId: 'fun' },
  { id: 'b3', categoryId: 'auto' },
];
const progress = new Map<string, BudgetProgress>([
  ['b0', cmp('b0', null, 'warn')],
  ['b1', cmp('b1', 'food', 'ok')],
  ['b2', cmp('b2', 'fun', 'over')],
  ['b3', cmp('b3', 'auto', 'danger')],
]);

describe('фильтры бюджетов', () => {
  it('levelBucket: «почти исчерпан» — тоже «Внимание», как в сводке; другая валюта — отдельно', () => {
    expect(levelBucket(cmp('x', null, 'ok'))).toBe('ok');
    expect(levelBucket(cmp('x', null, 'warn'))).toBe('warn');
    expect(levelBucket(cmp('x', null, 'danger'))).toBe('warn');
    expect(levelBucket(cmp('x', null, 'over'))).toBe('over');
    expect(levelBucket(foreign('x', null))).toBe('other');
  });

  it('поля: категории только с лимитом (общий первым, остальные по алфавиту), уровни — три основных', () => {
    const fields = budgetFilterFields(budgets, progress, cats);
    expect(fields.map((f) => f.key)).toEqual(['category', 'level']);
    expect(fields[0]?.options.map((o) => o.label)).toEqual(['Все расходы', 'Авто', 'Еда', 'Развлечения']);
    expect(fields[0]?.options[0]?.value).toBe(TOTAL_LIMIT);
    expect(fields[1]?.options.map((o) => o.label)).toEqual(['В норме', 'Внимание', 'Исчерпано']);
  });

  it('«В другой валюте» появляется, только когда такой лимит есть', () => {
    const withForeign = new Map(progress).set('b1', foreign('b1', 'food'));
    const level = budgetFilterFields(budgets, withForeign, cats).find((f) => f.key === 'level');
    expect(level?.options.map((o) => o.label)).toContain('В другой валюте');
  });

  it('меньше двух лимитов — фильтровать нечего; одна категория — нет поля категорий', () => {
    expect(budgetFilterFields([budgets[1]!], progress, cats)).toEqual([]);
    expect(budgetFilterFields([], progress, cats)).toEqual([]);
    const two = [
      { id: 'b1', categoryId: 'food' },
      { id: 'b9', categoryId: 'food' },
    ];
    expect(budgetFilterFields(two, progress, cats).map((f) => f.key)).toEqual(['level']);
  });

  it('удалённая категория лимита называется «Категория удалена», а не пропадает', () => {
    const fields = budgetFilterFields([{ id: 'b1', categoryId: 'gone' }, budgets[0]!], progress, cats);
    expect(fields[0]?.options.map((o) => o.label)).toEqual(['Все расходы', 'Категория удалена']);
  });

  it('filterBudgets: пустой выбор — все по порядку; по категории, по общему лимиту, по уровню, вместе', () => {
    const ids = (v: Record<string, string>) => filterBudgets(budgets, progress, v).map((b) => b.id);
    expect(ids({})).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(ids({ category: 'food' })).toEqual(['b1']);
    expect(ids({ category: TOTAL_LIMIT })).toEqual(['b0']);
    expect(ids({ level: 'warn' })).toEqual(['b0', 'b3']);
    expect(ids({ level: 'over' })).toEqual(['b2']);
    expect(ids({ category: 'food', level: 'over' })).toEqual([]);
  });

  it('лимит без расчёта не проходит фильтр по уровню, но проходит без него', () => {
    const noProgress = new Map<string, BudgetProgress>();
    expect(filterBudgets(budgets, noProgress, { level: 'ok' })).toEqual([]);
    expect(filterBudgets(budgets, noProgress, {})).toHaveLength(4);
  });

  it('выбранная категория, лимит на которую убрали, сбрасывается в «любую» (список не остаётся пустым без причины)', () => {
    const fields = budgetFilterFields([budgets[0]!, budgets[1]!], progress, cats);
    const pruned = pruneFilters(fields, { category: 'fun', level: 'ok' });
    expect(pruned).toEqual({ category: '', level: 'ok' });
    expect(emptyFilters(fields)).toEqual({ category: '', level: '' });
  });
});
