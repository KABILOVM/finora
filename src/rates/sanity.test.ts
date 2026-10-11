// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RateTable } from '@/domain/types';
import { makeTable } from './__fixtures__/testkit';
import { CURRENCIES } from '@/domain/currency';
import { GUARDED_CURRENCIES, MAX_RELATIVE_CHANGE, assessRateTable, pickComparable, withoutCodes } from './sanity';

const prev = makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12, RUB: 0.1 } });
const withUsd = (usd: number) => makeTable({ perUnit: { TJS: 1, USD: usd, EUR: 12, RUB: 0.1 } });

describe('assessRateTable: структура и значения', () => {
  it('нормальная таблица без предыдущей проходит', () => {
    expect(assessRateTable(makeTable())).toEqual({ ok: true, reasons: [] });
    expect(assessRateTable(makeTable(), null)).toEqual({ ok: true, reasons: [] });
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['ноль', 0],
    ['минус', -5],
    ['слишком огромное', 1e12],
    ['слишком крошечное', 1e-12],
    ['строка вместо числа', '10.95' as unknown as number],
    ['null', null as unknown as number],
  ])('значение курса: %s → отказ, причина называет валюту', (_n, bad) => {
    const r = assessRateTable(makeTable({ perUnit: { TJS: 1, USD: bad, EUR: 12 } }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('USD');
  });

  it('отказ и при плохой структуре', () => {
    const cases: RateTable[] = [
      makeTable({ pivot: 'tjs' }),
      makeTable({ pivot: 'TJSX' }),
      makeTable({ perUnit: { TJS: 2, USD: 10 } }), // курс pivot не 1
      makeTable({ perUnit: { USD: 10, EUR: 12 } }), // pivot отсутствует
      makeTable({ perUnit: { TJS: 1 } }), // нет ни одного курса
      makeTable({ perUnit: { TJS: 1, usd: 10 } }), // код не заглавными
      makeTable({ perUnit: { TJS: 1, USDT: 10 } }),
      makeTable({ asOf: '10.10.2026' }),
      makeTable({ asOf: '2026-02-30' }),
      makeTable({ fetchedAt: 'давно' }),
      makeTable({ perUnit: null as unknown as RateTable['perUnit'] }),
      makeTable({ perUnit: [1, 2] as unknown as RateTable['perUnit'] }),
      null as unknown as RateTable,
      'таблица' as unknown as RateTable,
      undefined as unknown as RateTable,
    ];
    for (const c of cases) expect(assessRateTable(c).ok, JSON.stringify(c)).toBe(false);
  });

  it('число причин ограничено', () => {
    const perUnit: Record<string, number> = { TJS: 1 };
    for (let i = 0; i < 200; i++) perUnit[`A${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i / 26) | 0))}`] = -1;
    const r = assessRateTable(makeTable({ perUnit }));
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeLessThanOrEqual(31);
  });
});

describe('assessRateTable: скачок курса относительно предыдущей таблицы', () => {
  it('граница: ровно +50% и −50% проходят, чуть больше — нет', () => {
    expect(MAX_RELATIVE_CHANGE).toBe(0.5);
    expect(assessRateTable(withUsd(15), prev).ok).toBe(true); // +50%
    expect(assessRateTable(withUsd(5), prev).ok).toBe(true); // −50%
    expect(assessRateTable(withUsd(15.0001), prev).ok).toBe(false);
    expect(assessRateTable(withUsd(4.9999), prev).ok).toBe(false);
  });

  it('удвоение, обвал и «лишний ноль» отвергаются; причина показывает старое и новое значение', () => {
    for (const usd of [20, 100, 1, 0.1]) {
      const r = assessRateTable(withUsd(usd), prev);
      expect(r.ok, `USD ${usd}`).toBe(false);
      expect(r.reasons[0]).toContain('USD');
      expect(r.reasons[0]).toContain('10');
    }
    expect(assessRateTable(withUsd(20), prev).reasons[0]).toBe('USD: 10 → 20 (+100%)');
    expect(assessRateTable(withUsd(1), prev).reasons[0]).toBe('USD: 10 → 1 (−90%)');
  });

  it('достаточно скачка ОДНОЙ валюты, чтобы отвергнуть всю таблицу; причины перечисляют все скачки', () => {
    const next = makeTable({ perUnit: { TJS: 1, USD: 10.2, EUR: 40, RUB: 5 } });
    const r = assessRateTable(next, prev);
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons.join(' ')).toContain('EUR');
    expect(r.reasons.join(' ')).toContain('RUB');
  });

  it('обычное дневное колебание (несколько процентов) проходит', () => {
    expect(assessRateTable(makeTable({ perUnit: { TJS: 1, USD: 10.1, EUR: 11.9, RUB: 0.104 } }), prev)).toEqual({ ok: true, reasons: [] });
  });

  it('сравниваются только общие валюты; новые и пропавшие не мешают', () => {
    const next = makeTable({ perUnit: { TJS: 1, USD: 10.1, GBP: 14, EUR: 12 } });
    expect(assessRateTable(next, prev).ok).toBe(true);
  });

  it('нечего сравнивать (общих валют меньше двух) — проходит', () => {
    const next = makeTable({ perUnit: { TJS: 1, GBP: 14 } });
    expect(assessRateTable(next, prev).ok).toBe(true);
  });

  it('таблицы с разными pivot сравниваются через общую валюту: TJS↔USD', () => {
    const tjs = makeTable({ pivot: 'TJS', perUnit: { TJS: 1, USD: 10, EUR: 12 } });
    const okUsd = makeTable({ pivot: 'USD', source: 'api', perUnit: { USD: 1, EUR: 1.2, RUB: 0.01 } });
    expect(assessRateTable(okUsd, tjs).ok).toBe(true);
    const badUsd = makeTable({ pivot: 'USD', source: 'api', perUnit: { USD: 1, EUR: 2.5, RUB: 0.01 } }); // EUR/USD 1.2 → 2.5
    const r = assessRateTable(badUsd, tjs);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toContain('EUR');
    // и в обратную сторону
    expect(assessRateTable(tjs, okUsd).ok).toBe(true);
    expect(assessRateTable(makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 30 } }), okUsd).ok).toBe(false);
  });

  it('общая валюта-«мостик» не опорная ни в одной таблице', () => {
    const a = makeTable({ pivot: 'TJS', perUnit: { TJS: 1, EUR: 12, GBP: 14 } });
    const b = makeTable({ pivot: 'USD', source: 'api', perUnit: { USD: 1, EUR: 1.2, GBP: 1.4 } });
    expect(assessRateTable(b, a).ok).toBe(true);
    expect(assessRateTable(makeTable({ pivot: 'USD', source: 'api', perUnit: { USD: 1, EUR: 1.2, GBP: 4 } }), a).ok).toBe(false);
  });

  it('повреждённая «предыдущая» таблица не блокирует новую (сравнивать не с чем)', () => {
    const broken = makeTable({ perUnit: { TJS: 1, USD: NaN, EUR: 12 } });
    expect(assessRateTable(makeTable(), broken).ok).toBe(true);
  });

  it('свойство: сдвиг одного курса на долю r отвергается тогда и только тогда, когда |r−1| > 0,5', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 8, noNaN: true }), fc.double({ min: 0.001, max: 1000, noNaN: true }), (ratio, base) => {
        fc.pre(Math.abs(Math.abs(ratio - 1) - 0.5) > 1e-6); // у самой границы мешает плавающая точка
        const a = makeTable({ perUnit: { TJS: 1, USD: base, EUR: 12 } });
        const b = makeTable({ perUnit: { TJS: 1, USD: base * ratio, EUR: 12 } });
        expect(assessRateTable(b, a).ok).toBe(Math.abs(ratio - 1) <= 0.5);
      }),
      { numRuns: 500 },
    );
  });

  it('свойство: ни при каком вводе не бросает исключение', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (a, b) => {
        const r = assessRateTable(a as RateTable, b as RateTable);
        expect(typeof r.ok).toBe('boolean');
        expect(Array.isArray(r.reasons)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('assessRateTable: скачок валюты, которой нет в списке приложения', () => {
  const base = makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12, RUB: 0.1, ARS: 0.01, APE: 8 } });
  const next = (over: Record<string, number>) => makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12, RUB: 0.1, ARS: 0.01, APE: 8, ...over } });

  it('список «защищённых» валют совпадает со списком валют приложения (domain/currency.ts)', () => {
    expect([...GUARDED_CURRENCIES].sort()).toEqual(CURRENCIES.map((c) => c.code).sort());
  });

  it('обвал ARS на 75%: таблица принимается, ARS названа в excluded, причина показывает старое и новое', () => {
    const r = assessRateTable(next({ ARS: 0.0025 }), base);
    expect(r.ok).toBe(true);
    expect(r.excluded).toEqual(['ARS']);
    expect(r.reasons).toEqual(['ARS: 0.01 → 0.0025 (−75%)']);
  });

  it('без скачков поля excluded нет вовсе', () => {
    expect('excluded' in assessRateTable(next({ ARS: 0.0101 }), base)).toBe(false);
  });

  it('скачок валюты из списка приложения по-прежнему отвергает всю таблицу, даже если рядом скачок экзотической', () => {
    const r = assessRateTable(next({ ARS: 0.0025, USD: 25 }), base);
    expect(r.ok).toBe(false);
    expect(r.excluded).toBeUndefined();
    expect(r.reasons.join(' ')).toContain('USD');
    expect(r.reasons.join(' ')).toContain('ARS');
  });

  it('скачок у половины и более сравниваемых валют — системная ошибка: отвергается вся таблица, даже если все они экзотические', () => {
    const wide = makeTable({ perUnit: { TJS: 1, ARS: 0.01, APE: 8 } });
    expect(assessRateTable(makeTable({ perUnit: { TJS: 1, ARS: 0.0025, APE: 8 } }), wide).ok).toBe(false); // 1 из 2
    expect(assessRateTable(makeTable({ perUnit: { TJS: 1, ARS: 0.0025, APE: 40 } }), wide).ok).toBe(false); // 2 из 2
    // 2 из 5 — меньшинство
    const five = makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12, ARS: 0.01, APE: 8, BTC: 5 } });
    const r = assessRateTable(makeTable({ perUnit: { TJS: 1, USD: 10, EUR: 12, ARS: 0.0025, APE: 40, BTC: 5 } }), five);
    expect(r.ok).toBe(true);
    expect(r.excluded).toEqual(['ARS', 'APE']);
  });

  it('крипто-монета подорожала на 87% за сутки, фиат не менялся: таблица принимается', () => {
    const r = assessRateTable(next({ APE: 14.96 }), base);
    expect(r.ok).toBe(true);
    expect(r.excluded).toEqual(['APE']);
  });

  it('сдвиг ВСЕХ курсов относительно опорной (ошибка масштаба в 10 раз) отвергается', () => {
    const tenfold = makeTable({ perUnit: { TJS: 1, USD: 100, EUR: 120, RUB: 1, ARS: 0.1, APE: 80 } });
    expect(assessRateTable(tenfold, base).ok).toBe(false);
  });
});

