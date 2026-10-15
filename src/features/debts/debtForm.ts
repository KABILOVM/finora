import { COUNTERPARTY_MAX } from '@/db';
import type { DebtDirection, IsoDate, Minor } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { checkDate, NOTE_MAX } from '@/features/transactions/txForm';
import { ruDateShort } from './debtText';

/** Чистая проверка форм «Новый долг» и «Платёж» (без React и без базы). Тексты — те, что увидит человек. */

export interface DebtFormState {
  direction: DebtDirection;
  counterparty: string;
  currency: string;
  amountMinor: Minor | null;
  openedOn: IsoDate;
  /** false — срока нет. */
  hasDue: boolean;
  dueOn: IsoDate;
  note: string;
}

export interface DebtFormErrors {
  counterparty?: string;
  amount?: string;
  openedOn?: string;
  dueOn?: string;
  note?: string;
  form?: string;
}

export interface DebtFormValue {
  counterparty: string;
  principalMinor: Minor;
  openedOn: IsoDate;
  dueOn: IsoDate | null;
  note: string;
}

/** Пробелы по краям срезаются, внутренние повторы схлопываются: «  Али   шер » → «Али шер». */
export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function emptyDebtForm(direction: DebtDirection, currency: string, today: IsoDate): DebtFormState {
  return { direction, counterparty: '', currency, amountMinor: null, openedOn: today, hasDue: false, dueOn: addDays(today, 30), note: '' };
}

