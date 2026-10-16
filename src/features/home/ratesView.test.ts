import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatUnits, formatWidgetRate, RATES_WIDGET_COUNT, scaleRate, shortAsOf, widgetCurrencies } from './ratesView';

const norm = (s: string) => s.replace(/\s/g, ' ');

describe('widgetCurrencies', () => {
  it('к сомони — доллар и рубль', () => {
    expect(widgetCurrencies('TJS')).toEqual(['USD', 'RUB']);
  });
  it('основная валюта не показывается сама к себе: вместо неё встаёт евро', () => {
    expect(widgetCurrencies('USD')).toEqual(['RUB', 'EUR']);
    expect(widgetCurrencies('RUB')).toEqual(['USD', 'EUR']);
    expect(widgetCurrencies('EUR')).toEqual(['USD', 'RUB']);
  });
  it('всегда ровно две валюты и никогда не основная', () => {
    fc.assert(
      fc.property(fc.constantFrom('TJS', 'USD', 'EUR', 'RUB', 'KZT', 'CNY'), (base) => {
        const list = widgetCurrencies(base);
        expect(list).toHaveLength(RATES_WIDGET_COUNT);
        expect(list).not.toContain(base);
        expect(new Set(list).size).toBe(list.length);
      }),
    );
  });
});

describe('scaleRate', () => {
  it('курс от 1 и выше — за одну единицу', () => {
    expect(scaleRate(10.95)).toEqual({ units: 1, value: 10.95 });
    expect(scaleRate(1)).toEqual({ units: 1, value: 1 });
  });
  it('рубль к сомони — за 100, тенге — за 1 000', () => {
    const rub = scaleRate(0.121);
    expect(rub.units).toBe(100);
    expect(rub.value).toBeCloseTo(12.1, 10);
    expect(scaleRate(0.0205).units).toBe(1000);
  });
  it('не число и не положительное — как есть, без масштаба', () => {
    expect(scaleRate(0)).toEqual({ units: 1, value: 0 });
    expect(scaleRate(-3)).toEqual({ units: 1, value: -3 });
    expect(scaleRate(Number.NaN).units).toBe(1);
    expect(scaleRate(Number.POSITIVE_INFINITY).units).toBe(1);
  });
  it('цена не меняется: value / units = исходный курс; число читаемое (≥ 5), кроме совсем крошечных курсов', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-4, max: 1e6, noNaN: true }), (rate) => {
        const { units, value } = scaleRate(rate);
        expect(value / units).toBeCloseTo(rate, 9);
        expect([1, 10, 100, 1000, 10_000, 100_000]).toContain(units);
        expect(value).toBeGreaterThanOrEqual(Math.min(5, rate));
        if (units > 1) expect(rate * (units / 10)).toBeLessThan(5);
      }),
    );
  });
});

describe('форматы', () => {
  it('формат единиц: 1 000 с неразрывным пробелом', () => {
    expect(formatUnits(1)).toBe('1');
    expect(norm(formatUnits(1000))).toBe('1 000');
    expect(norm(formatUnits(100_000))).toBe('100 000');
  });
  it('число курса — две цифры после запятой', () => {
    expect(formatWidgetRate(10.9)).toBe('10,90');
    expect(formatWidgetRate(12.1)).toBe('12,10');
    expect(norm(formatWidgetRate(1234.567))).toBe('1 234,57');
  });
  it('дата курса: ДД.ММ; непонятную оставляем как есть', () => {
    expect(shortAsOf('2026-10-16')).toBe('16.10');
    expect(shortAsOf('вчера')).toBe('вчера');
  });
});
