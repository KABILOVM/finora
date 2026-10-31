import { describe, expect, it } from 'vitest';
import { pruneFilters } from '@/components/filters/filterState';
import type { RecurringRule } from '@/domain/types';
import { DEBT_RULES, matchesRuleFilter, NO_CATEGORY, ruleFilterFields } from './ruleFilters';

type R = Pick<RecurringRule, 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'debtId'>;
const r = (over: Partial<R>): R => ({ kind: 'expense', walletId: 'w1', toWalletId: null, categoryId: null, debtId: null, ...over });

const cats = new Map([
  ['rent', { name: 'Жильё', archivedAt: null }],
  ['net', { name: 'Связь', archivedAt: null }],
  ['old', { name: 'Старая', archivedAt: '2026-01-01T00:00:00.000Z' }],
]);
const wallets = new Map([
  ['w1', { name: 'Наличные', archivedAt: null }],
  ['w2', { name: 'Карта', archivedAt: null }],
]);

const rules: R[] = [
  r({ categoryId: 'rent' }),
  r({ categoryId: 'net', walletId: 'w2' }),
  r({ kind: 'income', walletId: 'w2' }),
  r({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' }),
  r({ debtId: 'd1' }),
];

describe('фильтры регулярных платежей', () => {
  it('поля: виды по порядку, категории по алфавиту + «По долгам» и «Без категории», кошельки по алфавиту', () => {
    const fields = ruleFilterFields(rules, cats, wallets);
    expect(fields.map((f) => f.key)).toEqual(['kind', 'category', 'wallet']);
    expect(fields[0]?.options.map((o) => o.label)).toEqual(['Расходы', 'Доходы', 'Переводы']);
    expect(fields[1]?.options.map((o) => o.label)).toEqual(['Жильё', 'Связь', 'По долгам', 'Без категории']);
    expect(fields[2]?.options.map((o) => o.label)).toEqual(['Карта', 'Наличные']);
  });

  it('перевод не даёт «Без категории»: у перевода категорий нет', () => {
    const fields = ruleFilterFields([r({ categoryId: 'rent' }), r({ categoryId: 'net' }), r({ kind: 'transfer', toWalletId: 'w2' })], cats, wallets);
    expect(fields.find((f) => f.key === 'category')?.options.map((o) => o.value)).toEqual(['net', 'rent'].sort((a, b) => (cats.get(a)!.name < cats.get(b)!.name ? -1 : 1)));
  });

  it('архивная и удалённая категории подписаны честно', () => {
    const fields = ruleFilterFields([r({ categoryId: 'old' }), r({ categoryId: 'gone' })], cats, wallets);
    expect(fields.find((f) => f.key === 'category')?.options.map((o) => o.label).sort()).toEqual(['Категория удалена', 'Старая (в архиве)']);
  });

  it('поле с одним вариантом не показывается; без правил полей нет', () => {
    expect(ruleFilterFields([r({ categoryId: 'rent' }), r({ categoryId: 'rent' })], cats, wallets)).toEqual([]);
    expect(ruleFilterFields([], cats, wallets)).toEqual([]);
  });

  it('matchesRuleFilter: вид, категория, «По долгам», «Без категории», кошелёк (для перевода и принимающий)', () => {
    const hit = (v: Record<string, string>) => rules.map((x, i) => (matchesRuleFilter(x, v) ? i : -1)).filter((i) => i >= 0);
    expect(hit({})).toEqual([0, 1, 2, 3, 4]);
    expect(hit({ kind: 'expense' })).toEqual([0, 1, 4]);
    expect(hit({ kind: 'transfer' })).toEqual([3]);
    expect(hit({ category: 'rent' })).toEqual([0]);
    expect(hit({ category: DEBT_RULES })).toEqual([4]);
    expect(hit({ category: NO_CATEGORY })).toEqual([2]);
    expect(hit({ wallet: 'w2' })).toEqual([1, 2, 3]); // перевод идёт НА w2
    expect(hit({ wallet: 'w1', kind: 'expense' })).toEqual([0, 4]);
  });

  it('выбор, которого больше нет среди вариантов, сбрасывается', () => {
    const fields = ruleFilterFields(rules, cats, wallets);
    expect(pruneFilters(fields, { kind: 'expense', category: 'удалённая', wallet: 'w2' })).toEqual({ kind: 'expense', category: '', wallet: 'w2' });
  });
});
