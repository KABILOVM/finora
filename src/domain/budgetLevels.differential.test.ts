import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { summarizeMonth } from '@/db/queries';
import { budgetLevelsOf, type LevelBudget, type LevelTx } from './budgetLevels';
import { computeBudgetProgress, type BudgetLike } from './budgetProgress';

/**
 * Уровни, которые считает серверная функция (budgetLevelsOf), обязаны совпадать с экраном «Бюджеты»
 * (summarizeMonth → computeBudgetProgress) на любых данных: иначе пуш скажет одно, а приложение — другое.
 */

const CATS = ['c0', 'c1', 'c2', 'c3', 'c4'];
const BASES = ['TJS', 'USD'];
const MONTH = '2026-10';

const txArb = fc.record({
  kind: fc.constantFrom('expense', 'expense', 'expense', 'income', 'transfer'),
  categoryId: fc.option(fc.constantFrom(...CATS), { nil: null }),
  debt: fc.boolean(),
  deleted: fc.boolean(),
  baseCurrency: fc.constantFrom('TJS', 'TJS', 'TJS', 'USD'),
  amount: fc.oneof(fc.integer({ min: 0, max: 50_000 }), fc.constantFrom(0, 1, 69, 70, 89, 90, 99, 100, 700, 900, 1000)),
  inMonth: fc.boolean(),
});
const budgetArb = fc.record({
  categoryId: fc.option(fc.constantFrom(...CATS), { nil: null }),
  amountMinor: fc.oneof(fc.integer({ min: 1, max: 100_000 }), fc.constantFrom(1, 10, 100, 1000)),
  currency: fc.constantFrom('TJS', 'TJS', 'USD'),
});
// родитель каждой категории: другая категория или никто (допускаются петли: данные могут быть неисправны)
const parentsArb = fc.array(fc.option(fc.constantFrom(...CATS), { nil: null }), { minLength: CATS.length, maxLength: CATS.length });

describe('budgetLevelsOf == экран «Бюджеты» (summarizeMonth + computeBudgetProgress)', () => {
  it('случайные операции, категории с вложенностью и лимиты: проценты и уровни одинаковы', () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 40 }), fc.array(budgetArb, { maxLength: 6 }), parentsArb, fc.constantFrom(...BASES), (rawTxs, rawBudgets, parents, base) => {
        const parentOf = new Map<string, string | null>(CATS.map((c, i) => [c, parents[i] === c ? null : (parents[i] ?? null)]));
        const live = rawTxs.filter((t) => !t.deleted);
        const budgets: LevelBudget[] = rawBudgets.map((b, i) => ({ id: `b${i}`, ...b }));
        const txs: LevelTx[] = live
          .filter((t) => t.inMonth)
          .map((t) => ({ kind: t.kind, categoryId: t.kind === 'transfer' ? null : t.categoryId, debtId: t.debt && t.kind !== 'transfer' ? 'debt-1' : null, baseCurrency: t.baseCurrency, baseAmountMinor: t.amount }));

        const server = budgetLevelsOf({ budgets, txs, parentOf, base });

        const clientTxs = rawTxs.map((t, i) => ({
          id: `t${i}`,
          kind: t.kind as 'expense' | 'income' | 'transfer',
          walletId: 'w1',
          toWalletId: t.kind === 'transfer' ? 'w2' : null,
          categoryId: t.kind === 'transfer' ? null : t.categoryId,
          occurredOn: t.inMonth ? `${MONTH}-10` : '2026-09-10',
          note: '',
          createdAt: '2026-10-01T00:00:00.000Z',
          deletedAt: t.deleted ? '2026-10-02T00:00:00.000Z' : null,
          debtId: t.debt && t.kind !== 'transfer' ? 'debt-1' : null,
          baseCurrency: t.baseCurrency,
          baseAmountMinor: t.amount,
        }));
        const summary = summarizeMonth(clientTxs, MONTH, base);
        const likes: BudgetLike[] = budgets.map((b) => ({ ...b, archivedAt: null, deletedAt: null }));
        const res = computeBudgetProgress({ budgets: likes, byCategory: summary.byCategory, expenseMinor: summary.expenseMinor, parentOf, base });
        if (!res.ok) return; // переполнение на клиенте при таких суммах невозможно; на всякий случай
        const client = res.items.flatMap((p) => (p.comparable ? [{ id: p.id, categoryId: p.categoryId, percent: p.percent, level: p.level }] : []));
        expect(server).toEqual(client);
      }),
      { numRuns: 400 },
    );
  });
});
