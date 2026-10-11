import { describe, expect, it } from 'vitest';
import { daysBetween, daysWord, dueInfo, dueLine, progressPercent, repaidWord, ruDateShort } from './debtText';

describe('daysBetween: календарные дни без часовых поясов', () => {
  it('в пределах месяца, через конец месяца и года', () => {
    expect(daysBetween('2026-10-15', '2026-10-15')).toBe(0);
    expect(daysBetween('2026-10-15', '2026-10-20')).toBe(5);
    expect(daysBetween('2026-10-20', '2026-10-15')).toBe(-5);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('високосный год: 29 февраля существует только в 2028-м', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('переход на летнее время не добавляет и не убирает день (считаем по датам, а не по часам)', () => {
    // в Европе часы переводят 29 марта 2026 и 25 октября 2026
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('некорректная дата — null, а не NaN', () => {
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(daysBetween('2026-10-15', '')).toBeNull();
    expect(daysBetween('15.10.2026', '2026-10-16')).toBeNull();
  });
});

describe('dueInfo: срок словами', () => {
  const today = '2026-10-15';
  it('нет срока', () => {
    expect(dueInfo(null, today)).toEqual({ tone: 'none', days: null, text: 'без срока' });
  });
  it('впереди: «через N дней», «завтра», «сегодня»', () => {
    expect(dueInfo('2026-10-20', today)).toEqual({ tone: 'ok', days: 5, text: 'через 5 дней' });
    expect(dueInfo('2026-10-18', today).tone).toBe('soon');
    expect(dueInfo('2026-10-16', today)).toEqual({ tone: 'soon', days: 1, text: 'завтра' });
    expect(dueInfo('2026-10-15', today)).toEqual({ tone: 'today', days: 0, text: 'сегодня' });
  });
  it('склонение: 1, 2, 5, 11, 21, 22 дня', () => {
    expect(dueInfo('2026-10-17', today).text).toBe('через 2 дня');
    expect(dueInfo('2026-10-26', today).text).toBe('через 11 дней');
    expect(dueInfo('2026-11-05', today).text).toBe('через 21 день');
    expect(dueInfo('2026-11-06', today).text).toBe('через 22 дня');
  });
  it('просрочка — словами и с красным тоном', () => {
    expect(dueInfo('2026-10-14', today)).toEqual({ tone: 'overdue', days: -1, text: 'просрочен на 1 день' });
    expect(dueInfo('2026-10-12', today)).toEqual({ tone: 'overdue', days: -3, text: 'просрочен на 3 дня' });
    expect(dueInfo('2026-10-04', today).text).toBe('просрочен на 11 дней');
  });
  it('закрытый или погашенный долг не просрочен, как бы давно ни вышел срок', () => {
    const info = dueInfo('2025-01-01', today, false);
    expect(info.tone).toBe('none');
    expect(info.text).toBe('');
  });
  it('срок через границу года и високосный день', () => {
    expect(dueInfo('2027-01-02', '2026-12-31').text).toBe('через 2 дня');
    expect(dueInfo('2028-03-01', '2028-02-28').text).toBe('через 2 дня');
  });
  it('сломанный срок не роняет экран', () => {
    expect(dueInfo('вчера', today).tone).toBe('none');
  });
  it('daysWord', () => {
    expect([1, 2, 5, 11, 21].map(daysWord)).toEqual(['день', 'дня', 'дней', 'дней', 'день']);
  });
});

describe('dueLine: срок одной строкой', () => {
  it('без срока, будущий, просроченный, закрытый', () => {
    const today = '2026-10-15';
    expect(dueLine(null, dueInfo(null, today))).toBe('Без срока');
    expect(dueLine('2026-11-25', dueInfo('2026-11-25', today))).toBe('Срок 25.11.2026 · через 41 день');
    expect(dueLine('2026-10-12', dueInfo('2026-10-12', today))).toBe('Просрочен на 3 дня (срок был 12.10.2026)');
    expect(dueLine('2026-10-12', dueInfo('2026-10-12', today, false))).toBe('Срок 12.10.2026');
  });
  it('ruDateShort', () => {
    expect(ruDateShort('2026-01-05')).toBe('05.01.2026');
    expect(ruDateShort('мусор')).toBe('мусор');
  });
});

describe('progressPercent: доля погашенного, целая арифметика', () => {
  it('границы', () => {
    expect(progressPercent(0, 1000)).toBe(0);
    expect(progressPercent(1, 1000)).toBe(0);
    expect(progressPercent(500, 1000)).toBe(50);
    expect(progressPercent(333, 1000)).toBe(33);
    expect(progressPercent(999, 1000)).toBe(99);
    expect(progressPercent(1000, 1000)).toBe(100);
    expect(progressPercent(5000, 1000)).toBe(100);
  });
  it('пусто и мусор', () => {
    expect(progressPercent(100, 0)).toBe(0);
    expect(progressPercent(-5, 100)).toBe(0);
    expect(progressPercent(NaN, 100)).toBe(0);
    expect(progressPercent(10.5, 100)).toBe(0);
  });
  it('огромные суммы (до 1e15) не теряют точность при умножении на 100', () => {
    const p = 1_000_000_000_000_000;
    expect(progressPercent(p - 1, p)).toBe(99);
    expect(progressPercent(p / 2, p)).toBe(50);
    expect(progressPercent(9_999_999_999_999, p)).toBe(0);
    expect(progressPercent(10_000_000_000_000, p)).toBe(1);
  });
  it('слова по направлению', () => {
    expect(repaidWord('lent', 40)).toBe('Возвращено 40%');
    expect(repaidWord('borrowed', 40)).toBe('Выплачено 40%');
  });
});
