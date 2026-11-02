import { describe, expect, it } from 'vitest';
import type { DailyTx } from '@/domain/dailyAverage';
import { buildDailyStats, type DailyCategory } from './dailyStats';

const FOOD = 'cat-food';
const CAFE = 'cat-cafe'; // подкатегория еды
const TAXI = 'cat-taxi';
const TECH = 'cat-tech';

const cat = (id: string, name: string, over: Partial<DailyCategory> = {}): DailyCategory => ({
  id,
  name,
  icon: '📦',
  color: '#000000',
  parentId: null,
  daily: 0,
  dailyLimitMinor: null,
  archivedAt: null,
  deletedAt: null,
  ...over,
});
const tx = (occurredOn: string, minor: number, categoryId: string | null = FOOD, over: Partial<DailyTx> = {}): DailyTx => ({
  kind: 'expense',
  categoryId,
  baseCurrency: 'TJS',
  baseAmountMinor: minor,
  occurredOn,
  deletedAt: null,
  debtId: null,
  recurringRuleId: null,
  ...over,
});
const som = (n: number) => n * 100;
const TODAY = '2026-11-10';
const build = (txs: DailyTx[], categories: DailyCategory[], tripRanges: { firstOn: string; lastOn: string }[] = []) =>
  buildDailyStats({ txs, categories, today: TODAY, base: 'TJS', tripRanges });

