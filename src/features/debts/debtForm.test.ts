import { describe, expect, it } from 'vitest';
import { cleanName, emptyDebtForm, isDebtFormDirty, overpayOf, patchDebtForm, planOfForm, validateDebtForm, validatePayment, validateTopUp, type DebtFormState, type TopUpFormInput } from './debtForm';

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
    expect(r.value).toEqual({
      counterparty: 'Али шер', principalMinor: 50_000, interestMinor: null, interestRateBp: null, termMonths: null, openedOn: '2026-10-15', dueOn: null, note: '',
    });
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


describe('isDebtFormDirty: есть ли что терять при закрытии окна', () => {
  const start = emptyDebtForm('lent', 'TJS', '2026-10-15');
  it('новый долг: имя, сумма и заметка — ввод; направление и дата — нет', () => {
    expect(isDebtFormDirty(start, start, false)).toBe(false);
    expect(isDebtFormDirty({ ...start, direction: 'borrowed', openedOn: '2026-10-01', hasDue: true }, start, false)).toBe(false);
    expect(isDebtFormDirty({ ...start, counterparty: ' ' }, start, false)).toBe(false);
    expect(isDebtFormDirty({ ...start, counterparty: 'Али' }, start, false)).toBe(true);
    expect(isDebtFormDirty({ ...start, amountMinor: 100 }, start, false)).toBe(true);
    expect(isDebtFormDirty({ ...start, note: 'на ремонт' }, start, false)).toBe(true);
  });
  it('правка: любое отличие; срок сравнивается, только если он включён', () => {
    expect(isDebtFormDirty({ ...start, openedOn: '2026-10-01' }, start, true)).toBe(true);
    expect(isDebtFormDirty({ ...start, direction: 'borrowed' }, start, true)).toBe(true);
    expect(isDebtFormDirty({ ...start, dueOn: '2027-01-01' }, start, true)).toBe(false); // срока нет — дата в поле не в счёт
    expect(isDebtFormDirty({ ...start, hasDue: true, dueOn: '2027-01-01' }, start, true)).toBe(true);
  });
});


describe('проценты в форме долга', () => {
  const credit = (over: Partial<DebtFormState> = {}): DebtFormState =>
    form({ direction: 'borrowed', counterparty: 'Банк', amountMinor: 1_000_000, hasInterest: true, rateText: '24', termText: '12', ...over });

  it('ставка и срок сами считают проценты за весь срок (аннуитет), пока сумму не вводили руками', () => {
    const f = patchDebtForm(credit(), { rateText: '24' });
    expect(f.interestMinor).toBe(134_715);
    expect(f.interestManual).toBe(false);
    expect(planOfForm(f)).toMatchObject({ paymentMinor: 94_560, interestMinor: 134_715 });
  });

  it('включили проценты — посчитались; сменили сумму долга, ставку, срок — пересчитались', () => {
    let f = patchDebtForm(form({ direction: 'borrowed', amountMinor: 1_000_000, rateText: '24', termText: '12' }), { hasInterest: true });
    expect(f.interestMinor).toBe(134_715);
    f = patchDebtForm(f, { amountMinor: 2_000_000 });
    expect(Math.abs(f.interestMinor! - 2 * 134_715)).toBeLessThanOrEqual(5); // вдвое больше долг — вдвое больше процентов (с точностью округления графика)
    f = patchDebtForm(f, { termText: '24' });
    expect(f.interestMinor).toBeGreaterThan(269_430);
    f = patchDebtForm(f, { rateText: '' });
    expect(f.interestMinor).toBeNull(); // без ставки считать нечего
  });

  it('сумма, введённая руками, пересчётом не трогается; очистка поля возвращает автоматический расчёт', () => {
    let f = patchDebtForm(credit(), { rateText: '24' });
    f = patchDebtForm(f, { interestMinor: 150_000 });
    expect(f).toMatchObject({ interestMinor: 150_000, interestManual: true });
    f = patchDebtForm(f, { termText: '24', amountMinor: 3_000_000 });
    expect(f.interestMinor).toBe(150_000);
    f = patchDebtForm(f, { interestMinor: null });
    expect(f.interestManual).toBe(false);
    f = patchDebtForm(f, { termText: '12' });
    expect(f.interestMinor).toBe(patchDebtForm(credit({ amountMinor: 3_000_000 }), { rateText: '24' }).interestMinor);
  });

  it('проценты выключены — ничего не считается и в долг не попадает', () => {
    const f = patchDebtForm(form({ rateText: '24', termText: '12' }), { amountMinor: 1_000_000 });
    expect(f.interestMinor).toBeNull();
    const r = validateDebtForm({ ...f, interestMinor: 123 }); // даже если в форме остался хвост
    expect(r.value).toMatchObject({ interestMinor: null, interestRateBp: null, termMonths: null });
  });

  it('проверка: ставка, срок и сумма процентов читаются; значения уходят в долг', () => {
    const f = patchDebtForm(credit(), { rateText: '24,5' });
    const r = validateDebtForm(f);
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({ principalMinor: 1_000_000, interestMinor: f.interestMinor, interestRateBp: 2450, termMonths: 12 });
  });

  it('можно указать только сумму процентов по договору — без ставки и срока', () => {
    const f = patchDebtForm(credit({ rateText: '', termText: '' }), { interestMinor: 120_000 });
    const r = validateDebtForm(f);
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({ interestMinor: 120_000, interestRateBp: null, termMonths: null });
  });

  it('понятные ошибки: нечитаемая ставка и срок, нет суммы процентов, ноль', () => {
    expect(validateDebtForm(credit({ rateText: 'abc', interestMinor: 1 })).errors.rate).toMatch(/число/);
    expect(validateDebtForm(credit({ rateText: '0', interestMinor: 1 })).errors.rate).toMatch(/больше нуля/);
    expect(validateDebtForm(credit({ rateText: '1001', interestMinor: 1 })).errors.rate).toMatch(/1000/);
    expect(validateDebtForm(credit({ termText: '1,5', interestMinor: 1 })).errors.term).toMatch(/целое/);
    expect(validateDebtForm(credit({ termText: '601', interestMinor: 1 })).errors.term).toMatch(/600/);
    expect(validateDebtForm(credit({ rateText: '', termText: '', interestMinor: null })).errors.interest).toMatch(/Укажите проценты/);
    expect(validateDebtForm(credit({ interestMinor: 0 })).errors.interest).toMatch(/больше нуля/);
    expect(validateDebtForm(credit({ rateText: '', termText: '', interestMinor: 2_000_000_000_000_000 })).errors.interest).toMatch(/слишком велика/);
    expect(validateDebtForm(credit({ interestMinor: 1, rateText: 'abc' })).value).toBeNull();
  });

  it('ввод процентов считается несохранённым вводом', () => {
    const base = form();
    expect(isDebtFormDirty(base, base, false)).toBe(false);
    expect(isDebtFormDirty({ ...base, hasInterest: true }, base, false)).toBe(true);
    const on = credit();
    expect(isDebtFormDirty(on, on, true)).toBe(false);
    expect(isDebtFormDirty({ ...on, rateText: '25' }, on, true)).toBe(true);
    expect(isDebtFormDirty({ ...on, termText: '13' }, on, true)).toBe(true);
    expect(isDebtFormDirty({ ...on, interestMinor: 1 }, on, true)).toBe(true);
  });
});
