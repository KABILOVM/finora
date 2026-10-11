import { describe, expect, it } from 'vitest';
import type { BudgetProgress } from '@/domain/budgetProgress';
import { budgetLabel, daysText, excludedText, fitFontSize, levelWord, longDate, restWord, spentWord } from './budgetText';

const nb = (s: string) => s.replace(/\u00a0/g, ' ');
type Compared = Extract<BudgetProgress, { comparable: true }>;
const p = (over: Partial<Compared>): Compared => ({
  comparable: true,
  id: 'b',
  categoryId: null,
  limitMinor: 1000,
  currency: 'TJS',
  spentMinor: 0,
  percent: 0,
  level: 'ok',
  remainingMinor: 1000,
  overMinor: 0,
  ...over,
});

describe('тексты бюджетов', () => {
  it('longDate: родительный падеж; нечитаемое — как есть', () => {
    expect(longDate('2026-10-31')).toBe('31 октября');
    expect(longDate('2028-02-29')).toBe('29 февраля');
    expect(longDate('2026-03-05')).toBe('5 марта');
    expect(longDate('мусор')).toBe('мусор');
    expect(longDate('2026-13-01')).toBe('2026-13-01');
  });

  it('daysText склоняет: 1 день, 2 дня, 5 дней, 11 дней, 21 день', () => {
    expect([1, 2, 5, 11, 21, 22].map(daysText)).toEqual(['1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня']);
  });

  it('spentWord: процент словами; огромный не растягивает строку', () => {
    expect(spentWord(0)).toBe('Потрачено 0%');
    expect(spentWord(78)).toBe('Потрачено 78%');
    expect(spentWord(999)).toBe('Потрачено 999%');
    expect(spentWord(1000)).toBe('Потрачено более 999%');
  });

  it('levelWord: уровень называется вслух; ровно на лимите — «Лимит исчерпан», выше — «Лимит превышен»', () => {
    expect(levelWord(p({ level: 'ok' }))).toBe('В пределах лимита');
    expect(levelWord(p({ level: 'warn', percent: 75 }))).toBe('Внимание: больше 70%');
    expect(levelWord(p({ level: 'danger', percent: 95 }))).toBe('Почти исчерпан');
    expect(levelWord(p({ level: 'over', percent: 100, remainingMinor: 0 }))).toBe('Лимит исчерпан');
    expect(levelWord(p({ level: 'over', percent: 120, remainingMinor: 0, overMinor: 200 }))).toBe('Лимит превышен');
  });

  it('restWord: «Осталось …» или «Превышен на …»', () => {
    expect(nb(restWord(p({ remainingMinor: 22_000 }), 'TJS'))).toBe('Осталось 220 с.');
    expect(nb(restWord(p({ remainingMinor: 0 }), 'TJS'))).toBe('Осталось 0 с.');
    expect(nb(restWord(p({ remainingMinor: 0, overMinor: 5_050 }), 'TJS'))).toBe('Превышен на 50,50 с.');
  });

  it('budgetLabel: общий лимит, категория, удалённая категория', () => {
    const cats = new Map([['c1', { name: 'Еда', icon: '🍽️', color: '#f97316' }]]);
    expect(budgetLabel(null, cats)).toMatchObject({ name: 'Все расходы' });
    expect(budgetLabel('c1', cats)).toEqual({ name: 'Еда', icon: '🍽️', color: '#f97316' });
    expect(budgetLabel('нет', cats).name).toBe('Категория удалена');
  });

  it('excludedText: склонение и валюта', () => {
    expect(excludedText(1, 'USD')).toContain('1 операция внесена');
    expect(excludedText(3, 'USD')).toContain('3 операции внесены');
    expect(excludedText(7, 'USD')).toContain('7 операций внесено');
    expect(excludedText(2, 'USD')).toContain('(USD)');
  });

  it('fitFontSize: обычный clamp, но не крупнее, чем строка влезает по ширине экрана; короткая и длинная запись различаются', () => {
    const short = fitFontSize(9, '2rem', '10vw', '2.75rem');
    const long = fitFontSize(16, '2rem', '10vw', '2.75rem');
    expect(short).toBe('min(clamp(2rem, 10vw, 2.75rem), calc((100vw - 4.5rem) / 5.04))');
    expect(long).toBe('min(clamp(2rem, 10vw, 2.75rem), calc((100vw - 4.5rem) / 8.96))');
    // мусорная длина не даёт деления на ноль и NaN
    expect(fitFontSize(0, '2rem', '10vw', '2.75rem')).toContain('/ 0.56)');
    expect(fitFontSize(Number.NaN, '2rem', '10vw', '2.75rem')).not.toContain('NaN');
  });
});
