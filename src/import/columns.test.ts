import { describe, expect, it } from 'vitest';
import { headerKey, mapColumns, notZenmoneyMessage } from './columns';

const EN = [
  'date', 'categoryName', 'payee', 'comment', 'outcomeAccountName', 'outcome', 'outcomeCurrencyShortTitle',
  'incomeAccountName', 'income', 'incomeCurrencyShortTitle', 'createdDate', 'changedDate', 'qrCode',
];
const RU = [
  'Дата', 'Категория', 'Получатель', 'Комментарий', 'Счёт списания', 'Сумма списания', 'Валюта списания',
  'Счёт зачисления', 'Сумма зачисления', 'Валюта зачисления',
];

describe('mapColumns', () => {
  it('английские заголовки Дзен-мани', () => {
    const r = mapColumns(EN);
    expect(r).toEqual({
      ok: true,
      index: {
        date: 0, category: 1, payee: 2, comment: 3,
        outcome: { account: 4, amount: 5, currency: 6 },
        income: { account: 7, amount: 8, currency: 9 },
      },
    });
  });

  it('русские заголовки', () => {
    const r = mapColumns(RU);
    expect(r.ok && r.index.outcome).toEqual({ account: 4, amount: 5, currency: 6 });
    expect(r.ok && r.index.income).toEqual({ account: 7, amount: 8, currency: 9 });
    expect(r.ok && r.index.category).toBe(1);
  });

  it('регистр, пробелы, подчёркивания, «ё/е» и BOM не важны', () => {
    const r = mapColumns(['\ufeff DATE ', 'Outcome_Account Name', ' OUTCOME', 'outcome currency short title', 'СЧЕТ ЗАЧИСЛЕНИЯ', 'сумма  зачисления', 'ВАЛЮТА ЗАЧИСЛЕНИЯ']);
    expect(r.ok).toBe(true);
    expect(r.ok && r.index.date).toBe(0);
    expect(r.ok && r.index.outcome).toEqual({ account: 1, amount: 2, currency: 3 });
    expect(r.ok && r.index.income).toEqual({ account: 4, amount: 5, currency: 6 });
  });

  it('достаточно даты и одной стороны', () => {
    const r = mapColumns(['date', 'incomeAccountName', 'income', 'incomeCurrencyShortTitle']);
    expect(r.ok && r.index.outcome).toBeUndefined();
    expect(r.ok && r.index.income).toBeDefined();
  });

  it('нет даты — отказ словами, с перечнем найденных столбцов', () => {
    const r = mapColumns(['Имя', 'Телефон', 'Почта']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/^Не похоже на файл Дзен-мани\. Нашли столбцы: Имя, Телефон, Почта\./);
    }
  });

  it('нет ни одной полной стороны (счёт + сумма + валюта) — отказ', () => {
    expect(mapColumns(['date', 'outcomeAccountName', 'outcome']).ok).toBe(false);
    expect(mapColumns(['date', 'comment', 'payee']).ok).toBe(false);
    expect(mapColumns(['outcomeAccountName', 'outcome', 'outcomeCurrencyShortTitle']).ok).toBe(false);
  });

  it('дубли заголовков: берётся первый', () => {
    const r = mapColumns(['date', 'date', 'outcomeAccountName', 'outcome', 'outcomeCurrencyShortTitle']);
    expect(r.ok && r.index.date).toBe(0);
  });
});

describe('notZenmoneyMessage', () => {
  it('длинные и многочисленные заголовки укорачиваются', () => {
    const many = Array.from({ length: 30 }, (_, i) => `col${i}`);
    const msg = notZenmoneyMessage(many);
    expect(msg).toContain('col14');
    expect(msg).not.toContain('col15');
    expect(msg).toContain('и другие');
    expect(notZenmoneyMessage(['x'.repeat(100)])).toContain('…');
  });

  it('пустой файл заголовков', () => {
    expect(notZenmoneyMessage([])).toContain('Нашли столбцы: ни одного');
  });
});

describe('headerKey', () => {
  it('нормализация', () => {
    expect(headerKey('Счёт списания')).toBe('счетсписания');
    expect(headerKey('outcome_Account Name')).toBe('outcomeaccountname');
    expect(headerKey('\ufeffDate')).toBe('date');
  });
});
