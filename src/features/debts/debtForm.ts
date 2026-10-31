import { COUNTERPARTY_MAX } from '@/db';
import { DEBT_CATEGORY_MAX } from '@/domain/debtCategory';
import { annuityPlan, interestFor, parseRateBp, parseTermMonths, rateError, termError, INTEREST_MINOR_MAX, type AnnuityPlan } from '@/domain/interest';
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
  /** Категория долга как ввёл человек; '' — без категории. Чистится при проверке (domain/debtCategory.ts). */
  category: string;
  /** Включён блок «Проценты» (кредит в банке). */
  hasInterest: boolean;
  /** Ставка, % годовых — как ввёл человек ('24', '18,5'). */
  rateText: string;
  /** Срок в месяцах — как ввёл человек. */
  termText: string;
  /** Проценты за весь срок: посчитаны по ставке и сроку или введены руками. */
  interestMinor: Minor | null;
  /** Сумму процентов ввели руками: пересчёт по ставке и сроку её больше не меняет. */
  interestManual: boolean;
}

/** Расчёт процентов по форме: сумма долга, ставка и срок заданы и годятся — проценты за срок (аннуитет); иначе null. */
export function planOfForm(f: Pick<DebtFormState, 'amountMinor' | 'rateText' | 'termText'>): AnnuityPlan | null {
  if (f.amountMinor === null || f.amountMinor <= 0) return null;
  const rate = parseRateBp(f.rateText);
  const term = parseTermMonths(f.termText);
  if (rate === null || term === null) return null;
  return annuityPlan(f.amountMinor, rate, term);
}

/**
 * Правка формы с пересчётом процентов: пока сумму процентов не вводили руками, она следует за суммой долга, ставкой и сроком.
 * Ввод суммы процентов руками (непустой) фиксирует её; очистка поля возвращает автоматический расчёт.
 */
export function patchDebtForm(prev: DebtFormState, patch: Partial<DebtFormState>): DebtFormState {
  const next: DebtFormState = { ...prev, ...patch };
  if ('interestMinor' in patch) next.interestManual = patch.interestMinor !== null && patch.interestMinor !== undefined;
  const touchesCalc = 'amountMinor' in patch || 'rateText' in patch || 'termText' in patch || 'hasInterest' in patch;
  if (next.hasInterest && !next.interestManual && touchesCalc) {
    const rate = parseRateBp(next.rateText);
    const term = parseTermMonths(next.termText);
    next.interestMinor =
      next.amountMinor !== null && next.amountMinor > 0 && rate !== null && term !== null ? interestFor(next.amountMinor, rate, term) : null;
  }
  return next;
}

/** Есть ли в форме долга несохранённый ввод. Новый долг: имя, сумма, заметка; правка: любое отличие от долга. */
export function isDebtFormDirty(form: DebtFormState, initial: DebtFormState, editing: boolean): boolean {
  const typed =
    form.counterparty.trim() !== initial.counterparty.trim() ||
    form.amountMinor !== initial.amountMinor ||
    form.note !== initial.note ||
    cleanName(form.category) !== cleanName(initial.category) ||
    form.hasInterest !== initial.hasInterest ||
    (form.hasInterest && (form.rateText !== initial.rateText || form.termText !== initial.termText || form.interestMinor !== initial.interestMinor));
  if (!editing) return typed;
  return (
    typed ||
    form.direction !== initial.direction ||
    form.currency !== initial.currency ||
    form.openedOn !== initial.openedOn ||
    form.hasDue !== initial.hasDue ||
    (form.hasDue && form.dueOn !== initial.dueOn)
  );
}

export interface DebtFormErrors {
  counterparty?: string;
  amount?: string;
  openedOn?: string;
  dueOn?: string;
  note?: string;
  category?: string;
  rate?: string;
  term?: string;
  interest?: string;
  form?: string;
}

