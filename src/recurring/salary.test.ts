import { describe, expect, it } from 'vitest';
import { findSalaryCategoryId, hasSalaryRule, salaryPrefill, SALARY_NOTE } from './salary';

const cat = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'income' as 'income' | 'expense',
  name: 'Зарплата',
  deletedAt: null as string | null,
  archivedAt: null as string | null,
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  kind: 'income' as 'income' | 'expense' | 'transfer',
  categoryId: null as string | null,
  note: '',
  archivedAt: null as string | null,
  deletedAt: null as string | null,
  ...over,
});

describe('findSalaryCategoryId', () => {
  it('находит доходную категорию «Зарплата» (регистр не важен)', () => {
    expect(findSalaryCategoryId([cat({ id: 'x', name: 'Прочее' }), cat({ id: 'z', name: ' зарплата ' })])).toBe('z');
  });

  it('расходная «Зарплата», удалённая и архивная — не подходят', () => {
    expect(findSalaryCategoryId([cat({ kind: 'expense' })])).toBeNull();
    expect(findSalaryCategoryId([cat({ deletedAt: '2026-10-01T00:00:00Z' })])).toBeNull();
    expect(findSalaryCategoryId([cat({ archivedAt: '2026-10-01T00:00:00Z' })])).toBeNull();
    expect(findSalaryCategoryId([])).toBeNull();
  });
});

describe('hasSalaryRule', () => {
  it('доход в категории «Зарплата» — это зарплата, что бы ни было в заметке', () => {
    expect(hasSalaryRule([rule({ categoryId: 'c1', note: 'Оклад' })], 'c1')).toBe(true);
  });

  it('доход с заметкой «Зарплата» / «ЗП» без категории — тоже', () => {
    expect(hasSalaryRule([rule({ note: 'Зарплата' })], null)).toBe(true);
    expect(hasSalaryRule([rule({ note: 'зарплата за месяц' })], 'c1')).toBe(true);
    expect(hasSalaryRule([rule({ note: 'ЗП' })], null)).toBe(true);
    expect(hasSalaryRule([rule({ note: ' зп, аванс' })], null)).toBe(true);
  });

  it('похожие слова зарплатой не считаются', () => {
    expect(hasSalaryRule([rule({ note: 'Зпт' })], null)).toBe(false);
    expect(hasSalaryRule([rule({ note: 'Аренда квартиры' })], null)).toBe(false);
    expect(hasSalaryRule([rule({ note: 'Подработка', categoryId: 'other' })], 'c1')).toBe(false);
  });

  it('расход «Зарплата сотруднику», архивный и удалённый платежи — не считаются', () => {
    expect(hasSalaryRule([rule({ kind: 'expense', note: 'Зарплата няне' })], null)).toBe(false);
    expect(hasSalaryRule([rule({ note: 'Зарплата', archivedAt: '2026-10-01T00:00:00Z' })], null)).toBe(false);
    expect(hasSalaryRule([rule({ note: 'Зарплата', deletedAt: '2026-10-01T00:00:00Z' })], null)).toBe(false);
    expect(hasSalaryRule([], 'c1')).toBe(false);
  });

  it('без категории «Зарплата» категорию платежа не сравнивают с null', () => {
    expect(hasSalaryRule([rule({ categoryId: null })], null)).toBe(false);
  });
});

describe('salaryPrefill', () => {
  it('доход раз в месяц, заметка «Зарплата», без автопроведения', () => {
    expect(salaryPrefill('c1')).toEqual({
      kind: 'income',
      categoryId: 'c1',
      note: SALARY_NOTE,
      frequency: 'monthly',
      intervalText: '1',
      autoPost: false,
    });
  });

  it('категории нет — без неё', () => {
    expect(salaryPrefill(null).categoryId).toBeNull();
  });
});
