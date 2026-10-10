import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, formatDayLabel, isValidIsoDate, monthKey, monthTitle, todayLocal } from './dates';

/**
 * todayLocal зависит от часового пояса процесса, поэтому в тестах его задаём явно.
 * Таджикистан — UTC+5 без перехода на летнее время.
 */
function withTimeZone(tz: string, body: () => void) {
  describe(`часовой пояс ${tz}`, () => {
    let prev: string | undefined;
    beforeAll(() => {
      prev = process.env.TZ;
      process.env.TZ = tz;
    });
    afterAll(() => {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    });
    body();
  });
}

withTimeZone('Asia/Dushanbe', () => {
  it('пояс действительно применился (UTC+5)', () => {
    expect(new Date('2026-10-10T00:00:00Z').getHours()).toBe(5);
  });

  it('todayLocal: после полуночи по Душанбе уже новый день, хотя в UTC ещё вчера', () => {
    // 19:00 UTC = 00:00 по Душанбе (следующий день)
    const now = new Date('2026-10-10T19:00:00.000Z');
    expect(now.toISOString().slice(0, 10)).toBe('2026-10-10'); // так делать НЕЛЬЗЯ
    expect(todayLocal(now)).toBe('2026-10-11');
  });

  it('todayLocal: за минуту до полуночи — ещё старый день', () => {
    expect(todayLocal(new Date('2026-10-10T18:59:59.999Z'))).toBe('2026-10-10');
  });

  it('todayLocal: ночью в 02:30 по Душанбе (21:30 UTC) — день по местным часам', () => {
    expect(todayLocal(new Date('2026-10-10T21:30:00.000Z'))).toBe('2026-10-11');
  });

  it('todayLocal: переход через границу года и месяца', () => {
    expect(todayLocal(new Date('2026-12-31T19:00:00.000Z'))).toBe('2027-01-01');
    expect(todayLocal(new Date('2026-02-28T19:00:00.000Z'))).toBe('2026-03-01');
    expect(todayLocal(new Date('2028-02-28T19:00:00.000Z'))).toBe('2028-02-29');
  });

  it('todayLocal без аргумента возвращает корректную дату', () => {
    expect(isValidIsoDate(todayLocal())).toBe(true);
  });
});

withTimeZone('America/New_York', () => {
  it('todayLocal: вечером в Нью-Йорке (UTC−4) в UTC уже завтра, а у пользователя ещё сегодня', () => {
    // 01:00 UTC 11 октября = 21:00 10 октября в Нью-Йорке
    expect(todayLocal(new Date('2026-10-11T01:00:00.000Z'))).toBe('2026-10-10');
  });

  it('addDays не зависит от перехода на зимнее время (1 ноября 2026, 25-часовые сутки)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
  });

  it('addDays не зависит от перехода на летнее время (8 марта 2026, 23-часовые сутки)', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});

describe('addDays', () => {
  it('сдвигает вперёд и назад', () => {
    expect(addDays('2026-10-10', 0)).toBe('2026-10-10');
    expect(addDays('2026-10-10', 1)).toBe('2026-10-11');
    expect(addDays('2026-10-10', -1)).toBe('2026-10-09');
    expect(addDays('2026-10-10', 365)).toBe('2027-10-10');
  });

  it('переходит через границы месяцев', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('високосный год: 29 февраля есть в 2028 и нет в 2026/2100', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01'); // 2100 не високосный
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29'); // 2000 високосный
  });

  it('бросает на некорректной дате и нецелом числе дней', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('не дата', 1)).toThrow(RangeError);
    expect(() => addDays('2026-10-10', 1.5)).toThrow(RangeError);
    expect(() => addDays('2026-10-10', Number.NaN)).toThrow(RangeError);
  });
});

describe('isValidIsoDate', () => {
  it('принимает настоящие даты', () => {
    expect(isValidIsoDate('2026-10-10')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(isValidIsoDate('2026-12-31')).toBe(true);
  });

  it('отвергает несуществующие и неканоничные', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2100-02-29')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-00-10')).toBe(false);
    expect(isValidIsoDate('2026-10-00')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
    expect(isValidIsoDate('2026-10-10T00:00:00Z')).toBe(false);
    expect(isValidIsoDate(' 2026-10-10')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate(20261010)).toBe(false);
  });
});

describe('formatDayLabel', () => {
  const today = '2026-10-10'; // суббота

  it('Сегодня и Вчера', () => {
    expect(formatDayLabel('2026-10-10', today)).toBe('Сегодня');
    expect(formatDayLabel('2026-10-09', today)).toBe('Вчера');
  });

  it('иначе день недели, число и месяц', () => {
    expect(formatDayLabel('2026-10-05', today)).toBe('пн, 5 окт');
    expect(formatDayLabel('2026-10-11', today)).toBe('вс, 11 окт'); // будущее тоже подписывается датой
    expect(formatDayLabel('2026-05-09', today)).toBe('сб, 9 мая');
    expect(formatDayLabel('2026-01-01', today)).toBe('чт, 1 янв');
  });

  it('«Вчера» работает через границу месяца и года', () => {
    expect(formatDayLabel('2026-09-30', '2026-10-01')).toBe('Вчера');
    expect(formatDayLabel('2025-12-31', '2026-01-01')).toBe('Вчера');
  });

  it('дата другого года показывается с годом', () => {
    expect(formatDayLabel('2025-10-05', today)).toBe('вс, 5 окт 2025');
  });

  it('некорректную дату возвращает как есть, не падая', () => {
    expect(formatDayLabel('мусор', today)).toBe('мусор');
    expect(formatDayLabel('2026-02-30', today)).toBe('2026-02-30');
  });

  it('по умолчанию «сегодня» берётся из todayLocal', () => {
    expect(formatDayLabel(todayLocal())).toBe('Сегодня');
  });
});

describe('monthKey / monthTitle', () => {
  it('monthKey', () => {
    expect(monthKey('2026-10-05')).toBe('2026-10');
    expect(monthKey('2026-01-31')).toBe('2026-01');
    expect(monthKey('2028-02-29')).toBe('2028-02');
    expect(() => monthKey('2026-02-30')).toThrow(RangeError);
    expect(() => monthKey('xx')).toThrow(RangeError);
  });

  it('monthTitle из ключа месяца и из даты', () => {
    expect(monthTitle('2026-10')).toBe('Октябрь 2026');
    expect(monthTitle('2026-10-05')).toBe('Октябрь 2026');
    expect(monthTitle('2027-01')).toBe('Январь 2027');
    expect(monthTitle('2026-05')).toBe('Май 2026');
    expect(monthTitle('2026-12-31')).toBe('Декабрь 2026');
  });

  it('monthTitle бросает на некорректном входе', () => {
    expect(() => monthTitle('2026-13')).toThrow(RangeError);
    expect(() => monthTitle('2026-00')).toThrow(RangeError);
    expect(() => monthTitle('')).toThrow(RangeError);
    expect(() => monthTitle('октябрь')).toThrow(RangeError);
  });
});
