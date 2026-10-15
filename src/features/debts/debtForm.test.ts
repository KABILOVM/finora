import { describe, expect, it } from 'vitest';
import { cleanName, emptyDebtForm, overpayOf, validateDebtForm, validatePayment, validateTopUp, type DebtFormState, type TopUpFormInput } from './debtForm';

const form = (over: Partial<DebtFormState> = {}): DebtFormState => ({
  ...emptyDebtForm('lent', 'TJS', '2026-10-15'),
  counterparty: 'Алишер',
  amountMinor: 50_000,
  ...over,
});

describe('validateDebtForm', () => {
  it('нормальная форма: имя очищено, срока нет', () => {
    const r = validateDebtForm(form({ counterparty: '  Али   шер ' }));
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({ counterparty: 'Али шер', principalMinor: 50_000, openedOn: '2026-10-15', dueOn: null, note: '' });
  });
  it('пустое имя и нет суммы', () => {
    const r = validateDebtForm(form({ counterparty: '   ', amountMinor: null }));
    expect(r.value).toBeNull();
    expect(r.errors.counterparty).toBe('Укажите, кому вы дали');
    expect(r.errors.amount).toBe('Введите сумму долга');
    expect(validateDebtForm(form({ direction: 'borrowed', counterparty: '' })).errors.counterparty).toBe('Укажите, у кого вы взяли');
  });
  it('ноль — не сумма', () => {
    expect(validateDebtForm(form({ amountMinor: 0 })).errors.amount).toBe('Сумма долга должна быть больше нуля');
  });
  it('имя длиннее 80 символов', () => {
    expect(validateDebtForm(form({ counterparty: 'я'.repeat(81) })).errors.counterparty).toMatch(/не длиннее 80/);
    expect(validateDebtForm(form({ counterparty: 'я'.repeat(80) })).value).not.toBeNull();
  });
  it('срок: раньше даты долга нельзя; в день долга можно; несуществующая дата — ошибка', () => {
    expect(validateDebtForm(form({ hasDue: true, dueOn: '2026-10-14' })).errors.dueOn).toMatch(/раньше даты долга/);
    expect(validateDebtForm(form({ hasDue: true, dueOn: '2026-10-15' })).value?.dueOn).toBe('2026-10-15');
    expect(validateDebtForm(form({ hasDue: true, dueOn: '2026-02-30' })).errors.dueOn).toBeTruthy();
    expect(validateDebtForm(form({ hasDue: true, dueOn: '' })).errors.dueOn).toBe('Укажите дату');
  });
  it('срок выключен — его значение игнорируется', () => {
    expect(validateDebtForm(form({ hasDue: false, dueOn: 'мусор' })).value?.dueOn).toBeNull();
  });
  it('дата долга за границами 2000–2100', () => {
    expect(validateDebtForm(form({ openedOn: '1999-12-31' })).errors.openedOn).toBe('Дата должна быть между 2000 и 2100 годом');
  });
  it('заметка до 500 символов', () => {
    expect(validateDebtForm(form({ note: 'x'.repeat(501) })).errors.note).toMatch(/не длиннее 500/);
    expect(validateDebtForm(form({ note: ' x '.repeat(10) })).value?.note).toBe('x  x  x  x  x  x  x  x  x  x');
  });
  it('cleanName', () => {
    expect(cleanName('\n  a \t b  ')).toBe('a b');
  });
});

