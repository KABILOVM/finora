import { useMemo, useState } from 'react';
import type { TransactionInput } from '@/db';
import { convertMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Transaction, TxKind, Wallet } from '@/domain/types';
import { useRates } from '@/rates/hooks';
import type { RateLookup } from '@/rates/types';
import {
  checkDate,
  errorField,
  firstOtherWallet,
  fxSourceOf,
  NOTE_MAX,
  parseRateText,
  resolveDate,
  type FormErrors,
  type TxFormState,
} from './txForm';

/**
 * Откуда берётся курс для операции в чужой (не базовой) валюте.
 *  - none    — курс не нужен (валюта кошелька = базовая, или перевод);
 *  - keep    — правка: прежний курс сохраняется, операцию не переоцениваем;
 *  - rate    — курс найден (свежий, устаревший или ручной — см. lookup);
 *  - missing — курса нет совсем: человек вводит его руками.
 */
export type FxView =
  | { kind: 'none' }
  | { kind: 'keep'; rate: number; source: string; from: CurrencyCode; to: CurrencyCode; recalculates: boolean }
  | { kind: 'rate'; lookup: RateLookup; from: CurrencyCode; to: CurrencyCode }
  | { kind: 'missing'; from: CurrencyCode; to: CurrencyCode };

/** Поле «Получено» у перевода. */
export interface ReceivedView {
  /** 'cross' — кошельки в разных валютах (сумму зачисления задаёт курс); 'fee' — одна валюта (разница = комиссия). */
  mode: 'cross' | 'fee';
  /** Показывать ли поле. Для 'cross' всегда; для 'fee' — только если человек открыл «Указать комиссию». */
  show: boolean;
  /** Что сейчас в поле. */
  value: Minor | null;
  /** Что подсказывает курс (для 'fee' — сумма списания). */
  suggested: Minor | null;
  /** Курс из кошелька списания в кошелёк зачисления ('cross'). */
  lookup: RateLookup | null;
  from: CurrencyCode;
  to: CurrencyCode;
}

export interface Prepared {
  /**
   * Готово для repo.transactions.create / update. Курс, набранный руками, лежит только здесь (в самой операции):
   * в сервис курсов он не попадает, иначе разовый курс (или опечатка) перекрыл бы курс Нацбанка для всех операций.
   */
  input: TransactionInput;
}

export interface ControllerArgs {
  mode: 'add' | 'edit';
  initial: TxFormState;
  /** Правка: исходная операция. */
  orig?: LocalRow<Transaction>;
  /** Кошельки, из которых можно выбирать. */
  wallets: readonly LocalRow<Wallet>[];
  /** Все кошельки, включая архивные (валюта старой операции). */
  allWallets: readonly LocalRow<Wallet>[];
  base: CurrencyCode;
}

export interface TxFormController {
  form: TxFormState;
  errors: FormErrors;
  wallet: LocalRow<Wallet> | undefined;
  toWallet: LocalRow<Wallet> | undefined;
  /** Валюта крупной суммы: валюта кошелька (для перевода — кошелька списания). */
  currency: CurrencyCode;
  base: CurrencyCode;
  fx: FxView;
  received: ReceivedView | null;
  set(patch: Partial<TxFormState>): void;
  setKind(kind: TxKind): void;
  setWallet(id: string): void;
  setToWallet(id: string): void;
  setErrors(errors: FormErrors): void;
  /** После «Сохранить и добавить ещё»: сумма, категория, заметка — заново; вид, кошелёк и дата остаются. */
  resetForNext(): void;
  /** Проверяет форму. Есть ошибки — показывает их у полей и возвращает null. */
  prepare(now?: Date): Prepared | null;
  /** Показывает сообщение репозитория у того поля, к которому оно относится (или внизу формы). */
  fail(message: string): void;
}

/** Что менялось → какие подсказки об ошибках устарели. */
const CLEARS: Partial<Record<keyof TxFormState, (keyof FormErrors)[]>> = {
  kind: ['category', 'toWallet', 'toAmount', 'rate'],
  amountMinor: ['amount', 'toAmount'],
  walletId: ['wallet', 'amount', 'toAmount', 'rate'],
  toWalletId: ['toWallet', 'toAmount'],
  toAmountOverride: ['toAmount'],
  feeOpen: ['toAmount'],
  categoryId: ['category'],
  date: ['date'],
  note: ['note'],
  rateText: ['rate'],
};

