import { describe, expect, it } from 'vitest';
import { FREQUENT_OPS_DAYS, FREQUENT_OPS_LIMIT, frequentOps } from './frequent';

const TODAY = '2026-10-11';

type Row = Parameters<typeof frequentOps>[0][number];

const row = (over: Partial<Row> = {}): Row => ({
  kind: 'expense',
  walletId: 'card',
  categoryId: 'coffee',
  amountMinor: 1500,
  note: 'Кофе',
  occurredOn: '2026-10-05',
  debtId: null,
  recurringRuleId: null,
  fxSource: null,
  deletedAt: null,
  ...over,
});

describe('frequentOps', () => {
  it('одна операция — не частая, две одинаковые — частая', () => {
    expect(frequentOps([row()], TODAY)).toEqual([]);
    const got = frequentOps([row({ occurredOn: '2026-10-01' }), row({ occurredOn: '2026-10-05' })], TODAY);
    expect(got).toEqual([{ kind: 'expense', walletId: 'card', categoryId: 'coffee', amountMinor: 1500, note: 'Кофе', count: 2, lastOn: '2026-10-05' }]);
  });

  it('другая сумма, кошелёк, категория или вид — другая операция', () => {
    const rows = [
      row(),
      row({ amountMinor: 2000 }),
      row({ walletId: 'cash' }),
      row({ categoryId: 'food' }),
      row({ kind: 'income' }),
    ];
    expect(frequentOps(rows, TODAY)).toEqual([]);
  });

  it('заметка сравнивается без учёта регистра и лишних пробелов; показывается последняя', () => {
    const got = frequentOps([row({ note: 'кофе  с  собой ', occurredOn: '2026-10-01' }), row({ note: 'Кофе с собой', occurredOn: '2026-10-09' })], TODAY);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ count: 2, note: 'Кофе с собой', lastOn: '2026-10-09' });
  });

  it('пустая заметка и пустая категория тоже группируются', () => {
    const got = frequentOps([row({ note: '', categoryId: null }), row({ note: '  ', categoryId: null })], TODAY);
    expect(got).toMatchObject([{ categoryId: null, note: '', count: 2 }]);
  });

  it('не считаются: удалённые, переводы, долги, регулярные, корректировки, будущее и старше окна', () => {
    const junk: Row[] = [
      row({ deletedAt: '2026-10-02T00:00:00.000Z' }),
      row({ kind: 'transfer' }),
      row({ debtId: 'd1' }),
      row({ recurringRuleId: 'r1' }),
      row({ fxSource: 'adjust' }),
      row({ occurredOn: '2026-10-12' }),
      row({ occurredOn: '2026-07-11' }), // 92 дня назад
    ];
    // каждая «лишняя» запись в паре с одной настоящей: вместе набрались бы две, но в счёт идёт только настоящая
    for (const j of junk) expect(frequentOps([row(), j], TODAY)).toEqual([]);
  });

  it('граница окна включена: ровно FREQUENT_OPS_DAYS дней назад ещё считается', () => {
    expect(FREQUENT_OPS_DAYS).toBe(90);
    expect(frequentOps([row({ occurredOn: '2026-07-13' }), row({ occurredOn: '2026-07-14' })], TODAY)).toHaveLength(1);
    expect(frequentOps([row({ occurredOn: '2026-07-12' }), row({ occurredOn: '2026-07-14' })], TODAY)).toHaveLength(0);
  });

  it('порядок: чаще — выше, при равенстве свежее — выше, и не зависит от порядка входа', () => {
    const a = [row({ note: 'A', occurredOn: '2026-10-01' }), row({ note: 'A', occurredOn: '2026-10-02' })];
    const b = [row({ note: 'B', occurredOn: '2026-10-03' }), row({ note: 'B', occurredOn: '2026-10-04' })];
    const c = [row({ note: 'C', occurredOn: '2026-09-01' }), row({ note: 'C', occurredOn: '2026-09-02' }), row({ note: 'C', occurredOn: '2026-09-03' })];
    const forward = frequentOps([...a, ...b, ...c], TODAY).map((x) => x.note);
    expect(forward).toEqual(['C', 'B', 'A']);
    expect(frequentOps([...c, ...b, ...a], TODAY).map((x) => x.note)).toEqual(forward);
    expect(frequentOps([...b, ...a, ...c].reverse(), TODAY).map((x) => x.note)).toEqual(forward);
  });

  it('показывает не больше FREQUENT_OPS_LIMIT', () => {
    const rows = Array.from({ length: FREQUENT_OPS_LIMIT + 3 }, (_, i) => [row({ note: `N${i}` }), row({ note: `N${i}` })]).flat();
    expect(frequentOps(rows, TODAY)).toHaveLength(FREQUENT_OPS_LIMIT);
    expect(frequentOps(rows, TODAY, 2)).toHaveLength(2);
  });
});