describe('buildDailyStats', () => {
  it('нет ни одной ежедневной категории — hasDaily = false, но «все расходы» считаются', () => {
    const s = build([tx('2026-11-01', som(10))], [cat(FOOD, 'Еда')]);
    expect(s.hasDaily).toBe(false);
    expect(s.lines).toEqual([]);
    expect(s.total.limitPerDayMinor).toBeNull();
    expect(s.everything.month.totalMinor).toBe(som(10));
    expect(s.total.month.totalMinor).toBe(0);
  });

  it('общий лимит — сумма лимитов, когда он есть у каждой головной категории; подкатегория в сумму не входит второй раз', () => {
    const cats = [
      cat(FOOD, 'Еда', { daily: 1, dailyLimitMinor: som(40) }),
      cat(CAFE, 'Кафе', { daily: 1, dailyLimitMinor: som(15), parentId: FOOD }), // подлимит внутри «Еды»
      cat(TAXI, 'Такси', { daily: 1, dailyLimitMinor: som(100) }),
    ];
    const s = build([tx('2026-11-01', som(1))], cats);
    expect(s.total.limitPerDayMinor).toBe(som(140));
    expect(s.headsWithoutLimit).toBe(0);
    expect(s.lines.map((l) => l.name).sort()).toEqual(['Еда', 'Кафе', 'Такси']);
  });

  it('если у головной категории нет лимита — общего лимита нет и сказано, сколько таких', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1, dailyLimitMinor: som(40) }), cat(TAXI, 'Такси', { daily: 1 })];
    const s = build([tx('2026-11-01', som(1))], cats);
    expect(s.total.limitPerDayMinor).toBeNull();
    expect(s.total.plan).toBeNull();
    expect(s.headsWithoutLimit).toBe(1);
  });

  it('крупная покупка без флажка не попадает в ежедневные, но видна в «все расходы»', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1 }), cat(TECH, 'Техника')];
    const s = build([tx('2026-11-01', som(30)), tx('2026-11-05', som(3000), TECH)], cats);
    expect(s.total.month.totalMinor).toBe(som(30));
    expect(s.everything.month.totalMinor).toBe(som(3030));
  });

  it('подкатегория ежедневной категории считается ежедневной сама', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1 }), cat(CAFE, 'Кафе', { parentId: FOOD })];
    const s = build([tx('2026-11-02', som(20), CAFE)], cats);
    expect(s.total.month.totalMinor).toBe(som(20));
    expect(s.lines).toHaveLength(1); // строка только у категории с собственным флажком
    expect(s.lines[0]!.month.totalMinor).toBe(som(20));
  });

  it('строки: сначала хуже всех (накопленный перерасход), потом в норме, потом без лимита', () => {
    const cats = [
      cat(FOOD, 'Еда', { daily: 1, dailyLimitMinor: som(40) }), // план за 10 дней 400, потрачено 500 → перерасход
      cat(TAXI, 'Такси', { daily: 1, dailyLimitMinor: som(100) }), // тратит больше в день (60 против 50), но план 1000 → в норме
      cat(CAFE, 'Кафе', { daily: 1 }), // без лимита
    ];
    const txs = [tx('2026-11-01', som(500)), tx('2026-11-03', som(600), TAXI), tx('2026-11-04', som(900), CAFE)];
    const s = build(txs, cats);
    expect(s.lines.map((l) => l.name)).toEqual(['Еда', 'Такси', 'Кафе']);
    expect(s.lines[0]!.plan).toMatchObject({ kind: 'plan', status: 'over' });
    expect(s.lines[1]!.plan).toMatchObject({ kind: 'plan', status: 'ok' });
    expect(s.lines[2]!.plan).toBeNull();
  });

  it('архивная и удалённая категории строк не дают, а её прошлые траты в ежедневные входят (архивная)', () => {
    const cats = [
      cat(FOOD, 'Еда', { daily: 1 }),
      cat(TAXI, 'Такси', { daily: 1, archivedAt: '2026-10-01T00:00:00.000Z' }),
      cat('cat-gone', 'Удалена', { daily: 1, deletedAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const s = build([tx('2026-11-02', som(10), TAXI), tx('2026-11-02', som(5), 'cat-gone')], cats);
    expect(s.lines.map((l) => l.name)).toEqual(['Еда']);
    expect(s.total.month.totalMinor).toBe(som(10)); // архивная ещё учитывается, удалённая нет
  });

  it('поездка: её дни не идут в среднее и не копят план; сегодня в поездке — план недоступен', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1, dailyLimitMinor: som(40) })];
    const txs = [tx('2026-11-01', som(10)), tx('2026-11-04', som(900))];
    const s = build(txs, cats, [{ firstOn: '2026-11-03', lastOn: '2026-11-06' }]);
    expect(s.lines[0]!.month.skippedDays).toBe(4);
    expect(s.lines[0]!.month.totalMinor).toBe(som(10));
    const inTrip = build(txs, cats, [{ firstOn: '2026-11-09', lastOn: '2026-11-12' }]);
    expect(inTrip.lines[0]!.plan).toEqual({ kind: 'unavailable', reason: 'trip' });
  });

  it('метка поездки, забытая на годы, расчёт не роняет', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1 })];
    expect(() => build([tx('2026-11-01', som(10))], cats, [{ firstOn: '2023-01-01', lastOn: '2026-11-10' }])).not.toThrow();
  });

  it('операции старше окна не нужны для периодов, но начало истории они определяют', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1 })];
    const old = tx('2020-01-01', som(1));
    const s = build([old, tx('2026-11-09', som(50))], cats);
    expect(s.lines[0]!.last30.days).toBe(30); // история давно началась — все 30 дней считаются
    expect(s.lines[0]!.last30.totalMinor).toBe(som(50));
    const fresh = build([tx('2026-11-09', som(50))], cats);
    expect(fresh.lines[0]!.last30.days).toBe(2); // первая запись 9-го: считаем 9-е и 10-е
  });

  it('суммы, не помещающиеся в безопасное целое, — RangeError', () => {
    const cats = [cat(FOOD, 'Еда', { daily: 1, dailyLimitMinor: Number.MAX_SAFE_INTEGER }), cat(TAXI, 'Такси', { daily: 1, dailyLimitMinor: 5 })];
    expect(() => build([tx('2026-11-01', 1)], cats)).toThrow(RangeError);
  });
});