function computeFx(
  args: Pick<ControllerArgs, 'mode' | 'orig' | 'allWallets' | 'base'>,
  form: TxFormState,
  wallet: Wallet | undefined,
  getRate: (a: CurrencyCode, b: CurrencyCode) => RateLookup | null,
): FxView {
  const { mode, orig, allWallets, base } = args;
  if (!wallet || form.kind === 'transfer' || wallet.currency === base) return { kind: 'none' };

  if (mode === 'edit' && orig) {
    // Репозиторий пересчитывает снимок только при смене суммы, кошелька или вида. Иначе (и когда прежний курс
    // подходит) старая операция остаётся по курсу того дня — мы курс НЕ передаём.
    const affects = orig.kind !== form.kind || orig.walletId !== wallet.id || orig.amountMinor !== form.amountMinor;
    const oldCurrency = allWallets.find((w) => w.id === orig.walletId)?.currency;
    const hasOldRate = orig.kind !== 'transfer' && orig.fxRate !== null && orig.fxSource !== null;
    const reusable = hasOldRate && orig.baseCurrency === base && oldCurrency === wallet.currency;
    if (!affects || reusable) {
      if (hasOldRate && orig.fxRate !== null && orig.fxSource !== null) {
        return { kind: 'keep', rate: orig.fxRate, source: orig.fxSource, from: wallet.currency, to: orig.baseCurrency, recalculates: affects };
      }
      return { kind: 'none' };
    }
  }

  const lookup = getRate(wallet.currency, base);
  return lookup
    ? { kind: 'rate', lookup, from: wallet.currency, to: base }
    : { kind: 'missing', from: wallet.currency, to: base };
}

function computeReceived(
  form: TxFormState,
  wallet: Wallet | undefined,
  toWallet: Wallet | undefined,
  getRate: (a: CurrencyCode, b: CurrencyCode) => RateLookup | null,
): ReceivedView | null {
  if (form.kind !== 'transfer' || !wallet || !toWallet) return null;
  const from = wallet.currency;
  const to = toWallet.currency;
  const amount = form.amountMinor !== null && form.amountMinor > 0 ? form.amountMinor : null;
  const override = form.toAmountOverride;
  if (from === to) {
    return { mode: 'fee', show: form.feeOpen, value: override !== undefined ? override : amount, suggested: amount, lookup: null, from, to };
  }
  const lookup = getRate(from, to);
  let suggested: Minor | null = null;
  if (lookup && amount !== null) {
    try {
      suggested = convertMinor(amount, from, to, lookup.rate);
    } catch {
      suggested = null; // слишком большая сумма для пересчёта — человек введёт зачисление сам
    }
  }
  return { mode: 'cross', show: true, value: override !== undefined ? override : suggested, suggested, lookup, from, to };
}

