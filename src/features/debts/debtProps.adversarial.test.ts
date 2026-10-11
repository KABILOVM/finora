import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Debt, LocalRow, Wallet } from '@/domain/types';
import { addDays, isValidIsoDate } from '@/lib/dates';
import { buildDebtItems, groupDebts, isOwing, nearestDue, overdueCount, remainingByCurrency } from './debtSummary';
import { daysBetween, daysWord, progressPercent } from './debtText';

/** Случайные наборы: чистые расчёты долгов не должны расходиться с «ручным» подсчётом ни на каких данных и в любом часовом поясе. */

describe('даты: сколько дней до срока', () => {
  it('daysBetween согласован с addDays на всех датах 2000–2099 (конец месяца, 29 февраля, смена года)', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }),
        fc.integer({ min: -3000, max: 3000 }),
        (d, n) => {
          const iso = d.toISOString().slice(0, 10);
          if (!isValidIsoDate(iso)) return true;
          const to = addDays(iso, n);
          return daysBetween(iso, to) === n && daysBetween(to, iso) === -n;
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('склонение «день» верно на границах (11–14, 21, 101, 111)', () => {
    const want: Record<number, string> = { 0: 'дней', 1: 'день', 2: 'дня', 4: 'дня', 5: 'дней', 11: 'дней', 12: 'дней', 14: 'дней', 21: 'день', 22: 'дня', 101: 'день', 111: 'дней', 112: 'дней', 1_000_001: 'день' };
    for (const [n, word] of Object.entries(want)) expect(daysWord(Number(n)), String(n)).toBe(word);
  });
});

describe('процент погашения', () => {
  it('всегда 0…100; 100 только когда выплачено всё; до этого не больше 99', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (paid, principal) => {
        const p = progressPercent(paid, principal);
        if (p < 0 || p > 100) return false;
        if (paid >= principal) return p === 100;
        return p <= 99 && (paid > 0 || p === 0);
      }),
      { numRuns: 3000 },
    );
  });
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const wallets = new Map<string, Pick<Wallet, 'currency'>>([
  [uuid(900), { currency: 'TJS' }],
  [uuid(901), { currency: 'USD' }],
]);
const debtArb = fc.record({
  n: fc.integer({ min: 1, max: 12 }),
  direction: fc.constantFrom('lent', 'borrowed'),
  currency: fc.constantFrom('TJS', 'USD'),
  principalMinor: fc.integer({ min: 1, max: 1_000_000 }),
  closed: fc.boolean(),
  archived: fc.boolean(),
  deleted: fc.boolean(),
  dueDay: fc.option(fc.integer({ min: 1, max: 28 }), { nil: null }),
});
const txArb = fc.record({
  debt: fc.integer({ min: 1, max: 12 }),
  wallet: fc.constantFrom(900, 901),
  kind: fc.constantFrom('income', 'expense'),
  amountMinor: fc.integer({ min: 1, max: 600_000 }),
  deleted: fc.boolean(),
});

describe('сводка по долгам', () => {
  it('итоги по валютам равны ручной сумме остатков, группы делят долги без потерь, просрочка и ближайший срок сходятся', () => {
    fc.assert(
      fc.property(fc.array(debtArb, { maxLength: 12 }), fc.array(txArb, { maxLength: 40 }), (ds, ts) => {
        const seen = new Set<number>();
        const debts = ds
          .filter((d) => (seen.has(d.n) ? false : (seen.add(d.n), true)))
          .map(
            (d) =>
              ({
                id: uuid(d.n),
                direction: d.direction,
                counterparty: `D${d.n}`,
                principalMinor: d.principalMinor,
                currency: d.currency,
                openedOn: '2026-10-01',
                dueOn: d.dueDay === null ? null : `2026-10-${String(d.dueDay).padStart(2, '0')}`,
                note: '',
                closedAt: d.closed ? '2026-10-02T00:00:00.000Z' : null,
                archivedAt: d.archived ? '2026-10-02T00:00:00.000Z' : null,
                deletedAt: d.deleted ? '2026-10-02T00:00:00.000Z' : null,
              }) as unknown as LocalRow<Debt>,
          );
        const txs = ts.map(
          (t, i) =>
            ({
              id: uuid(1000 + i),
              kind: t.kind,
              walletId: uuid(t.wallet),
              amountMinor: t.amountMinor,
              occurredOn: '2026-10-05',
              createdAt: `2026-10-05T00:00:${String(i).padStart(2, '0')}`,
              deletedAt: t.deleted ? 'x' : null,
              debtId: uuid(t.debt),
            }) as never,
        );
        const items = buildDebtItems(debts, txs, wallets);
        for (const dir of ['lent', 'borrowed'] as const) {
          const g = groupDebts(items, dir);
          expect(g.active.length + g.closed.length + g.archived.length).toBe(items.filter((i) => i.debt.direction === dir).length);
          const totals = remainingByCurrency(g.active, 'TJS');
          if (!totals.ok) throw new Error('переполнения быть не может');
          const manual = new Map<string, number>();
          for (const it of g.active) if (isOwing(it)) manual.set(it.debt.currency, (manual.get(it.debt.currency) ?? 0) + it.state!.remainingMinor);
          expect(new Map(totals.totals.map((x) => [x.currency, x.minor]))).toEqual(manual);
          for (const x of totals.totals) expect(x.minor).toBeGreaterThan(0);
        }
        const manualLate = items.filter((i) => isOwing(i) && i.debt.dueOn !== null && i.debt.dueOn < '2026-10-15').length;
        expect(overdueCount(items, '2026-10-15')).toBe(manualLate);
        const withDue = items.filter((i) => isOwing(i) && i.debt.dueOn !== null);
        const nearest = nearestDue(items);
        if (withDue.length === 0) expect(nearest).toBeNull();
        else expect(nearest!.debt.dueOn).toBe(withDue.map((c) => c.debt.dueOn!).sort()[0]);
        return true;
      }),
      { numRuns: 800 },
    );
  });
});
