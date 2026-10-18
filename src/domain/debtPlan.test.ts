import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeDebtState,
  DEBT_PLAN_STOP_TEXT,
  debtPlanStop,
  debtTxRole,
  isLivePlanOf,
  type DebtPlanStop,
  type DebtTx,
} from './debts';
import type { CurrencyCode, Debt, RecurringRule, TxKind, UUID } from './types';

/**
 * План «Платить частями» и роль операции в долге: чистые функции над правилом, долгом и остатком.
 * «Мне должны» (lent): платёж — доход, выдача — расход. «Я должен» (borrowed): платёж — расход, получение — доход.
 */

const STAMP = '2026-10-10T09:00:00.000Z';

type DebtLike = Pick<Debt, 'id' | 'direction' | 'currency' | 'deletedAt' | 'archivedAt' | 'closedAt'>;
const debt = (over: Partial<DebtLike> = {}): DebtLike => ({
  id: 'debt-1',
  direction: 'lent',
  currency: 'TJS',
  deletedAt: null,
  archivedAt: null,
  closedAt: null,
  ...over,
});

type RuleLike = Pick<RecurringRule, 'kind' | 'debtId' | 'deletedAt' | 'archivedAt'>;
/** По умолчанию — живой план долга debt-1 «мне должны»: регулярный доход (возврат) с его debtId. */
const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
  kind: 'income',
  debtId: 'debt-1',
  deletedAt: null,
  archivedAt: null,
  ...over,
});

/** Остаток 3 000,00 — долг не погашен. */
const OPEN = { remainingMinor: 300_000 };

