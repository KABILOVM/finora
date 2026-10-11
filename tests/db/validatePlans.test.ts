import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/db';
import { parseTxFields, parseTxSnapshot } from '@/db/validate';
import { parseBudgetData, parseDebtData, parseRuleData } from '@/db/validatePlans';

/** Границы — те же, что у сервера: суммы 1…1e15, имена 1…80, заметки ≤ 500, даты 2000-01-01…2100-01-01, interval_n 1…1000, auto_post 0/1. */

const budget = { categoryId: null, amountMinor: 100, currency: 'TJS', period: 'month', archivedAt: null };
const debt = { direction: 'lent', counterparty: 'Али', principalMinor: 100, currency: 'TJS', openedOn: '2026-10-01', dueOn: null, note: '', closedAt: null, archivedAt: null };
const rule = {
  kind: 'expense', walletId: 'w1', toWalletId: null, amountMinor: 100, toAmountMinor: null, categoryId: null, debtId: null, note: '',
  frequency: 'monthly', intervalN: 1, startOn: '2026-10-01', endOn: null, autoPost: 0, archivedAt: null,
};
const ok = (fn: () => unknown) => expect(fn).not.toThrow();
const bad = (fn: () => unknown, re?: RegExp) => (re ? expect(fn).toThrow(re) : expect(fn).toThrow(ValidationError));

describe('parseBudgetData', () => {
  it('границы суммы', () => {
    ok(() => parseBudgetData({ ...budget, amountMinor: 1 }));
    ok(() => parseBudgetData({ ...budget, amountMinor: 1e15 }));
    bad(() => parseBudgetData({ ...budget, amountMinor: 0 }));
    bad(() => parseBudgetData({ ...budget, amountMinor: 1e15 + 1 }));
    bad(() => parseBudgetData({ ...budget, amountMinor: -1 }));
    bad(() => parseBudgetData({ ...budget, amountMinor: Number.NaN }));
    bad(() => parseBudgetData({ ...budget, amountMinor: Number.MAX_SAFE_INTEGER + 1 }));
  });
  it('период — только месяц; валюта; категория по желанию', () => {
    bad(() => parseBudgetData({ ...budget, period: 'year' }), /Период бюджета/);
    bad(() => parseBudgetData({ ...budget, currency: 'US' }), /Валюта бюджета/);
    expect(parseBudgetData({ ...budget, categoryId: 'c1' }).categoryId).toBe('c1');
    expect(parseBudgetData({ ...budget, categoryId: undefined }).categoryId).toBeNull();
  });
});

describe('parseDebtData', () => {
  it('имя 1…80 после обрезки пробелов', () => {
    expect(parseDebtData({ ...debt, counterparty: '  Али ' }).counterparty).toBe('Али');
    ok(() => parseDebtData({ ...debt, counterparty: 'я'.repeat(80) }));
    bad(() => parseDebtData({ ...debt, counterparty: 'я'.repeat(81) }));
    bad(() => parseDebtData({ ...debt, counterparty: ' ' }));
    bad(() => parseDebtData({ ...debt, counterparty: 5 }));
  });
  it('смайлик целиком допустим, обрезанный — нет', () => {
    ok(() => parseDebtData({ ...debt, counterparty: 'Али 😀' }));
    bad(() => parseDebtData({ ...debt, counterparty: 'Али \uD83D' }), /Некорректный символ/);
  });
  it('сумма 1…1e15; направление; даты 2000-01-01…2100-01-01', () => {
    ok(() => parseDebtData({ ...debt, principalMinor: 1e15 }));
    bad(() => parseDebtData({ ...debt, principalMinor: 0 }));
    bad(() => parseDebtData({ ...debt, direction: 'x' }));
    ok(() => parseDebtData({ ...debt, openedOn: '2000-01-01' }));
    ok(() => parseDebtData({ ...debt, openedOn: '2100-01-01', dueOn: '2100-01-01' }));
    bad(() => parseDebtData({ ...debt, openedOn: '1999-12-31' }));
    bad(() => parseDebtData({ ...debt, dueOn: '2100-01-02' }));
    bad(() => parseDebtData({ ...debt, openedOn: '2026-1-1' }));
  });
  it('заметка до 500; метки закрытия/архива каноничные', () => {
    ok(() => parseDebtData({ ...debt, note: 'я'.repeat(500) }));
    bad(() => parseDebtData({ ...debt, note: 'я'.repeat(501) }));
    ok(() => parseDebtData({ ...debt, note: undefined }));
    bad(() => parseDebtData({ ...debt, closedAt: '2026-10-01' }), /Дата закрытия/);
    ok(() => parseDebtData({ ...debt, closedAt: '2026-10-01T00:00:00.000Z', archivedAt: '2026-10-01T00:00:00.000Z' }));
  });
});