export interface DebtFormValue {
  counterparty: string;
  principalMinor: Minor;
  /** Проценты за весь срок; null — без процентов (тогда ставка и срок тоже null). */
  interestMinor: Minor | null;
  interestRateBp: number | null;
  termMonths: number | null;
  openedOn: IsoDate;
  dueOn: IsoDate | null;
  note: string;
  /** Категория долга, очищенная; '' — без категории. */
  category: string;
}

/** Пробелы по краям срезаются, внутренние повторы схлопываются: «  Али   шер » → «Али шер». */
export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function emptyDebtForm(direction: DebtDirection, currency: string, today: IsoDate): DebtFormState {
  return {
    direction,
    counterparty: '',
    currency,
    amountMinor: null,
    openedOn: today,
    hasDue: false,
    dueOn: addDays(today, 30),
    note: '',
    category: '',
    hasInterest: false,
    rateText: '',
    termText: '',
    interestMinor: null,
    interestManual: false,
  };
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

  // Категория необязательна; длинную не обрезаем молча, а просим сократить
  const category = cleanName(f.category);
  const categoryLength = Array.from(category).length;
  if (categoryLength > DEBT_CATEGORY_MAX) errors.category = `Категория не длиннее ${DEBT_CATEGORY_MAX} символов (сейчас ${categoryLength})`;

  // Проценты: ставка и срок необязательны (сумму можно ввести по договору), но если введены — должны читаться
  let interestMinor: Minor | null = null;
  let interestRateBp: number | null = null;
  let termMonths: number | null = null;
  if (f.hasInterest) {
    if (f.rateText.trim() !== '') {
      const bp = parseRateBp(f.rateText);
      const e = rateError(bp);
      if (e) errors.rate = e;
      else interestRateBp = bp;
    }
    if (f.termText.trim() !== '') {
      const months = parseTermMonths(f.termText);
      const e = termError(months);
      if (e) errors.term = e;
      else termMonths = months;
    }
    if (f.interestMinor === null) errors.interest = 'Укажите проценты: введите ставку и срок или сумму процентов за весь срок';
    else if (f.interestMinor <= 0) errors.interest = 'Проценты должны быть больше нуля';
    else if (f.interestMinor > INTEREST_MINOR_MAX) errors.interest = 'Сумма процентов слишком велика';
    else interestMinor = f.interestMinor;
  }

  if (Object.keys(errors).length > 0 || f.amountMinor === null) return { errors, value: null };
  return {
    errors,
    value: { counterparty, principalMinor: f.amountMinor, interestMinor, interestRateBp, termMonths, openedOn: f.openedOn, dueOn, note, category },
  };
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
  /** Остаток долга: платёж в месяц больше него не нужен. */
  remainingMinor: Minor;
}

export interface PayInPartsFormErrors {
  amount?: string;
  wallet?: string;
  startOn?: string;
}

/**
 * «Платить частями»: сумма больше нуля и не больше остатка долга, кошелёк, первый платёж — сегодня или позже (иначе правило сразу
 * «просрочено») и не раньше долга.
 */
export function validatePayInParts(f: PayInPartsFormInput): { errors: PayInPartsFormErrors; ok: boolean } {
  const errors: PayInPartsFormErrors = {};
  if (f.amountMinor === null) errors.amount = 'Введите сумму платежа';
  else if (f.amountMinor <= 0) errors.amount = 'Сумма платежа должна быть больше нуля';
  else if (f.amountMinor > f.remainingMinor) errors.amount = 'Больше остатка долга: хватит одного платежа на остаток';
  if (f.walletId === null) errors.wallet = 'Выберите кошелёк';
  const dateError = checkDate(f.startOn);
  if (dateError) errors.startOn = dateError;
  else if (f.startOn < f.today) errors.startOn = 'Первый платёж — сегодня или позже';
  else if (f.startOn < f.openedOn) errors.startOn = `Платёж не может быть раньше даты долга (${ruDateShort(f.openedOn)})`;
  return { errors, ok: Object.keys(errors).length === 0 };
}
