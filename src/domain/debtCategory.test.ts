import { describe, expect, it } from 'vitest';
import {
  DEBT_CATEGORY_MAX,
  DEBT_CATEGORY_PRESETS,
  NO_DEBT_CATEGORY,
  debtCategoryKey,
  debtCategoryOptions,
  matchesDebtCategory,
  normalizeDebtCategory,
  usedDebtCategories,
} from './debtCategory';

describe('normalizeDebtCategory', () => {
  it('убирает пробелы по краям, схлопывает внутри, пусто остаётся пустым', () => {
    expect(normalizeDebtCategory('  Друзья  ')).toBe('Друзья');
    expect(normalizeDebtCategory('Моя   семья')).toBe('Моя семья');
    expect(normalizeDebtCategory('   ')).toBe('');
  });

  it('обрезает до DEBT_CATEGORY_MAX символов (по символам, не по кодовым единицам)', () => {
    expect(normalizeDebtCategory('я'.repeat(100))).toHaveLength(DEBT_CATEGORY_MAX);
    expect(Array.from(normalizeDebtCategory('😀'.repeat(100)))).toHaveLength(DEBT_CATEGORY_MAX);
  });
});

describe('matchesDebtCategory', () => {
  it('пустой фильтр подходит всему; «без категории» — только пустой категории', () => {
    expect(matchesDebtCategory('Друзья', '')).toBe(true);
    expect(matchesDebtCategory('', NO_DEBT_CATEGORY)).toBe(true);
    expect(matchesDebtCategory('  ', NO_DEBT_CATEGORY)).toBe(true);
    expect(matchesDebtCategory('Друзья', NO_DEBT_CATEGORY)).toBe(false);
  });

  it('регистр и «ё» не важны', () => {
    expect(matchesDebtCategory('друзья', 'Друзья')).toBe(true);
    expect(matchesDebtCategory('Зелёные', 'зеленые')).toBe(true);
    expect(matchesDebtCategory('Семья', 'Друзья')).toBe(false);
    expect(debtCategoryKey(' Кредит ')).toBe('кредит');
  });
});

describe('debtCategoryOptions', () => {
  it('сначала использованные (чаще — выше), потом готовые, которых ещё нет', () => {
    const opts = debtCategoryOptions(['Семья', 'Кредит', 'кредит', '', 'Кредит', 'Свои']);
    expect(opts.slice(0, 3)).toEqual(['Кредит', 'Свои', 'Семья']);
    expect(opts).toContain('Друзья');
    expect(opts.filter((o) => o.toLowerCase() === 'кредит')).toHaveLength(1);
    expect(opts.filter((o) => o.toLowerCase() === 'семья')).toHaveLength(1);
  });

  it('без долгов — только готовые подсказки', () => {
    expect(debtCategoryOptions([])).toEqual([...DEBT_CATEGORY_PRESETS]);
  });

  it('usedDebtCategories не добавляет подсказок', () => {
    expect(usedDebtCategories(['', 'Работа', 'работа'])).toEqual(['Работа']);
    expect(usedDebtCategories([])).toEqual([]);
  });
});
