import { describe, expect, it } from 'vitest';
import { deltaTone } from './PeriodDelta';
import { periodDeltaLabel } from './PeriodCategories';
import { labelStep, monthLabel } from './PeriodMonths';

describe('periodDeltaLabel: сдвиг категории против сравниваемого периода', () => {
  const d = (currentMinor: number, previousMinor: number) => ({ currentMinor, previousMinor });

  it('расходы: рост красный, снижение зелёное, новая — красная, исчезла — зелёная', () => {
    expect(periodDeltaLabel(d(120, 100), 'expense')).toMatchObject({ text: '▲ +20%', tone: 'expense', aria: 'на 20% больше' });
    expect(periodDeltaLabel(d(80, 100), 'expense')).toMatchObject({ text: '▼ −20%', tone: 'income', aria: 'на 20% меньше' });
    expect(periodDeltaLabel(d(50, 0), 'expense')).toMatchObject({ text: 'новая', tone: 'expense' });
    expect(periodDeltaLabel(d(0, 50), 'expense')).toMatchObject({ text: 'нет трат', tone: 'income' });
  });

  it('доходы: наоборот — рост и новая зелёные, потеря красная', () => {
    expect(periodDeltaLabel(d(120, 100), 'income')).toMatchObject({ text: '▲ +20%', tone: 'income' });
    expect(periodDeltaLabel(d(80, 100), 'income')).toMatchObject({ text: '▼ −20%', tone: 'expense' });
    expect(periodDeltaLabel(d(50, 0), 'income')).toMatchObject({ text: 'новая', tone: 'income' });
    expect(periodDeltaLabel(d(0, 50), 'income')).toMatchObject({ text: 'нет доходов', tone: 'expense' });
  });

  it('одинаково или меньше процента — «столько же»; пусто с обеих сторон — ничего', () => {
    expect(periodDeltaLabel(d(100, 100), 'expense')).toMatchObject({ text: 'столько же', tone: 'muted' });
    expect(periodDeltaLabel(d(100_001, 100_000), 'expense')).toMatchObject({ text: 'столько же', tone: 'muted' });
    expect(periodDeltaLabel(d(0, 0), 'expense')).toBeNull();
  });
});

describe('deltaTone', () => {
  it('цвет по смыслу: расходы вниз — хорошо, доходы вверх — хорошо; без сравнения и без изменений — серый', () => {
    expect(deltaTone(120, 100, 'down')).toBe('expense');
    expect(deltaTone(80, 100, 'down')).toBe('income');
    expect(deltaTone(120, 100, 'up')).toBe('income');
    expect(deltaTone(80, 100, 'up')).toBe('expense');
    expect(deltaTone(100, 100, 'up')).toBe('muted');
    expect(deltaTone(100, 0, 'up')).toBe('muted');
  });
});

describe('подписи месяцев под графиком', () => {
  it('чем больше месяцев, тем реже подписи: до 6 — все, до 12 — через один, дальше — около пяти', () => {
    expect([1, 6, 7, 12, 13, 24, 61].map(labelStep)).toEqual([1, 1, 2, 2, 3, 5, 13]);
  });

  it('в периоде длиннее года у месяца есть год, иначе не понять, какой это январь', () => {
    expect(monthLabel('2026-01', 12)).toBe('янв');
    expect(monthLabel('2026-01', 13)).toBe('янв ’26');
  });
});
