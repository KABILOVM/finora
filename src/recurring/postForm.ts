import type { FromRuleOptions } from '@/db';
import type { CurrencyCode, Minor, RecurringRule, Wallet } from '@/domain/types';
import { errorField, NOTE_MAX } from '@/features/transactions/txForm';
import type { FxView, ReceivedView } from '@/features/transactions/useTxFormController';
import { needsFx, resolveFxInput } from './fx';
import { receivedAmount } from './received';

/**
 * Окно «Провести платёж»: чистая логика формы (без React и без базы). Человек может поменять сумму и заметку до подтверждения;
 * дата — всегда дата из расписания (от неё зависит id операции, поэтому её менять нельзя).
 */

export interface PostFormState {
  amountMinor: Minor | null;
  /** Перевод: «Получено», как ввёл человек. undefined — не трогал (считается само), null — стёр. */
  receivedOverride: Minor | null | undefined;
  /** Перевод в одной валюте: открыто ли поле «Получено» (комиссия). */
  feeOpen: boolean;
  note: string;
  /** Причина, почему сумма отличается от обычной (нужна доходу, см. reasonRequired): уходит в заметку операции. */
  reason: string;
  /** Курс, как набрал человек (когда курса нет совсем или он поправил введённый ранее). */
  rateText: string;
}

export interface PostErrors {
  amount?: string;
  toAmount?: string;
  note?: string;
  reason?: string;
  rate?: string;
  form?: string;
}

/**
 * Регулярный доход (зарплата) обычно приходит одной и той же суммой. Пришло другое — просим сказать почему («премия», «больничный»):
 * через месяц по одной цифре не вспомнить. Платёж по долгу не в счёт: его сумма сама подгоняется под остаток долга.
 */
export function reasonRequired(rule: Pick<RecurringRule, 'kind' | 'amountMinor' | 'debtId'>, amount: Minor | null): boolean {
  return rule.kind === 'income' && rule.debtId === null && amount !== null && amount > 0 && amount !== rule.amountMinor;
}

/** Заметка операции с причиной: «Зарплата (премия)»; заметки нет — одна причина. */
export function noteWithReason(note: string, reason: string): string {
  const n = note.trim();
  const r = reason.trim();
  return n === '' ? r : `${n} (${r})`;
}

/** Форма, заполненная из правила: сумма, заметка, у перевода — сумма зачисления из правила (с комиссией, если она была). */
export function initialPostForm(
  rule: Pick<RecurringRule, 'kind' | 'amountMinor' | 'toAmountMinor' | 'note'>,
  walletCurrency: CurrencyCode | undefined,
  toWalletCurrency: CurrencyCode | undefined,
): PostFormState {
  const transfer = rule.kind === 'transfer';
  return {
    amountMinor: rule.amountMinor,
    receivedOverride: transfer ? rule.toAmountMinor : undefined,
    feeOpen:
      transfer &&
      walletCurrency !== undefined &&
      walletCurrency === toWalletCurrency &&
      rule.toAmountMinor !== null &&
      rule.toAmountMinor !== rule.amountMinor,
    note: rule.note,
    reason: '',
    rateText: '',
  };
}

export type PreparedPost =
  | {
      ok: true;
      /** Готово для transactions.createFromRule(rule.id, date, opts). Пусто — платёж ровно такой, как в правиле. */
      opts: FromRuleOptions;
      /** Курс, набранный руками, — запомнить после успешной записи. */
      typedRate?: { from: CurrencyCode; to: CurrencyCode; rate: number };
    }
  | { ok: false; errors: PostErrors };

export interface PrepareArgs {
  rule: Pick<RecurringRule, 'kind' | 'amountMinor' | 'toAmountMinor' | 'note' | 'debtId'>;
  form: PostFormState;
  wallet: Pick<Wallet, 'currency'> | undefined;
  toWallet: Pick<Wallet, 'currency'> | null | undefined;
  base: CurrencyCode;
  received: ReceivedView | null;
  /** Откуда курс для этих сумм (computeFx снаружи: он зависит от суммы и кошельков). */
  fx: FxView;
}

/** Нужен ли курс при ТЕКУЩИХ суммах формы. */
export function postNeedsFx(
  rule: Pick<RecurringRule, 'kind'>,
  form: Pick<PostFormState, 'amountMinor'>,
  toAmount: Minor | null,
  wallet: Pick<Wallet, 'currency'> | undefined,
  toWallet: Pick<Wallet, 'currency'> | null | undefined,
  base: CurrencyCode,
): boolean {
  return needsFx({ kind: rule.kind, amountMinor: form.amountMinor ?? 0, toAmountMinor: toAmount }, wallet, toWallet, base);
}

/** Проверяет форму и собирает параметры для createFromRule: только то, что человек действительно изменил. */
export function preparePost(a: PrepareArgs): PreparedPost {
  const { rule, form } = a;
  const errors: PostErrors = {};
  const amount = form.amountMinor;
  if (amount === null) errors.amount = 'Введите сумму';
  else if (amount <= 0) errors.amount = 'Сумма должна быть больше нуля';

  const baseNote = form.note.trim();
  if (baseNote.length > NOTE_MAX) errors.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${baseNote.length})`;

  let note = baseNote;
  if (reasonRequired(rule, amount)) {
    const reason = form.reason.trim();
    if (reason === '') errors.reason = 'Укажите причину, почему сумма изменилась';
    else {
      note = noteWithReason(baseNote, reason);
      if (!errors.note && note.length > NOTE_MAX) errors.reason = `Заметка вместе с причиной не длиннее ${NOTE_MAX} символов (сейчас ${note.length})`;
    }
  }

  let toAmount: Minor | null = null;
  if (rule.kind === 'transfer') {
    const r = receivedAmount(a.received, amount);
    toAmount = r.toAmount;
    if (r.error) errors.toAmount = r.error;
  }

  const fxInput = resolveFxInput(a.fx, form.rateText);
  if (fxInput.error) errors.rate = fxInput.error;

  if (Object.keys(errors).length > 0 || amount === null) return { ok: false, errors };

  const opts: FromRuleOptions = {};
  const amountChanged = amount !== rule.amountMinor;
  if (amountChanged) opts.amountMinor = amount;
  if (form.note !== rule.note || note !== baseNote) opts.note = note;
  if (rule.kind === 'transfer' && toAmount !== null && (amountChanged || toAmount !== rule.toAmountMinor)) {
    opts.toAmountMinor = toAmount;
  }
  if (fxInput.fx) opts.fx = fxInput.fx;
  return { ok: true, opts, ...(fxInput.typed ? { typedRate: fxInput.typed } : {}) };
}

/** К какому полю окна относится сообщение репозитория; неясно — к форме целиком (оно не должно потеряться). */
export function postErrorField(message: string, hasToAmount: boolean): keyof PostErrors {
  const f = errorField(message, (field) => field === 'amount' || field === 'note' || field === 'rate' || (hasToAmount && field === 'toAmount'));
  return f === 'amount' || f === 'note' || f === 'rate' || f === 'toAmount' ? f : 'form';
}
