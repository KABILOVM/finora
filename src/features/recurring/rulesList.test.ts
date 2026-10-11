import { describe, expect, it } from 'vitest';
import type { LocalRow, RecurringRule } from '@/domain/types';
import { nextDue } from './RulesList';

const rule = (over: Partial<RecurringRule> = {}) =>
  ({ frequency: 'monthly', intervalN: 1, startOn: '2026-10-11', endOn: null, ...over }) as LocalRow<RecurringRule>;

describe('nextDue: ближайший платёж без уже проведённых и пропущенных дат', () => {
  it('сегодняшний платёж — это ближайший, пока он не проведён', () => {
    expect(nextDue(rule(), '2026-10-11')).toBe('2026-10-11');
  });

  it('сегодняшнюю дату провели или пропустили — следующая', () => {
    expect(nextDue(rule(), '2026-10-11', new Set(['2026-10-11']))).toBe('2026-11-11');
  });

  it('несколько подряд проведённых дат', () => {
    const r = rule({ frequency: 'daily' });
    expect(nextDue(r, '2026-10-11', new Set(['2026-10-11', '2026-10-12', '2026-10-13']))).toBe('2026-10-14');
  });

  it('правило началось в будущем — его первая дата', () => {
    expect(nextDue(rule({ startOn: '2027-01-31' }), '2026-10-11')).toBe('2027-01-31');
  });

  it('больше платежей не будет: расписание закончилось или последняя дата проведена', () => {
    expect(nextDue(rule({ endOn: '2026-10-11' }), '2026-10-12')).toBeNull();
    expect(nextDue(rule({ endOn: '2026-10-11' }), '2026-10-11', new Set(['2026-10-11']))).toBeNull();
  });

  it('конец месяца и високосный год', () => {
    expect(nextDue(rule({ startOn: '2026-01-31' }), '2026-02-01')).toBe('2026-02-28');
    expect(nextDue(rule({ startOn: '2024-02-29', frequency: 'yearly' }), '2025-01-01')).toBe('2025-02-28');
  });
});
