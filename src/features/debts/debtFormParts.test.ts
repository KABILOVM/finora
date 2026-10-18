import { describe, expect, it } from 'vitest';
import { validateNetting, validatePayInParts } from './debtForm';

describe('validateNetting', () => {
  const ok = { walletId: 'w', date: '2026-10-15', openedOn: '2026-10-01' };
  it('нормальный ввод', () => expect(validateNetting(ok)).toEqual({ errors: {}, ok: true }));
  it('нет кошелька', () => expect(validateNetting({ ...ok, walletId: null }).errors.wallet).toBe('Выберите кошелёк'));
  it('в день долга можно, раньше — нет', () => {
    expect(validateNetting({ ...ok, date: '2026-10-01' }).ok).toBe(true);
    expect(validateNetting({ ...ok, date: '2026-09-30' }).errors.date).toBe('Зачёт не может быть раньше даты долга (01.10.2026)');
  });
  it('не дата', () => expect(validateNetting({ ...ok, date: '15.10.2026' }).ok).toBe(false));
});

describe('validatePayInParts', () => {
  const ok = { amountMinor: 15_000, walletId: 'w', startOn: '2026-10-15', today: '2026-10-15', openedOn: '2026-10-01', remainingMinor: 50_000 };
  it('нормальный ввод; первый платёж сегодня — можно', () => expect(validatePayInParts(ok)).toEqual({ errors: {}, ok: true }));
  it('сумма: пусто и не больше нуля', () => {
    expect(validatePayInParts({ ...ok, amountMinor: null }).errors.amount).toBe('Введите сумму платежа');
    expect(validatePayInParts({ ...ok, amountMinor: 0 }).errors.amount).toBe('Сумма платежа должна быть больше нуля');
    expect(validatePayInParts({ ...ok, amountMinor: -5 }).ok).toBe(false);
  });
  it('платёж в месяц больше остатка — не нужен; ровно остаток — можно (один платёж)', () => {
    expect(validatePayInParts({ ...ok, amountMinor: 50_001 }).errors.amount).toBe('Больше остатка долга: хватит одного платежа на остаток');
    expect(validatePayInParts({ ...ok, amountMinor: 50_000 }).ok).toBe(true);
  });
  it('нет кошелька', () => expect(validatePayInParts({ ...ok, walletId: null }).errors.wallet).toBe('Выберите кошелёк'));
  it('первый платёж в прошлом — нельзя: правило сразу «просрочено»', () => {
    expect(validatePayInParts({ ...ok, startOn: '2026-10-14' }).errors.startOn).toBe('Первый платёж — сегодня или позже');
  });
  it('первый платёж раньше долга — нельзя, даже если в будущем относительно сегодня невозможно: долг из будущего', () => {
    expect(validatePayInParts({ ...ok, openedOn: '2026-10-20' }).errors.startOn).toBe('Платёж не может быть раньше даты долга (20.10.2026)');
  });
  it('не дата', () => expect(validatePayInParts({ ...ok, startOn: 'завтра' }).ok).toBe(false));
});
