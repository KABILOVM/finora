import { useMemo, useState } from 'react';
import type { TransactionInput } from '@/db';
import { convertMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Transaction, TxKind, Wallet } from '@/domain/types';
import { useRateService, useRates } from '@/rates/hooks';
import type { RateLookup } from '@/rates/types';
import {
  checkDate,
  computeFee,
  errorField,
  firstOtherWallet,
  fxSourceOf,
  NOTE_MAX,
  NO_FEE,
  parseRateText,
  resolveDate,
  type FormErrors,
  type TxFormState,
} from './txForm';

/**
 * Откуда берётся курс для операции в чужой (не базовой) валюте.
 *  - none    — курс не нужен (валюта кошелька = базовая, или перевод);
 *  - keep    — правка: прежний курс сохраняется, операцию не переоцениваем;
 *  - rate    — курс найден (свежий, устаревший, ручной или введённый ранее в операции — см. lookup);
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
  /** Показывать ли поле. Для 'cross' всегда; для 'fee' (комиссия) — только если человек её открыл. */
  show: boolean;
  /** Что сейчас в поле. Для 'fee' — сумма списания минус комиссия. */
  value: Minor | null;
  /** Что подсказывает курс (для 'fee' — сумма списания). */
  suggested: Minor | null;
  /** Курс из кошелька списания в кошелёк зачисления ('cross'). */
  lookup: RateLookup | null;
  from: CurrencyCode;
  to: CurrencyCode;
}

export interface Prepared {
  /** Готово для repo.transactions.create / update. Курс, набранный руками, лежит здесь в `fx` (source 'manual'). */
  input: TransactionInput;
  /**
   * Вызвать ПОСЛЕ успешного сохранения: запоминает курс, который человек набрал руками (или изменил), как «введённый»
   * курс пользователя. Ничего не делает, если курс не набирали. Введённый курс — отдельный запасной слой сервиса курсов:
   * он никогда не перекрывает свежий курс Нацбанка и «Свой курс», поэтому опечатка не ломает курсы навсегда.
   * Не бросает: сбой хранилища курсов не должен выглядеть как «операция не сохранилась».
   */
  rememberRate: () => void;
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
  /**
   * «Режим поездки»: курс, по которому человек обменял деньги в поездке (источник 'trip'). Для валюты с таким курсом он главнее
   * курса Нацбанка: трата записывается по тому, во сколько сомони эта валюта вам реально обошлась. Нет курса — обычный порядок.
   */
  tripLookup?: ((currency: CurrencyCode) => RateLookup | null) | undefined;
  /**
   * Предлагать ли «Сумму на чеке в другой валюте» (оплата картой в сомони за границей): в поездке и у операций из поездки.
   * Уже раскрытое поле (у операции есть сумма в валюте) показывается всегда.
   */
  foreignAvailable?: boolean | undefined;
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
  /** Комиссия в минорных единицах валюты кошелька (null — поле комиссии заполнено неверно) и итог списания. */
  fee: { minor: Minor | null; total: Minor | null };
  /** Показывать ли блок «Сумма на чеке в другой валюте» (расход/доход, а не перевод). */
  foreignAvailable: boolean;
  /** Правка существующей операции (комиссию к уже внесённому расходу не добавляем). */
  editing: boolean;
  /** Правка операции по долгу: вид не меняется (платёж и выдача считаются по-разному, репозиторий такую правку не примет). */
  kindLocked: boolean;
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
  feeOpen: ['toAmount', 'fee'],
  feeMode: ['toAmount', 'fee'],
  feeAmount: ['toAmount', 'fee'],
  feePct: ['toAmount', 'fee'],
  categoryId: ['category'],
  date: ['date'],
  note: ['note'],
  rateText: ['rate'],
  foreignOpen: ['foreign'],
  foreignCurrency: ['foreign'],
  foreignAmount: ['foreign'],
};

function computeFx(
  args: Pick<ControllerArgs, 'mode' | 'orig' | 'allWallets' | 'base' | 'tripLookup'>,
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

  const lookup = args.tripLookup?.(wallet.currency) ?? getRate(wallet.currency, base);
  return lookup
    ? { kind: 'rate', lookup, from: wallet.currency, to: base }
    : { kind: 'missing', from: wallet.currency, to: base };
}