/** Состояние и проверки формы операции. Общие для шитов «Новая операция» и «Правка операции». */
export function useTxFormController(args: ControllerArgs): TxFormController {
  const { wallets, base } = args;
  const { getRate } = useRates();
  const [form, setForm] = useState<TxFormState>(args.initial);
  const [errors, setErrorsState] = useState<FormErrors>({});

  const wallet = wallets.find((w) => w.id === form.walletId);
  const toWallet = form.kind === 'transfer' ? wallets.find((w) => w.id === form.toWalletId) : undefined;
  const currency = wallet?.currency ?? base;

  const { mode, orig, allWallets } = args;
  const fx = useMemo(
    () => computeFx({ mode, orig, allWallets, base }, form, wallet, getRate),
    [mode, orig, allWallets, base, form, wallet, getRate],
  );
  const received = useMemo(() => computeReceived(form, wallet, toWallet, getRate), [form, wallet, toWallet, getRate]);

  const clearErrors = (keys: (keyof FormErrors)[]) =>
    setErrorsState((e) => {
      const next = { ...e };
      let changed = false;
      for (const k of [...keys, 'form' as const]) {
        if (k in next) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : e;
    });

  // Правка перевода между валютами: пока человек сам не менял «Получено», оно идёт за суммой списания
  // (по курсу; нет курса — шит попросит ввести). Иначе пара «списано / получено» молча разошлась бы.
  const followsAmount = mode === 'edit' && received?.mode === 'cross';

  const set = (patch: Partial<TxFormState>) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      if (followsAmount && patch.amountMinor !== undefined && !('toAmountOverride' in patch)) {
        const original = args.initial.toAmountOverride;
        if (f.toAmountOverride === original || f.toAmountOverride === undefined) {
          // вернули прежнюю сумму — возвращается и прежнее «Получено»; иначе считаем заново
          next.toAmountOverride = patch.amountMinor === args.initial.amountMinor ? original : undefined;
        }
      }
      return next;
    });
    clearErrors((Object.keys(patch) as (keyof TxFormState)[]).flatMap((k) => CLEARS[k] ?? []));
  };

  const setKind = (kind: TxKind) => {
    setForm((f) => {
      if (f.kind === kind) return f;
      const toWalletId =
        kind === 'transfer' && (f.toWalletId === null || f.toWalletId === f.walletId)
          ? firstOtherWallet(wallets, f.walletId)
          : f.toWalletId;
      return { ...f, kind, categoryId: null, toWalletId, toAmountOverride: undefined, feeOpen: false };
    });
    clearErrors(CLEARS.kind ?? []);
  };

  const setWallet = (id: string) => {
    setForm((f) => {
      if (f.walletId === id) return f;
      const sameTarget = f.toWalletId === id;
      return {
        ...f,
        walletId: id,
        toWalletId: sameTarget ? firstOtherWallet(wallets, id) : f.toWalletId,
        // «Получено» и ручной курс относились к прежней паре кошельков
        toAmountOverride: undefined,
        feeOpen: false,
        rateText: '',
      };
    });
    clearErrors(CLEARS.walletId ?? []);
  };

  const setToWallet = (id: string) => {
    setForm((f) => (f.toWalletId === id ? f : { ...f, toWalletId: id, toAmountOverride: undefined, feeOpen: false }));
    clearErrors(CLEARS.toWalletId ?? []);
  };

  const resetForNext = () => {
    setForm((f) => ({
      ...f,
      amountMinor: null,
      categoryId: null,
      note: '',
      toAmountOverride: undefined,
      feeOpen: false,
      rateText: '',
    }));
    setErrorsState({});
  };

  const fieldShown = (field: keyof FormErrors): boolean => {
    switch (field) {
      case 'toWallet':
        return form.kind === 'transfer';
      case 'toAmount':
        return form.kind === 'transfer' && received !== null && received.show;
      case 'category':
        return form.kind !== 'transfer';
      case 'rate':
        return fx.kind === 'missing';
      default:
        return true;
    }
  };

  const fail = (message: string) => setErrorsState({ [errorField(message, fieldShown)]: message });

  const prepare = (now: Date = new Date()): Prepared | null => {
    const e: FormErrors = {};
    const amount = form.amountMinor;
    if (amount === null) e.amount = 'Введите сумму';
    else if (amount <= 0) e.amount = 'Сумма должна быть больше нуля';
    if (!wallet) e.wallet = 'Выберите кошелёк';

    const occurredOn = resolveDate(form.date, now);
    const dateError = checkDate(occurredOn);
    if (dateError) e.date = dateError;

    const note = form.note.trim();
    if (note.length > NOTE_MAX) e.note = `Заметка не длиннее ${NOTE_MAX} символов (сейчас ${note.length})`;

    let toAmount: Minor | null = null;
    if (form.kind === 'transfer') {
      if (!toWallet) e.toWallet = 'Выберите, куда переводите';
      else if (toWallet.id === wallet?.id) e.toWallet = 'Кошельки списания и зачисления должны быть разными';
      else if (received) {
        toAmount = received.mode === 'fee' && !received.show ? amount : received.value;
        if (toAmount === null) {
          e.toAmount =
            received.mode === 'cross' && !received.lookup
              ? 'Курса нет — введите, сколько денег пришло'
              : 'Укажите, сколько получено';
        } else if (toAmount <= 0) {
          e.toAmount = 'Получено должно быть больше нуля';
        } else if (received.mode === 'fee' && amount !== null && toAmount > amount) {
          e.toAmount = 'Получено не может быть больше списанного: разница — это комиссия';
        }
      }
    }

    let fxInput: { rate: number; source: string } | null = null;
    if (fx.kind === 'rate') {
      fxInput = { rate: fx.lookup.rate, source: fxSourceOf(fx.lookup) };
    } else if (fx.kind === 'missing') {
      const rate = parseRateText(form.rateText);
      if (rate === null) {
        e.rate =
          form.rateText.trim() === ''
            ? 'Курса пока нет — введите его, чтобы пересчитать сумму в основную валюту'
            : 'Курс — число больше нуля, например 10,9';
      } else {
        fxInput = { rate, source: 'manual' };
      }
    }

    if (Object.keys(e).length > 0 || amount === null || !wallet) {
      setErrorsState(e);
      return null;
    }
    setErrorsState({});

    if (form.kind === 'transfer') {
      if (!toWallet || toAmount === null) return null;
      return {
        input: {
          kind: 'transfer',
          walletId: wallet.id,
          toWalletId: toWallet.id,
          amountMinor: amount,
          toAmountMinor: toAmount,
          categoryId: null,
          occurredOn,
          note,
        },
      };
    }
    return {
      input: {
        kind: form.kind,
        walletId: wallet.id,
        toWalletId: null,
        toAmountMinor: null,
        amountMinor: amount,
        categoryId: form.categoryId,
        occurredOn,
        note,
        ...(fxInput ? { fx: fxInput } : {}),
      },
    };
  };

  return {
    form,
    errors,
    wallet,
    toWallet,
    currency,
    base,
    fx,
    received,
    set,
    setKind,
    setWallet,
    setToWallet,
    setErrors: setErrorsState,
    resetForNext,
    prepare,
    fail,
  };
}