describe('debtPlanStop: почему план платежей по долгу стоит', () => {
  it('живой незакрытый долг с остатком 3 000,00 — план идёт (null)', () => {
    expect(debtPlanStop(rule(), debt(), OPEN)).toBeNull();
    expect(debtPlanStop(rule({ kind: 'expense' }), debt({ direction: 'borrowed' }), OPEN)).toBeNull();
  });

  it('правило без долга (debtId null) не останавливается никогда — даже если долга нет', () => {
    expect(debtPlanStop(rule({ debtId: null }), undefined, null)).toBeNull();
    expect(debtPlanStop(rule({ debtId: null }), debt({ deletedAt: STAMP, closedAt: STAMP }), { remainingMinor: 0 })).toBeNull();
  });

  it('долга нет на устройстве или он удалён — «deleted»', () => {
    expect(debtPlanStop(rule(), undefined, OPEN)).toBe('deleted');
    expect(debtPlanStop(rule(), undefined, null)).toBe('deleted');
    expect(debtPlanStop(rule(), debt({ deletedAt: STAMP }), OPEN)).toBe('deleted');
  });

  it('«deleted» важнее вида правила: удалённый долг останавливает и выдачу по расписанию', () => {
    // выдача для «мне должны» — расход: вид не совпадает с «возвратом», но долга больше нет
    expect(debtPlanStop(rule({ kind: 'expense' }), debt({ deletedAt: STAMP }), OPEN)).toBe('deleted');
    expect(debtPlanStop(rule({ kind: 'transfer' }), undefined, null)).toBe('deleted');
    // и важнее архива, закрытия и погашения
    expect(debtPlanStop(rule(), debt({ deletedAt: STAMP, archivedAt: STAMP, closedAt: STAMP }), { remainingMinor: 0 })).toBe('deleted');
  });

  it('правило другого вида (выдача по расписанию) не останавливается ни архивом, ни закрытием, ни погашением', () => {
    const all = debt({ archivedAt: STAMP, closedAt: STAMP });
    expect(debtPlanStop(rule({ kind: 'expense' }), all, { remainingMinor: 0 })).toBeNull();
    expect(debtPlanStop(rule({ kind: 'transfer' }), all, { remainingMinor: 0 })).toBeNull();
    // «я должен»: платёж — расход, значит доход (получение) — другой вид
    expect(debtPlanStop(rule({ kind: 'income' }), debt({ direction: 'borrowed', closedAt: STAMP }), { remainingMinor: 0 })).toBeNull();
  });

  it('долг в архиве — «archived», и это важнее закрытия и погашения', () => {
    expect(debtPlanStop(rule(), debt({ archivedAt: STAMP }), OPEN)).toBe('archived');
    expect(debtPlanStop(rule(), debt({ archivedAt: STAMP, closedAt: STAMP }), { remainingMinor: 0 })).toBe('archived');
    expect(debtPlanStop(rule(), debt({ archivedAt: STAMP }), null)).toBe('archived');
  });

  it('долг закрыт — «closed», и это важнее погашения', () => {
    expect(debtPlanStop(rule(), debt({ closedAt: STAMP }), OPEN)).toBe('closed');
    expect(debtPlanStop(rule(), debt({ closedAt: STAMP }), { remainingMinor: 0 })).toBe('closed');
    expect(debtPlanStop(rule({ kind: 'expense' }), debt({ direction: 'borrowed', closedAt: STAMP }), null)).toBe('closed');
  });

  it('остаток 0 (или меньше) — «settled»; остаток 0,01 — план ещё идёт', () => {
    expect(debtPlanStop(rule(), debt(), { remainingMinor: 0 })).toBe('settled');
    expect(debtPlanStop(rule(), debt(), { remainingMinor: -500 })).toBe('settled');
    expect(debtPlanStop(rule({ kind: 'expense' }), debt({ direction: 'borrowed' }), { remainingMinor: 0 })).toBe('settled');
    expect(debtPlanStop(rule(), debt(), { remainingMinor: 1 })).toBeNull();
  });

  it('остаток посчитать не удалось (state null) — по остатку не останавливаем', () => {
    expect(debtPlanStop(rule(), debt(), null)).toBeNull();
    expect(debtPlanStop(rule({ kind: 'expense' }), debt({ direction: 'borrowed' }), null)).toBeNull();
  });

  it('у плана другого долга своя судьба: debtId не сверяется — решает переданный долг', () => {
    // вызывающий (stoppedDebtPlans) сам находит долг по rule.debtId; функция смотрит только на то, что ей дали
    expect(debtPlanStop(rule({ debtId: 'debt-2' }), debt({ closedAt: STAMP }), OPEN)).toBe('closed');
  });
});

describe('DEBT_PLAN_STOP_TEXT: подписи остановленного плана', () => {
  it('ровно четыре причины и у каждой своя подпись', () => {
    const want: Record<DebtPlanStop, string> = {
      deleted: 'Долг удалён — план остановлен',
      archived: 'Долг в архиве — план остановлен',
      closed: 'Долг закрыт — план остановлен',
      settled: 'Долг погашен — план остановлен',
    };
    expect(DEBT_PLAN_STOP_TEXT).toEqual(want);
    expect(Object.keys(DEBT_PLAN_STOP_TEXT).sort()).toEqual(['archived', 'closed', 'deleted', 'settled']);
  });

  it('у любой причины, которую вернёт debtPlanStop, подпись есть', () => {
    const cases: [RuleLike, DebtLike | undefined, { remainingMinor: number } | null][] = [
      [rule(), undefined, null],
      [rule(), debt({ archivedAt: STAMP }), OPEN],
      [rule(), debt({ closedAt: STAMP }), OPEN],
      [rule(), debt(), { remainingMinor: 0 }],
    ];
    const got = cases.map(([r, d, s]) => debtPlanStop(r, d, s));
    expect(got).toEqual(['deleted', 'archived', 'closed', 'settled']);
    for (const g of got) expect(DEBT_PLAN_STOP_TEXT[g as DebtPlanStop]).toMatch(/^Долг .+ — план остановлен$/);
  });
});

