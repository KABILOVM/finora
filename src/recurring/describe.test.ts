import { describe, expect, it } from 'vitest';
import { describeSchedule, shortMonthHint, weekdayOf } from './describe';

const rule = (frequency: 'daily' | 'weekly' | 'monthly' | 'yearly', intervalN: number, startOn: string) => ({ frequency, intervalN, startOn });

describe('describeSchedule', () => {
  it('ежемесячно: «Каждый месяц, 5-го» и каждые N месяцев', () => {
    expect(describeSchedule(rule('monthly', 1, '2026-10-05'))).toBe('Каждый месяц, 5-го');
    expect(describeSchedule(rule('monthly', 2, '2026-10-22'))).toBe('Каждые 2 месяца, 22-го');
    expect(describeSchedule(rule('monthly', 5, '2026-01-31'))).toBe('Каждые 5 месяцев, 31-го');
    expect(describeSchedule(rule('monthly', 21, '2026-01-01'))).toBe('Каждые 21 месяц, 1-го');
  });

  it('понедельно: день недели берётся из даты начала, склонение «недели/недель/неделю»', () => {
    // 2026-10-09 — пятница
    expect(describeSchedule(rule('weekly', 2, '2026-10-09'))).toBe('Каждые 2 недели по пятницам');
    expect(describeSchedule(rule('weekly', 1, '2026-10-09'))).toBe('Каждую неделю по пятницам');
    expect(describeSchedule(rule('weekly', 5, '2026-10-05'))).toBe('Каждые 5 недель по понедельникам');
    expect(describeSchedule(rule('weekly', 21, '2026-10-11'))).toBe('Каждые 21 неделю по воскресеньям');
    expect(describeSchedule(rule('weekly', 3, '2026-10-10'))).toBe('Каждые 3 недели по субботам');
    expect(describeSchedule(rule('weekly', 2, '2026-10-06'))).toBe('Каждые 2 недели по вторникам');
    expect(describeSchedule(rule('weekly', 2, '2026-10-07'))).toBe('Каждые 2 недели по средам');
    expect(describeSchedule(rule('weekly', 2, '2026-10-08'))).toBe('Каждые 2 недели по четвергам');
  });

  it('ежедневно', () => {
    expect(describeSchedule(rule('daily', 1, '2026-10-05'))).toBe('Каждый день');
    expect(describeSchedule(rule('daily', 2, '2026-10-05'))).toBe('Каждые 2 дня');
    expect(describeSchedule(rule('daily', 5, '2026-10-05'))).toBe('Каждые 5 дней');
    expect(describeSchedule(rule('daily', 11, '2026-10-05'))).toBe('Каждые 11 дней');
    expect(describeSchedule(rule('daily', 21, '2026-10-05'))).toBe('Каждые 21 день');
  });

  it('ежегодно: «Раз в год 1 марта»', () => {
    expect(describeSchedule(rule('yearly', 1, '2026-03-01'))).toBe('Раз в год 1 марта');
    expect(describeSchedule(rule('yearly', 2, '2026-03-01'))).toBe('Раз в 2 года 1 марта');
    expect(describeSchedule(rule('yearly', 5, '2026-12-31'))).toBe('Раз в 5 лет 31 декабря');
    expect(describeSchedule(rule('yearly', 1, '2024-02-29'))).toBe('Раз в год 29 февраля');
  });

  it('шаг, которого быть не может, считается за 1; дата, которой нет, не роняет текст', () => {
    expect(describeSchedule(rule('monthly', 0, '2026-10-05'))).toBe('Каждый месяц, 5-го');
    expect(describeSchedule(rule('monthly', 1.5, '2026-10-05'))).toBe('Каждый месяц, 5-го');
    expect(describeSchedule(rule('monthly', Number.NaN, '2026-10-05'))).toBe('Каждый месяц, 5-го');
    expect(describeSchedule(rule('monthly', 1, '2026-02-30'))).toBe('Каждый месяц');
    expect(describeSchedule(rule('weekly', 1, 'нет'))).toBe('Каждую неделю');
    expect(describeSchedule(rule('yearly', 1, ''))).toBe('Раз в год');
    expect(describeSchedule({ frequency: 'hourly' as never, intervalN: 1, startOn: '2026-10-05' })).toBe('Расписание не задано');
  });
});

describe('weekdayOf', () => {
  it('день недели не зависит от часового пояса (считается по календарю)', () => {
    expect(weekdayOf('2026-10-11')).toBe(0);
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2000-01-01')).toBe(6);
    expect(weekdayOf('2100-01-01')).toBe(5);
    expect(weekdayOf('2026-13-01')).toBeNull();
  });
});

describe('shortMonthHint', () => {
  it('месячный платёж на 29, 30, 31 число — подсказка про последний день месяца', () => {
    for (const d of ['29', '30', '31']) {
      expect(shortMonthHint({ frequency: 'monthly', startOn: `2026-01-${d}` })).toBe('В коротких месяцах платёж будет в последний день месяца');
    }
  });

  it('на 28 и раньше — подсказки нет; другие частоты — тоже', () => {
    expect(shortMonthHint({ frequency: 'monthly', startOn: '2026-01-28' })).toBeNull();
    expect(shortMonthHint({ frequency: 'monthly', startOn: '2026-01-01' })).toBeNull();
    expect(shortMonthHint({ frequency: 'weekly', startOn: '2026-01-31' })).toBeNull();
    expect(shortMonthHint({ frequency: 'daily', startOn: '2026-01-31' })).toBeNull();
    expect(shortMonthHint({ frequency: 'yearly', startOn: '2026-01-31' })).toBeNull();
  });

  it('годовой на 29 февраля — отдельная фраза; нечитаемая дата — null', () => {
    expect(shortMonthHint({ frequency: 'yearly', startOn: '2028-02-29' })).toBe('В невисокосный год платёж будет 28 февраля');
    expect(shortMonthHint({ frequency: 'monthly', startOn: '2026-02-30' })).toBeNull();
  });
});