function computeReceived(
  form: TxFormState,
  wallet: Wallet | undefined,
  toWallet: Wallet | undefined,
  getRate: (a: CurrencyCode, b: CurrencyCode) => RateLookup | null,
  fee: Minor | null,
): ReceivedView | null {
  if (form.kind !== 'transfer' || !wallet || !toWallet) return null;
  const from = wallet.currency;
  const to = toWallet.currency;
  const amount = form.amountMinor !== null && form.amountMinor > 0 ? form.amountMinor : null;
  const override = form.toAmountOverride;
  if (from === to) {
    // Комиссия задана — зачисляется сумма минус комиссия (считается сама, в том числе по проценту)
    const net = form.feeOpen && amount !== null && fee !== null ? amount - fee : amount;
    return { mode: 'fee', show: form.feeOpen, value: override !== undefined ? override : net, suggested: amount, lookup: null, from, to };
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
  const rateService = useRateService();
  const [form, setForm] = useState<TxFormState>(args.initial);
  const [errors, setErrorsState] = useState<FormErrors>({});

  const wallet = wallets.find((w) => w.id === form.walletId);
  const toWallet = form.kind === 'transfer' ? wallets.find((w) => w.id === form.toWalletId) : undefined;
  const currency = wallet?.currency ?? base;

  const { mode, orig, allWallets, tripLookup } = args;
  const fx = useMemo(
    () => computeFx({ mode, orig, allWallets, base, tripLookup }, form, wallet, getRate),
    [mode, orig, allWallets, base, tripLookup, form, wallet, getRate],
  );
  const feeBase = form.amountMinor !== null && form.amountMinor > 0 ? form.amountMinor : null;
  const feeMinor = form.feeOpen ? computeFee(form, feeBase) : 0;
  const received = useMemo(
    () => computeReceived(form, wallet, toWallet, getRate, feeMinor),
    [form, wallet, toWallet, getRate, feeMinor],
  );
  // Расход: комиссия добавляется к списанию. Перевод: вычитается из зачисления (см. received).
  const total = form.kind === 'expense' && feeMinor !== null && feeBase !== null ? feeBase + feeMinor : feeBase;

  // «Сумма на чеке» бывает у расхода и дохода; предлагается в поездке, а раскрытое поле не прячем
  const foreignShown = form.kind !== 'transfer' && (args.foreignAvailable === true || form.foreignOpen);

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

  const kindLocked = mode === 'edit' && !!orig?.debtId;

  const setKind = (kind: TxKind) => {
    if (kindLocked) return;
    setForm((f) => {
      if (f.kind === kind) return f;
      const toWalletId =
        kind === 'transfer' && (f.toWalletId === null || f.toWalletId === f.walletId)
          ? firstOtherWallet(wallets, f.walletId)
          : f.toWalletId;
      // у перевода суммы на чеке не бывает
      const noForeign = kind === 'transfer' ? { foreignOpen: false, foreignCurrency: null, foreignAmount: null } : {};
      return { ...f, kind, categoryId: null, toWalletId, toAmountOverride: undefined, ...NO_FEE, ...noForeign };
    });
    clearErrors(CLEARS.kind ?? []);
  };

  const setWallet = (id: string) => {
    setForm((f) => {
      if (f.walletId === id) return f;
      const sameTarget = f.toWalletId === id;
      // Комиссия расхода (сумма или процент) от кошелька не зависит, пока валюта та же: «Карта» → «Карта 2» её не стирает.
      // У перевода «Получено» считается по паре кошельков, поэтому там комиссия сбрасывается, как и прежде.
      const keepFee = f.kind === 'expense' && wallets.find((w) => w.id === f.walletId)?.currency === wallets.find((w) => w.id === id)?.currency;
      return {
        ...f,
        walletId: id,
        toWalletId: sameTarget ? firstOtherWallet(wallets, id) : f.toWalletId,
        // «Получено» и ручной курс относились к прежней паре кошельков
        toAmountOverride: undefined,
        ...(keepFee ? {} : NO_FEE),
        // Расход в той же валюте: набранный курс остаётся (он зависит от валюты, а не от кошелька)
        rateText: keepFee ? f.rateText : '',
        // валюта чека не может совпасть с валютой кошелька
        foreignCurrency: f.foreignCurrency !== null && f.foreignCurrency === wallets.find((w) => w.id === id)?.currency ? null : f.foreignCurrency,
      };
    });
    clearErrors(CLEARS.walletId ?? []);
  };

  const setToWallet = (id: string) => {
    setForm((f) => (f.toWalletId === id ? f : { ...f, toWalletId: id, toAmountOverride: undefined, ...NO_FEE }));
    clearErrors(CLEARS.toWalletId ?? []);
  };

  const resetForNext = () => {
    setForm((f) => ({
      ...f,
      amountMinor: null,
      categoryId: null,
      note: '',
      toAmountOverride: undefined,
      ...NO_FEE,
      rateText: '',
      // серия трат картой: валюта чека остаётся, сумма — заново
      foreignAmount: null,
    }));
    setErrorsState({});
  };

  const fieldShown = (field: keyof FormErrors): boolean => {
    switch (field) {
      case 'toWallet':
        return form.kind === 'transfer';
      case 'toAmount':
        return form.kind === 'transfer' && received !== null && received.show;
      case 'fee':
        return form.feeOpen;
      case 'category':
        return form.kind !== 'transfer';
      case 'rate':
        return fx.kind === 'missing' || (fx.kind === 'rate' && fx.lookup.entered === true);
      case 'foreign':
        return foreignShown;
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

    // Комиссия: неверный процент и «комиссия не меньше суммы» объясняются у поля комиссии
    if (form.feeOpen && (form.kind === 'expense' || (form.kind === 'transfer' && received?.mode === 'fee'))) {
      if (feeMinor === null) e.fee = 'Процент — число больше нуля и меньше 100, например 1,5';
      else if (form.kind === 'transfer' && amount !== null && feeMinor >= amount) e.fee = 'Комиссия должна быть меньше суммы перевода';
    }

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
        } else if (e.fee) {
          // сообщение уже у поля комиссии
        } else if (received.mode === 'fee' && amount !== null && toAmount > amount) {
          e.toAmount = 'Получено не может быть больше списанного: разница — это комиссия';
        }
      }
    }

    // «Сумма на чеке в другой валюте»: валюта и сумма вместе, валюта чека не совпадает с валютой кошелька
    let foreign: { currency: CurrencyCode; amountMinor: Minor } | null = null;
    // (раскрыли поле, но сумму не ввели — это не ошибка: валюта подставляется сама, и операция просто без суммы на чеке)
    if (foreignShown && form.foreignOpen && form.foreignAmount !== null) {
      if (form.foreignAmount <= 0) e.foreign = 'Сумма на чеке должна быть больше нуля';
      else if (form.foreignCurrency === null) e.foreign = 'Выберите валюту чека';
      else if (wallet && form.foreignCurrency === wallet.currency) e.foreign = `Валюта чека должна отличаться от валюты кошелька (${wallet.currency})`;
      else foreign = { currency: form.foreignCurrency, amountMinor: form.foreignAmount };
    }

    let fxInput: { rate: number; source: string } | null = null;
    // Курс, который человек набрал сам (а не взяла программа): после сохранения его запоминаем
    let typedRate: { from: CurrencyCode; to: CurrencyCode; rate: number } | null = null;
    if (fx.kind === 'rate') {
      fxInput = { rate: fx.lookup.rate, source: fxSourceOf(fx.lookup) };
      // Ранее введённый курс можно поправить прямо здесь; пустое поле = оставить как есть
      if (fx.lookup.entered === true && form.rateText.trim() !== '') {
        const rate = parseRateText(form.rateText);
        if (rate === null) e.rate = 'Курс — число больше нуля, например 10,9';
        else if (rate !== fx.lookup.rate) {
          fxInput = { rate, source: 'manual' };
          typedRate = { from: fx.from, to: fx.to, rate };
        }
      }
    } else if (fx.kind === 'missing') {
      const rate = parseRateText(form.rateText);
      if (rate === null) {
        e.rate =
          form.rateText.trim() === ''
            ? 'Курса пока нет — введите его, чтобы пересчитать сумму в основную валюту'
            : 'Курс — число больше нуля, например 10,9';
      } else {
        fxInput = { rate, source: 'manual' };
        typedRate = { from: fx.from, to: fx.to, rate };
      }
    }

    const rememberRate = (): void => {
      if (!typedRate) return;
      try {
        rateService.rememberEnteredRate(typedRate.from, typedRate.to, typedRate.rate);
      } catch (err) {
        console.error('Введённый курс не запомнен (операция сохранена):', err);
      }
    };

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
        rememberRate,
      };
    }
    return {
      rememberRate,
      input: {
        kind: form.kind,
        walletId: wallet.id,
        toWalletId: null,
        toAmountMinor: null,
        amountMinor: form.kind === 'expense' && total !== null ? total : amount,
        categoryId: form.categoryId,
        occurredOn,
        note,
        // всегда явно: в правке null очищает прежнюю сумму в валюте
        foreignCurrency: foreign?.currency ?? null,
        foreignAmountMinor: foreign?.amountMinor ?? null,
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
    fee: { minor: feeMinor, total },
    editing: mode === 'edit',
    kindLocked,
    foreignAvailable: foreignShown,
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
