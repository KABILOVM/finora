import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crossedThresholds, type LevelMap } from './budgetAlerts';
import { levelOf, percentOf, type BudgetLevel, type BudgetProgress } from './budgetProgress';

const LIMIT = 100_000;
/** Прогресс бюджета с заданной суммой трат (как его считает computeBudgetProgress для лимита 1 000 с.). */
const progress = (id: string, spentMinor: number, over: Partial<Extract<BudgetProgress, { comparable: true }>> = {}): BudgetProgress => {
  const percent = percentOf(spentMinor, LIMIT);
  return {
    id,
    categoryId: `cat-${id}`,
    limitMinor: LIMIT,
    currency: 'TJS',
    comparable: true,
    spentMinor,
    percent,
    level: levelOf(percent),
    remainingMinor: Math.max(0, LIMIT - spentMinor),
    overMinor: Math.max(0, spentMinor - LIMIT),
    ...over,
  };
};
const levels = (...pairs: [string, 'ok' | 'warn' | 'danger' | 'over'][]): LevelMap => new Map(pairs);

describe('crossedThresholds', () => {
  it('первая проверка (previous = null) — молча запоминает уровни', () => {
    const r = crossedThresholds(null, [progress('a', 120_000), progress('b', 75_000)]);
    expect(r.alerts).toEqual([]);
    expect([...r.next]).toEqual([['a', 'over'], ['b', 'warn']]);
  });

  it('ok → warn на 70%: подсказка с процентом и остатком; 69% ещё нет', () => {
    expect(crossedThresholds(levels(['a', 'ok']), [progress('a', 69_999)]).alerts).toEqual([]);
    const r = crossedThresholds(levels(['a', 'ok']), [progress('a', 70_000)]);
    expect(r.alerts).toEqual([{ budgetId: 'a', categoryId: 'cat-a', level: 'warn', percent: 70, remainingMinor: 30_000, overMinor: 0, currency: 'TJS' }]);
  });

  it('границы 90% и 100%', () => {
    expect(crossedThresholds(levels(['a', 'warn']), [progress('a', 89_999)]).alerts).toEqual([]);
    expect(crossedThresholds(levels(['a', 'warn']), [progress('a', 90_000)]).alerts[0]).toMatchObject({ level: 'danger', percent: 90 });
    expect(crossedThresholds(levels(['a', 'danger']), [progress('a', 99_999)]).alerts).toEqual([]);
    expect(crossedThresholds(levels(['a', 'danger']), [progress('a', 100_000)]).alerts[0]).toMatchObject({ level: 'over', remainingMinor: 0, overMinor: 0 });
    expect(crossedThresholds(levels(['a', 'danger']), [progress('a', 145_000)]).alerts[0]).toMatchObject({ level: 'over', overMinor: 45_000, percent: 145 });
  });

  it('перескочили через уровни (ok → over): одна подсказка — про самый высокий', () => {
    const r = crossedThresholds(levels(['a', 'ok']), [progress('a', 130_000)]);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]!.level).toBe('over');
  });

  it('уровень не изменился или упал — тишина; упавший уровень запоминается, и новый подъём снова скажет', () => {
    expect(crossedThresholds(levels(['a', 'danger']), [progress('a', 95_000)]).alerts).toEqual([]);
    const down = crossedThresholds(levels(['a', 'over']), [progress('a', 50_000)]);
    expect(down.alerts).toEqual([]);
    expect(down.next.get('a')).toBe('ok');
    expect(crossedThresholds(down.next, [progress('a', 75_000)]).alerts).toHaveLength(1);
  });

  it('новый бюджет (раньше его не было) — молча, даже если он уже на 90%', () => {
    const r = crossedThresholds(levels(['a', 'ok']), [progress('a', 10_000), progress('b', 95_000)]);
    expect(r.alerts).toEqual([]);
    expect(r.next.get('b')).toBe('danger');
  });

  it('бюджет в другой валюте не проверяется и в next не попадает', () => {
    const foreign: BudgetProgress = { id: 'f', categoryId: null, limitMinor: 1000, currency: 'USD', comparable: false };
    const r = crossedThresholds(levels(['a', 'ok']), [foreign, progress('a', 10_000)]);
    expect(r.alerts).toEqual([]);
    expect(r.next.has('f')).toBe(false);
  });

  it('удалённый бюджет из next уходит; вернётся — как новый (молча)', () => {
    const r = crossedThresholds(levels(['a', 'warn'], ['gone', 'over']), [progress('a', 75_000)]);
    expect([...r.next.keys()]).toEqual(['a']);
  });

  it('несколько сразу: тяжёлые первыми; при равенстве — больший процент', () => {
    const r = crossedThresholds(levels(['a', 'ok'], ['b', 'ok'], ['c', 'ok']), [progress('a', 75_000), progress('b', 120_000), progress('c', 95_000)]);
    expect(r.alerts.map((a) => a.budgetId)).toEqual(['b', 'c', 'a']);
  });

  it('общий лимит (categoryId: null) тоже проверяется', () => {
    const r = crossedThresholds(levels(['t', 'ok']), [progress('t', 80_000, { categoryId: null })]);
    expect(r.alerts[0]).toMatchObject({ budgetId: 't', categoryId: null });
  });

  it('свойство: подсказка ровно тогда, когда уровень вырос и стал не «ok»; next всегда равен текущим уровням', () => {
    const rank = { ok: 0, warn: 1, danger: 2, over: 3 } as const;
    fc.assert(
      fc.property(
        fc.array(fc.record({ before: fc.integer({ min: 0, max: 200_000 }), now: fc.integer({ min: 0, max: 200_000 }) }), { maxLength: 8 }),
        (rows) => {
          const prev = new Map<string, BudgetLevel>(rows.map((r, i) => [`b${i}`, levelOf(percentOf(r.before, LIMIT))]));
          const items = rows.map((r, i) => progress(`b${i}`, r.now));
          const { alerts, next } = crossedThresholds(prev, items);
          const expected = items.filter((p) => p.comparable && p.level !== 'ok' && rank[p.level] > rank[prev.get(p.id)!]);
          expect(new Set(alerts.map((a) => a.budgetId))).toEqual(new Set(expected.map((p) => p.id)));
          for (const p of items) if (p.comparable) expect(next.get(p.id)).toBe(p.level);
        },
      ),
    );
  });
});
