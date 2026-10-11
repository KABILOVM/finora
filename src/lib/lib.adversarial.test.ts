import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, formatDayLabel, isValidIsoDate, monthKey, monthTitle, todayLocal } from './dates';
import { pluralRu } from './plural';

const ZONES = ['Asia/Dushanbe', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Sao_Paulo', 'Pacific/Apia', 'Australia/Lord_Howe', 'Europe/Moscow', 'UTC'];
const origTZ = process.env.TZ;
afterEach(() => {
  if (origTZ === undefined) delete process.env.TZ;
  else process.env.TZ = origTZ;
});

function oracle(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

describe('ATTACK: даты и часовые пояса', () => {
  it.each(ZONES)('todayLocal совпадает с эталоном Intl в поясе %s (полночь, переходы на летнее время, пропущенные сутки)', (tz) => {
    process.env.TZ = tz;
    fc.assert(
      fc.property(fc.integer({ min: Date.UTC(2010, 0, 1), max: Date.UTC(2035, 0, 1) }), (ts) => {
        expect(todayLocal(new Date(ts))).toBe(oracle(ts, tz));
      }),
      { numRuns: 400 },
    );
  });

  it.each(ZONES)('addDays: ровно +1 день в любом поясе, обратимость, порядок строк (%s)', (tz) => {
    process.env.TZ = tz;
    const date = fc
      .tuple(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([y, m, d]) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(date, fc.integer({ min: -40000, max: 40000 }), (d, n) => {
        const plus = addDays(d, n);
        expect(isValidIsoDate(plus)).toBe(true);
        expect(addDays(plus, -n)).toBe(d);
        if (n > 0) expect(plus > d).toBe(true);
        expect(addDays(d, 1) > d).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('formatDayLabel: «Сегодня»/«Вчера» не зависят от пояса, мусор не роняет', () => {
    expect(formatDayLabel('2026-10-10', '2026-10-10')).toBe('Сегодня');
    expect(formatDayLabel('2026-10-09', '2026-10-10')).toBe('Вчера');
    expect(formatDayLabel('2026-03-01', '2026-03-02')).toBe('Вчера');
    expect(formatDayLabel('2026-12-31', '2027-01-01')).toBe('Вчера');
    for (const junk of ['', 'x', '2026-02-30', '2026-13-01', '０２６-01-01', '2026-01-01\n']) {
      expect(() => formatDayLabel(junk as never, '2026-10-10')).not.toThrow();
      expect(isValidIsoDate(junk)).toBe(false);
    }
  });

  it('monthKey/monthTitle отвергают мусор, а не выдают «undefined 2026»', () => {
    for (const bad of ['2026-00', '2026-13', '2026-1', '', '2026-02-30']) {
      expect(() => monthTitle(bad), bad).toThrow(RangeError);
    }
    expect(() => monthKey('2026-02-29')).toThrow(RangeError);
    expect(monthTitle('2024-02-29')).toBe('Февраль 2024');
  });
});

describe('ATTACK: склонение и cn', () => {
  it('pluralRu на границах', () => {
    const f = (n: number) => pluralRu(n, 'запись', 'записи', 'записей');
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 100, 101, 111, 112, 121].map(f)).toEqual([
      'записей', 'запись', 'записи', 'записи', 'записей', 'записей', 'записей', 'записей', 'запись', 'записи', 'записей', 'записей', 'запись', 'записей', 'записей', 'запись',
    ]);
    expect(f(Number.NaN)).toBe('записей');
    expect(f(-1)).toBe('запись');
    expect(f(2 ** 53)).toBe('записи'); // ...992
  });
});