export function validateDebtForm(f: DebtFormState): { errors: DebtFormErrors; value: DebtFormValue | null } {
  const errors: DebtFormErrors = {};
  const counterparty = cleanName(f.counterparty);
  if (counterparty === '') errors.counterparty = f.direction === 'lent' ? 'Укажите, кому вы дали' : 'Укажите, у кого вы взяли';
  else if (counterparty.length > COUNTERPARTY_MAX) errors.counterparty = `Имя не длиннее ${COUNTERPARTY_MAX} символов (сейчас ${counterparty.length})`;

  if (f.amountMinor === null) errors.amount = 'Введите сумму долга';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма долга должна быть больше нуля';

  const dateError = checkDate(f.openedOn);
  if (dateError) errors.openedOn = dateError;

  let dueOn: IsoDate | null = null;
  if (f.hasDue) {
    const dueError = checkDate(f.dueOn);
    if (dueError) errors.dueOn = dueError;
    else if (!dateError && f.dueOn < f.openedOn) errors.dueOn = `Срок возврата не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
    else dueOn = f.dueOn;
  }

  const note = f.note.trim();
  if (note.length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${note.length})`;

  if (Object.keys(errors).length > 0 || f.amountMinor === null) return { errors, value: null };
  return { errors, value: { counterparty, principalMinor: f.amountMinor, openedOn: f.openedOn, dueOn, note } };
}

export interface PaymentFormInput {
  amountMinor: Minor | null;
  walletId: string | null;
  date: IsoDate;
  note: string;
  /** Остаток долга сейчас. */
  remainingMinor: Minor;
  /** Дата долга: платёж раньше неё не принимаем. */
  openedOn: IsoDate;
  /** Человек отметил «Это переплата». */
  overpayConfirmed: boolean;
}

export interface PaymentFormErrors {
  amount?: string;
  wallet?: string;
  date?: string;
  note?: string;
  overpay?: string;
}

/** Насколько платёж больше остатка (0 — не больше). Целая арифметика: суммы безопасные целые, разность не выходит за ±2·MAX_SAFE. */
export const overpayOf = (amountMinor: Minor | null, remainingMinor: Minor): Minor =>
  amountMinor !== null && amountMinor > remainingMinor ? amountMinor - remainingMinor : 0;

export function validatePayment(f: PaymentFormInput): { errors: PaymentFormErrors; ok: boolean } {
  const errors: PaymentFormErrors = {};
  if (f.amountMinor === null) errors.amount = 'Введите сумму платежа';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма платежа должна быть больше нуля';
  if (f.walletId === null) errors.wallet = 'Выберите кошелёк';
  const dateError = checkDate(f.date);
  if (dateError) errors.date = dateError;
  else if (f.date < f.openedOn) errors.date = `Платёж не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
  if (f.note.trim().length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${f.note.trim().length})`;
  if (overpayOf(f.amountMinor, f.remainingMinor) > 0 && !f.overpayConfirmed) {
    errors.overpay = 'Платёж больше остатка. Если это переплата, отметьте галочку ниже; иначе уменьшите сумму.';
  }
  return { errors, ok: Object.keys(errors).length === 0 };
}

export interface TopUpFormInput {
  amountMinor: Minor | null;
  /** Записывать ли движение денег по кошельку. */
  moneyOn: boolean;
  walletId: string | null;
  date: IsoDate;
  note: string;
  /** Дата долга: пополнение раньше неё не принимаем. */
  openedOn: IsoDate;
  /** false — срок не указан (его не меняем). */
  hasDue: boolean;
  dueOn: IsoDate;
}

export interface TopUpFormErrors {
  amount?: string;
  wallet?: string;
  date?: string;
  dueOn?: string;
  note?: string;
}

/** «Добавить ещё в долг»: сумма больше нуля, кошелёк (если деньги двигаются), дата не раньше долга, срок не раньше пополнения. */
export function validateTopUp(f: TopUpFormInput): { errors: TopUpFormErrors; ok: boolean } {
  const errors: TopUpFormErrors = {};
  if (f.amountMinor === null) errors.amount = 'Введите сумму пополнения';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма пополнения должна быть больше нуля';
  if (f.moneyOn && f.walletId === null) errors.wallet = 'Выберите кошелёк';
  const dateError = checkDate(f.date);
  if (dateError) errors.date = dateError;
  else if (f.date < f.openedOn) errors.date = `Пополнение не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
  if (f.hasDue) {
    const dueError = checkDate(f.dueOn);
    if (dueError) errors.dueOn = dueError;
    else if (!dateError && f.dueOn < f.date) errors.dueOn = `Срок возврата не может быть раньше даты пополнения (${ruDateShort(f.date)})`;
  }
  if (f.note.trim().length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${f.note.trim().length})`;
  return { errors, ok: Object.keys(errors).length === 0 };
}

export interface NettingFormInput {
  walletId: string | null;
  date: IsoDate;
  /** Самая поздняя дата среди долгов, которые зачитываются: зачёт раньше неё не принимаем. */
  openedOn: IsoDate;
}

export interface NettingFormErrors {
  wallet?: string;
  date?: string;
}

/** Взаимозачёт: нужен кошелёк (платежи по обоим долгам идут через него) и дата не раньше самого позднего из долгов. */
export function validateNetting(f: NettingFormInput): { errors: NettingFormErrors; ok: boolean } {
  const errors: NettingFormErrors = {};
  if (f.walletId === null) errors.wallet = 'Выберите кошелёк';
  const dateError = checkDate(f.date);
  if (dateError) errors.date = dateError;
  else if (f.date < f.openedOn) errors.date = `Зачёт не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
  return { errors, ok: Object.keys(errors).length === 0 };
}

export interface PayInPartsFormInput {
  amountMinor: Minor | null;
  walletId: string | null;
  startOn: IsoDate;
  today: IsoDate;
  /** Дата долга: платёж раньше неё не принимаем. */
  openedOn: IsoDate;
}

export interface PayInPartsFormErrors {
  amount?: string;
  wallet?: string;
  startOn?: string;
}

/** «Платить частями»: сумма больше нуля, кошелёк, первый платёж — сегодня или позже (иначе правило сразу «просрочено») и не раньше долга. */
export function validatePayInParts(f: PayInPartsFormInput): { errors: PayInPartsFormErrors; ok: boolean } {
  const errors: PayInPartsFormErrors = {};
  if (f.amountMinor === null) errors.amount = 'Введите сумму платежа';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма платежа должна быть больше нуля';
  if (f.walletId === null) errors.wallet = 'Выберите кошелёк';
  const dateError = checkDate(f.startOn);
  if (dateError) errors.startOn = dateError;
  else if (f.startOn < f.today) errors.startOn = 'Первый платёж — сегодня или позже';
  else if (f.startOn < f.openedOn) errors.startOn = `Платёж не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
  return { errors, ok: Object.keys(errors).length === 0 };
}