describe('переплата и проверка платежа', () => {
  const ok = { amountMinor: 20_000, walletId: 'w', date: '2026-10-20', note: '', remainingMinor: 50_000, openedOn: '2026-10-15', overpayConfirmed: false };
  it('overpayOf: ровно остаток — не переплата; на копейку больше — переплата', () => {
    expect(overpayOf(50_000, 50_000)).toBe(0);
    expect(overpayOf(50_001, 50_000)).toBe(1);
    expect(overpayOf(null, 50_000)).toBe(0);
    expect(overpayOf(10, 0)).toBe(10);
  });
  it('нормальный платёж', () => {
    expect(validatePayment(ok)).toEqual({ errors: {}, ok: true });
    expect(validatePayment({ ...ok, amountMinor: 50_000 }).ok).toBe(true);
  });
  it('больше остатка — только с явным подтверждением', () => {
    const over = { ...ok, amountMinor: 50_001 };
    expect(validatePayment(over).ok).toBe(false);
    expect(validatePayment(over).errors.overpay).toMatch(/больше остатка/);
    expect(validatePayment({ ...over, overpayConfirmed: true }).ok).toBe(true);
  });
  it('долг погашен (остаток 0): любой платёж — переплата', () => {
    expect(validatePayment({ ...ok, remainingMinor: 0, amountMinor: 1 }).errors.overpay).toBeTruthy();
  });
  it('нет суммы, кошелька; ноль; дата раньше долга', () => {
    expect(validatePayment({ ...ok, amountMinor: null }).errors.amount).toBe('Введите сумму платежа');
    expect(validatePayment({ ...ok, amountMinor: 0 }).errors.amount).toBe('Сумма платежа должна быть больше нуля');
    expect(validatePayment({ ...ok, walletId: null }).errors.wallet).toBe('Выберите кошелёк');
    expect(validatePayment({ ...ok, date: '2026-10-14' }).errors.date).toMatch(/раньше даты долга/);
    expect(validatePayment({ ...ok, date: '2026-10-15' }).ok).toBe(true);
  });
});

describe('validateTopUp: «добавить ещё в долг»', () => {
  const top = (over: Partial<TopUpFormInput> = {}): TopUpFormInput => ({
    amountMinor: 30_000,
    moneyOn: true,
    walletId: 'w1',
    date: '2026-10-15',
    note: '',
    openedOn: '2026-10-01',
    hasDue: false,
    dueOn: '2026-11-14',
    ...over,
  });

  it('нормальная форма — без ошибок; «на бумаге» кошелёк не нужен', () => {
    expect(validateTopUp(top())).toEqual({ errors: {}, ok: true });
    expect(validateTopUp(top({ moneyOn: false, walletId: null })).ok).toBe(true);
  });
  it('нет суммы, ноль и минус', () => {
    expect(validateTopUp(top({ amountMinor: null })).errors.amount).toBe('Введите сумму пополнения');
    expect(validateTopUp(top({ amountMinor: 0 })).errors.amount).toBe('Сумма пополнения должна быть больше нуля');
    expect(validateTopUp(top({ amountMinor: -5 })).errors.amount).toBe('Сумма пополнения должна быть больше нуля');
  });
  it('деньги двигаются, а кошелька нет', () => {
    expect(validateTopUp(top({ walletId: null })).errors.wallet).toBe('Выберите кошелёк');
  });
  it('дата не раньше даты долга; в день долга можно', () => {
    expect(validateTopUp(top({ date: '2026-09-30' })).errors.date).toBe('Пополнение не может быть раньше даты долга (01.10.2026)');
    expect(validateTopUp(top({ date: '2026-10-01' })).ok).toBe(true);
    expect(validateTopUp(top({ date: 'вчера' })).errors.date).toBeTruthy();
  });
  it('срок не раньше пополнения (проверяется, только если указан)', () => {
    expect(validateTopUp(top({ hasDue: true, dueOn: '2026-10-14' })).errors.dueOn).toBe('Срок возврата не может быть раньше даты пополнения (15.10.2026)');
    expect(validateTopUp(top({ hasDue: true, dueOn: '2026-10-15' })).ok).toBe(true);
    expect(validateTopUp(top({ hasDue: false, dueOn: '2020-01-01' })).ok).toBe(true);
  });
  it('длинная заметка', () => {
    expect(validateTopUp(top({ note: 'я'.repeat(501) })).errors.note).toMatch(/Заметка не длиннее 500/);
    expect(validateTopUp(top({ note: 'я'.repeat(500) })).ok).toBe(true);
  });
});