describe('isLivePlanOf: живой план платежей именно этого долга', () => {
  const lent = { id: 'debt-1', direction: 'lent' as const };
  const borrowed = { id: 'debt-1', direction: 'borrowed' as const };

  it('«мне должны»: регулярный доход с debtId долга, не удалён и не в архиве — живой план', () => {
    expect(isLivePlanOf(rule(), lent)).toBe(true);
  });

  it('«я должен»: живой план — регулярный расход', () => {
    expect(isLivePlanOf(rule({ kind: 'expense' }), borrowed)).toBe(true);
    expect(isLivePlanOf(rule({ kind: 'income' }), borrowed)).toBe(false);
  });

  it('выдача по расписанию (вид как у выдачи) и перевод — не план платежей', () => {
    expect(isLivePlanOf(rule({ kind: 'expense' }), lent)).toBe(false);
    expect(isLivePlanOf(rule({ kind: 'transfer' }), lent)).toBe(false);
  });

  it('правило другого долга или без долга — не план этого долга', () => {
    expect(isLivePlanOf(rule({ debtId: 'debt-2' }), lent)).toBe(false);
    expect(isLivePlanOf(rule({ debtId: null }), lent)).toBe(false);
  });

  it('удалённое или архивное правило — уже не живой план', () => {
    expect(isLivePlanOf(rule({ deletedAt: STAMP }), lent)).toBe(false);
    expect(isLivePlanOf(rule({ archivedAt: STAMP }), lent)).toBe(false);
  });
});