describe('parseRuleData', () => {
  it('шаг 1…1000, только целый', () => {
    ok(() => parseRuleData({ ...rule, intervalN: 1 }));
    ok(() => parseRuleData({ ...rule, intervalN: 1000 }));
    bad(() => parseRuleData({ ...rule, intervalN: 0 }));
    bad(() => parseRuleData({ ...rule, intervalN: 1001 }));
    bad(() => parseRuleData({ ...rule, intervalN: 1.5 }));
    bad(() => parseRuleData({ ...rule, intervalN: '2' }));
  });
  it('autoPost: только 0 и 1', () => {
    expect(parseRuleData({ ...rule, autoPost: 1 }).autoPost).toBe(1);
    expect(parseRuleData({ ...rule, autoPost: 0 }).autoPost).toBe(0);
    for (const v of [2, -1, true, '1', null, undefined]) bad(() => parseRuleData({ ...rule, autoPost: v }));
  });
  it('даты: начало и конец в границах сервера, конец ≥ начала', () => {
    ok(() => parseRuleData({ ...rule, startOn: '2000-01-01' }));
    ok(() => parseRuleData({ ...rule, startOn: '2100-01-01', endOn: '2100-01-01' }));
    bad(() => parseRuleData({ ...rule, startOn: '1999-12-31' }));
    bad(() => parseRuleData({ ...rule, endOn: '2100-01-02' }));
    bad(() => parseRuleData({ ...rule, endOn: '2026-09-30' }), /раньше начала/);
    ok(() => parseRuleData({ ...rule, endOn: '2026-10-01' }));
  });
  it('частота — одна из четырёх; сумма 1…1e15; форма платежа как у операции', () => {
    for (const f of ['daily', 'weekly', 'monthly', 'yearly']) ok(() => parseRuleData({ ...rule, frequency: f }));
    bad(() => parseRuleData({ ...rule, frequency: 'quarterly' }));
    bad(() => parseRuleData({ ...rule, amountMinor: 0 }));
    ok(() => parseRuleData({ ...rule, amountMinor: 1e15 }));
    bad(() => parseRuleData({ ...rule, toWalletId: 'w2' }), /только у перевода/);
    bad(() => parseRuleData({ ...rule, kind: 'transfer' }), /кошелёк зачисления/);
    bad(() => parseRuleData({ ...rule, kind: 'transfer', toWalletId: 'w1', toAmountMinor: 1 }), /отличаться/);
    bad(() => parseRuleData({ ...rule, kind: 'transfer', toWalletId: 'w2', toAmountMinor: 1, debtId: 'd' }), /не бывает долга/);
    bad(() => parseRuleData({ ...rule, kind: 'transfer', toWalletId: 'w2' }, { requireToAmount: true }), /сумма зачисления/);
    ok(() => parseRuleData({ ...rule, kind: 'transfer', toWalletId: 'w2' }));
  });
  it('заметка до 500; лишние поля не просачиваются в результат', () => {
    bad(() => parseRuleData({ ...rule, note: 'я'.repeat(501) }));
    const out = parseRuleData({ ...rule, dirty: 1, evil: true }) as unknown as Record<string, unknown>;
    expect(out['dirty']).toBeUndefined();
    expect(out['evil']).toBeUndefined();
    expect(out['occurredOn']).toBeUndefined();
  });
});

describe('parseTxFields: debtId и recurringRuleId', () => {
  const tx = { kind: 'expense', walletId: 'w1', amountMinor: 1, occurredOn: '2026-10-01' };
  it('необязательны и читаются как null', () => {
    expect(parseTxFields(tx)).toMatchObject({ debtId: null, recurringRuleId: null });
    expect(parseTxFields({ ...tx, debtId: undefined, recurringRuleId: undefined })).toMatchObject({ debtId: null, recurringRuleId: null });
    expect(parseTxFields({ ...tx, debtId: 'd1', recurringRuleId: 'r1' })).toMatchObject({ debtId: 'd1', recurringRuleId: 'r1' });
  });
  it('долг: у перевода нельзя; id с пробелом нельзя', () => {
    bad(() => parseTxFields({ ...tx, kind: 'transfer', toWalletId: 'w2', toAmountMinor: 1, debtId: 'd1' }), /не бывает долга/);
    bad(() => parseTxFields({ ...tx, debtId: 'd 1' }), /Долг/);
    bad(() => parseTxFields({ ...tx, recurringRuleId: 'r 1' }), /Регулярный платёж/);
    ok(() => parseTxFields({ ...tx, kind: 'transfer', toWalletId: 'w2', toAmountMinor: 1, recurringRuleId: 'r1' }));
  });
});

describe('parseTxSnapshot: перевод хранит комиссию в baseAmountMinor', () => {
  const snap = { baseCurrency: 'TJS', fxRate: null, fxSource: null };
  it('комиссия допустима, когда зачислено меньше списанного; 0 — всегда', () => {
    expect(parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 10, toAmountMinor: 90 })).toMatchObject({ baseAmountMinor: 10, fxRate: null });
    expect(parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 0, toAmountMinor: 100 })).toMatchObject({ baseAmountMinor: 0 });
    expect(parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 0, toAmountMinor: null })).toMatchObject({ baseAmountMinor: 0 });
  });
  it('комиссия при равных/больших суммах зачисления и без суммы — нельзя; курс у перевода — нельзя; предел 1e15', () => {
    bad(() => parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 1, toAmountMinor: 100 }), /комиссия указана/);
    bad(() => parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 1, toAmountMinor: null }), /комиссия указана/);
    bad(() => parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 1, toAmountMinor: 90, fxRate: 1 }), /курс не используется/);
    bad(() => parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: 1e15 + 1, toAmountMinor: 90 }));
    bad(() => parseTxSnapshot('transfer', 100, { ...snap, baseAmountMinor: -1, toAmountMinor: 90 }));
  });
});