describe('withoutCodes', () => {
  it('убирает перечисленные валюты, остальное не трогает и исходную таблицу не меняет; опорную не убирает', () => {
    const t = makeTable({ perUnit: { TJS: 1, USD: 10, ARS: 0.01 } });
    const r = withoutCodes(t, ['ARS', 'TJS', 'XXX']);
    expect(r.perUnit).toEqual({ TJS: 1, USD: 10 });
    expect(t.perUnit).toEqual({ TJS: 1, USD: 10, ARS: 0.01 });
    expect(r).toMatchObject({ asOf: t.asOf, pivot: t.pivot, source: t.source, fetchedAt: t.fetchedAt });
  });
});

describe('pickComparable: с чем сравнивать новую таблицу', () => {
  const nbtOld = makeTable({ asOf: '2026-10-09', perUnit: { TJS: 1, USD: 10.9, EUR: 12.7 } });
  const apiNoTjs = makeTable({ asOf: '2026-10-10', source: 'api', pivot: 'USD', perUnit: { USD: 1, EUR: 1.167 } });

  it('свежайшая таблица, где есть опорная валюта новой; нет такой — просто свежайшая', () => {
    expect(pickComparable(makeTable(), [apiNoTjs, nbtOld])).toBe(nbtOld); // новая с pivot TJS: api без TJS пропускаем
    expect(pickComparable(makeTable({ source: 'api', pivot: 'USD', perUnit: { USD: 1, EUR: 1.2 } }), [apiNoTjs, nbtOld])).toBe(apiNoTjs);
    expect(pickComparable(makeTable({ pivot: 'GBP', perUnit: { GBP: 1, USD: 1.3 } }), [apiNoTjs, nbtOld])).toBe(apiNoTjs);
    expect(pickComparable(makeTable(), [])).toBeNull();
  });

  it('мусор вместо новой таблицы не роняет', () => {
    expect(pickComparable(null, [nbtOld])).toBe(nbtOld);
    expect(pickComparable('x', [])).toBeNull();
  });

  it('масштаб сомони ловится, даже если самая свежая сохранённая таблица без TJS', () => {
    const tenfold = makeTable({ asOf: '2026-10-10', perUnit: { TJS: 1, USD: 109.5, EUR: 127.8 } });
    const base = pickComparable(tenfold, [apiNoTjs, nbtOld]);
    expect(assessRateTable(tenfold, base).ok).toBe(false);
    expect(assessRateTable(tenfold, apiNoTjs).ok).toBe(true); // вслепую (как раньше) — пропустило бы
  });
});
