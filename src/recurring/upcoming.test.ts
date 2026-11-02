import { describe, expect, it } from 'vitest';
import type { UpcomingItem } from '@/db';
import { daysBetween, groupUpcoming, itemKey, monthEnd, overdueText, relativeText, soonSpan, soonUntil, whenText, widgetRows } from './upcoming';

const TODAY = '2026-10-11';
const item = (date: string, status: UpcomingItem['status'], over: Partial<UpcomingItem> = {}, id = 'r1'): UpcomingItem =>
  ({ rule: { id } as UpcomingItem['rule'], date, status, alreadyExists: false, ...over });

describe('groupUpcoming', () => {
  it('раскладывает по разделам и убирает уже проведённые и пропущенные', () => {
    const g = groupUpcoming([
      item('2026-10-01', 'overdue'),
      item('2026-10-05', 'overdue', { alreadyExists: true }),
      item('2026-10-11', 'due'),
      item('2026-10-11', 'due', { alreadyExists: true }, 'r2'),
      item('2026-10-20', 'upcoming'),
    ]);
    expect(g.overdue.map((i) => i.date)).toEqual(['2026-10-01']);
    expect(g.due.map((i) => i.date)).toEqual(['2026-10-11']);
    expect(g.soon.map((i) => i.date)).toEqual(['2026-10-20']);
  });

  it('пустые данные и «ещё считается» дают пустые разделы', () => {
    expect(groupUpcoming([])).toEqual({ overdue: [], due: [], soon: [] });
    expect(groupUpcoming(undefined)).toEqual({ overdue: [], due: [], soon: [] });
  });
});

describe('даты словами', () => {
  it('daysBetween: через границу месяца, года и в високосный год', () => {
    expect(daysBetween('2026-10-01', '2026-10-11')).toBe(10);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-10-11', '2026-10-01')).toBe(-10);
    expect(daysBetween('нет', '2026-10-01')).toBe(0);
  });

  it('overdueText: склонение дней', () => {
    expect(overdueText('2026-10-10', TODAY)).toBe('Просрочено на 1 день');
    expect(overdueText('2026-10-09', TODAY)).toBe('Просрочено на 2 дня');
    expect(overdueText('2026-10-06', TODAY)).toBe('Просрочено на 5 дней');
    expect(overdueText('2026-09-20', TODAY)).toBe('Просрочено на 21 день');
    expect(overdueText('2026-09-30', TODAY)).toBe('Просрочено на 11 дней');
  });

  it('whenText: Сегодня, Завтра, иначе день недели и число', () => {
    expect(whenText('2026-10-11', TODAY)).toBe('Сегодня');
    expect(whenText('2026-10-12', TODAY)).toBe('Завтра');
    expect(whenText('2026-10-10', TODAY)).toBe('Вчера');
    expect(whenText('2026-10-14', TODAY)).toBe('ср, 14 окт');
    expect(whenText('2027-01-05', TODAY)).toBe('вт, 5 янв 2027');
  });

  it('relativeText: сегодня, просрочено, через N дней', () => {
    expect(relativeText('2026-10-11', TODAY)).toBe('сегодня');
    expect(relativeText('2026-10-09', TODAY)).toBe('просрочено на 2 дня');
    expect(relativeText('2026-10-12', TODAY)).toBe('через 1 день');
    expect(relativeText('2026-10-14', TODAY)).toBe('через 3 дня');
    expect(relativeText('2026-10-21', TODAY)).toBe('через 10 дней');
  });

  it('itemKey: правило + дата', () => {
    expect(itemKey(item('2026-10-11', 'due'))).toBe('r1:2026-10-11');
  });
});

describe('widgetRows', () => {
  it('просроченные первыми, потом сегодня и ближайшие 7 дней; дальше 7 дней не берём', () => {
    const { rows, more } = widgetRows(
      [
        item('2026-10-01', 'overdue'),
        item('2026-10-11', 'due'),
        item('2026-10-18', 'upcoming'),
        item('2026-10-19', 'upcoming'), // 8-й день — уже не входит
      ],
      TODAY,
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-11', '2026-10-18']);
    expect(more).toBe(0);
  });

  it('больше четырёх строк — «Ещё N»', () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`2026-10-0${i + 1}`, 'overdue', {}, `r${i}`));
    const { rows, more } = widgetRows(items, TODAY);
    expect(rows).toHaveLength(4);
    expect(more).toBe(3);
    expect(rows[0]?.date).toBe('2026-10-01');
  });

  it('проведённые не считаются; нет данных — пусто', () => {
    expect(widgetRows([item('2026-10-11', 'due', { alreadyExists: true })], TODAY)).toEqual({ rows: [], more: 0 });
    expect(widgetRows(undefined, TODAY)).toEqual({ rows: [], more: 0 });
  });
});

describe('«Скоро» — до конца текущего месяца', () => {
  it('monthEnd: месяцы разной длины, високосный февраль, граница года', () => {
    expect(monthEnd('2026-11-02')).toBe('2026-11-30');
    expect(monthEnd('2026-10-31')).toBe('2026-10-31');
    expect(monthEnd('2026-12-05')).toBe('2026-12-31');
    expect(monthEnd('2027-02-10')).toBe('2027-02-28');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('нет')).toBe('нет');
  });

  it('2 ноября «Скоро» кончается 30 ноября: декабрьская дата (через 30 дней) в раздел не попадает', () => {
    expect(soonUntil('2026-11-02')).toBe('2026-11-30');
    expect('2026-12-02' <= soonUntil('2026-11-02')).toBe(false);
    expect('2026-11-30' <= soonUntil('2026-11-02')).toBe(true);
  });

  it('в последние дни месяца неделя вперёд видна всегда: 29 ноября — по 6 декабря, 24 ноября — по конец месяца', () => {
    expect(soonUntil('2026-11-29')).toBe('2026-12-06');
    expect(soonUntil('2026-11-30')).toBe('2026-12-07');
    expect(soonUntil('2026-11-23')).toBe('2026-11-30');
    expect(soonUntil('2026-11-24')).toBe('2026-12-01');
  });

  it('подписи: «до конца месяца», а когда действует «неделя вперёд» — «ближайшие 7 дней»', () => {
    expect(soonSpan('2026-11-02')).toEqual({ hint: 'До конца месяца', within: 'до конца месяца', empty: 'До конца месяца платежей нет.' });
    expect(soonSpan('2026-11-29')).toEqual({ hint: 'Ближайшие 7 дней', within: 'на ближайшие 7 дней', empty: 'На ближайшие 7 дней платежей нет.' });
  });
});