describe('debtTxRole: роль операции в долге', () => {
  const currencies = new Map<UUID, CurrencyCode>([
    ['w-tjs', 'TJS'],
    ['w-usd', 'USD'],
  ]);
  const currencyOf = (id: UUID) => currencies.get(id);
  type TxLike = Parameters<typeof debtTxRole>[1];
  const tx = (over: Partial<TxLike> = {}): TxLike => ({
    id: 'tx-1',
    kind: 'income',
    walletId: 'w-tjs',
    amountMinor: 50_000,
    debtId: 'debt-1',
    ...over,
  });
  const lent = { id: 'debt-1', direction: 'lent' as const, currency: 'TJS' };
  const borrowed = { id: 'debt-1', direction: 'borrowed' as const, currency: 'TJS' };

  it('«мне должны»: доход 500,00 — платёж, расход — выдача или пополнение', () => {
    expect(debtTxRole(lent, tx({ kind: 'income' }), currencyOf)).toBe('payment');
    expect(debtTxRole(lent, tx({ kind: 'expense' }), currencyOf)).toBe('entry');
  });

  it('«я должен»: расход — платёж, доход — получение', () => {
    expect(debtTxRole(borrowed, tx({ kind: 'expense' }), currencyOf)).toBe('payment');
    expect(debtTxRole(borrowed, tx({ kind: 'income' }), currencyOf)).toBe('entry');
  });

  it('кошелёк в другой валюте (USD при долге в TJS) — вне расчёта', () => {
    expect(debtTxRole(lent, tx({ walletId: 'w-usd' }), currencyOf)).toBe('outside');
    expect(debtTxRole(lent, tx({ walletId: 'w-usd', kind: 'expense' }), currencyOf)).toBe('outside');
    // тот же кошелёк при долге в USD — уже платёж
    expect(debtTxRole({ ...lent, currency: 'USD' }, tx({ walletId: 'w-usd' }), currencyOf)).toBe('payment');
  });

  it('валюта берётся по кошельку операции: неизвестный кошелёк — вне расчёта', () => {
    const asked: UUID[] = [];
    const spy = (id: UUID) => {
      asked.push(id);
      return currencies.get(id);
    };
    expect(debtTxRole(lent, tx({ walletId: 'w-gone' }), spy)).toBe('outside');
    expect(asked).toEqual(['w-gone']);
  });

  it('перевод с debtId — вне расчёта', () => {
    expect(debtTxRole(lent, tx({ kind: 'transfer' }), currencyOf)).toBe('outside');
    expect(debtTxRole(borrowed, tx({ kind: 'transfer' }), currencyOf)).toBe('outside');
  });

  it('некорректная сумма (0, минус, дробь, NaN, больше безопасного целого) — вне расчёта', () => {
    for (const amountMinor of [0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(debtTxRole(lent, tx({ amountMinor }), currencyOf), String(amountMinor)).toBe('outside');
    }
    expect(debtTxRole(lent, tx({ amountMinor: 1 }), currencyOf)).toBe('payment');
    expect(debtTxRole(lent, tx({ amountMinor: Number.MAX_SAFE_INTEGER }), currencyOf)).toBe('payment');
  });

  it('операция другого долга или без долга — вне расчёта, даже если по виду и валюте подходит', () => {
    expect(debtTxRole(lent, tx({ debtId: 'debt-2' }), currencyOf)).toBe('outside');
    expect(debtTxRole(lent, tx({ debtId: null }), currencyOf)).toBe('outside');
  });
});

describe('debtTxRole совпадает с computeDebtState', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const WALLETS = [
    { id: 'w-tjs', currency: 'TJS' },
    { id: 'w-usd', currency: 'USD' },
  ];
  const currencyOf = (id: UUID) => WALLETS.find((w) => w.id === id)?.currency;

  const txArb = fc.record({
    debt: fc.constantFrom('debt-1', 'debt-1', 'debt-1', 'debt-2'),
    kind: fc.constantFrom<TxKind>('income', 'expense', 'transfer'),
    wallet: fc.constantFrom('w-tjs', 'w-tjs', 'w-usd', 'w-gone'),
    amountMinor: fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 1, max: 1_000_000 }) },
      { weight: 1, arbitrary: fc.constantFrom(0, -300, 2.5, Number.NaN) },
    ),
    day: fc.integer({ min: 1, max: 28 }),
    deleted: fc.boolean(),
  });

  it('случайные операции долга: «платёж» ровно там, где payments; «выдача» — где entries; «вне расчёта» — где issues', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Debt['direction']>('lent', 'borrowed'),
        fc.constantFrom('TJS', 'USD'),
        fc.array(txArb, { maxLength: 30 }),
        (direction, currency, raw) => {
          const d = { id: 'debt-1', direction, currency, principalMinor: 100_000 };
          const txs: DebtTx[] = raw.map((t, i) => ({
            id: uuid(i + 1),
            kind: t.kind,
            walletId: t.wallet,
            amountMinor: t.amountMinor,
            occurredOn: `2026-10-${String(t.day).padStart(2, '0')}`,
            createdAt: `2026-10-${String(t.day).padStart(2, '0')}T10:00:00.${String(i).padStart(3, '0')}Z`,
            deletedAt: t.deleted ? STAMP : null,
            debtId: t.debt,
          }));
          const state = computeDebtState(d, txs, WALLETS);
          // удалённые операции в расчёт не входят — роль спрашивают только у живых
          const live = txs.filter((t) => t.deletedAt === null);
          const byRole = (role: 'payment' | 'entry' | 'outside') =>
            live.filter((t) => debtTxRole(d, t, currencyOf) === role).map((t) => t.id).sort();
          const mine = new Set(live.filter((t) => t.debtId === d.id).map((t) => t.id));

          expect(byRole('payment')).toEqual(state.payments.map((p) => p.txId).sort());
          expect(byRole('entry')).toEqual(state.entries.map((p) => p.txId).sort());
          // «вне расчёта» у своего долга — это ровно диагностика; операции чужого долга — тоже вне расчёта
          expect(byRole('outside').filter((id) => mine.has(id))).toEqual(state.issues.map((x) => x.txId).sort());
          for (const t of live) if (t.debtId !== d.id) expect(debtTxRole(d, t, currencyOf)).toBe('outside');
        },
      ),
      { numRuns: 500 },
    );
  });
});
