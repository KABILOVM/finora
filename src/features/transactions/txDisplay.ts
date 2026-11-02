import { ADJUSTMENT_NOTE, isAdjustment } from '@/domain/adjustment';
import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, Minor, Transaction, Wallet } from '@/domain/types';

/** Как операция выглядит в списке. Чистая функция: проверяется тестом без отрисовки. */
export interface TxView {
  icon: string;
  /** Цвет значка (#rrggbb) или null. */
  color: string | null;
  title: string;
  /** Кошелёк и заметка через « · ». */
  subtitle: string;
  currency: CurrencyCode;
  /** Знаковая сумма для показа: расход отрицательный, доход положительный, перевод — как есть. */
  signedMinor: Minor;
  tone: 'income' | 'expense' | 'none';
  /**
   * Вторая строка под суммой: перевод между валютами «→ 1 090 с.», комиссия, «на чеке 50 AED» (оплата картой в другой валюте)
   * или «≈ 495 с.» (трата в валюте кошелька: сколько это в основной валюте по курсу, записанному в операции).
   */
  second: string | null;
}

type TxLike = Pick<
  Transaction,
  'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'amountMinor' | 'toAmountMinor' | 'note' | 'baseCurrency'
> & {
  /** Нет поля (старые данные и тестовые заготовки) = нет долга / не по расписанию. */
  debtId?: Transaction['debtId'] | undefined;
  recurringRuleId?: Transaction['recurringRuleId'] | undefined;
  /** 'adjust' — «Корректировка остатка» (domain/adjustment.ts). */
  fxSource?: Transaction['fxSource'] | undefined;
  /** Снимок в основной валюте (для «≈ 495 с.»); нет поля (тестовые заготовки) — такой строки нет. */
  baseAmountMinor?: Transaction['baseAmountMinor'] | undefined;
  /** «Сумма на чеке» (оплата картой в другой валюте). */
  foreignCurrency?: Transaction['foreignCurrency'] | undefined;
  foreignAmountMinor?: Transaction['foreignAmountMinor'] | undefined;
};

/** Метка на строке операции: связь с долгом или с регулярным платежом. */
export interface TxTag {
  key: 'debt' | 'recurring';
  text: string;
}

export const RECURRING_TAG = 'Регулярный платёж';

/** «Долг: Алишер»; имя пока неизвестно (читается) или долга нет в базе — просто «Долг». */
export const debtTagText = (name: string | null | undefined): string => {
  const n = name?.trim() ?? '';
  return n === '' ? 'Долг' : `Долг: ${n}`;
};

/** Метки операции: по долгу и/или по расписанию. Пустой список — обычная операция. */
export function txTags(tx: Pick<TxLike, 'debtId' | 'recurringRuleId'>, debtName: string | null | undefined): TxTag[] {
  const tags: TxTag[] = [];
  if (tx.debtId) tags.push({ key: 'debt', text: debtTagText(debtName) });
  if (tx.recurringRuleId) tags.push({ key: 'recurring', text: RECURRING_TAG });
  return tags;
}

/**
 * Ставит точку в конце предложения, если её там ещё нет. Сумма в сомони «60 с.» сама кончается точкой,
 * и шаблон «${сумма}. Дальше…» давал «60 с..» — отсюда эта функция.
 */
export function endSentence(text: string): string {
  const t = text.trimEnd();
  return t === '' || /[.!?…]$/.test(t) ? t : `${t}.`;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const MISSING_WALLET = 'Кошелёк удалён';
export const ADJUSTMENT_TITLE = 'Корректировка остатка';

export function describeTx(
  tx: TxLike,
  wallets: ReadonlyMap<string, Pick<Wallet, 'name' | 'currency'>>,
  categories: ReadonlyMap<string, Pick<Category, 'name' | 'icon' | 'color'>>,
): TxView {
  const wallet = wallets.get(tx.walletId);
  const currency = wallet?.currency ?? tx.baseCurrency;
  const note = tx.note.trim();

  if (tx.kind === 'transfer') {
    const to = tx.toWalletId === null ? undefined : wallets.get(tx.toWalletId);
    const crossCurrency = to !== undefined && to.currency !== currency && tx.toAmountMinor !== null;
    // одна валюта и зачислили меньше, чем списали: разница — комиссия (расход)
    const fee =
      to !== undefined && to.currency === currency && tx.toAmountMinor !== null && tx.amountMinor > tx.toAmountMinor
        ? tx.amountMinor - tx.toAmountMinor
        : 0;
    return {
      icon: '↔️',
      color: null,
      title: `${wallet?.name ?? MISSING_WALLET} → ${to?.name ?? MISSING_WALLET}`,
      subtitle: note,
      currency,
      signedMinor: tx.amountMinor,
      tone: 'none',
      second:
        crossCurrency && to && tx.toAmountMinor !== null
          ? `→ ${formatMinor(tx.toAmountMinor, to.currency)}`
          : fee > 0
            ? `комиссия ${formatMinor(fee, currency)}`
            : null,
    };
  }

  const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
  const isExpense = tx.kind === 'expense';
  if (isAdjustment(tx)) {
    // не доход и не расход: разница с банком на дату сверки; сумма со знаком, но без «красного/зелёного»
    return {
      icon: '⚖️',
      color: null,
      title: ADJUSTMENT_TITLE,
      subtitle: [wallet?.name ?? MISSING_WALLET, note === ADJUSTMENT_NOTE ? '' : note].filter((x) => x !== '').join(' · '),
      currency,
      signedMinor: isExpense ? -tx.amountMinor : tx.amountMinor,
      tone: 'none',
      second: null,
    };
  }
  return {
    icon: category?.icon ?? (isExpense ? '➖' : '➕'),
    color: category && HEX.test(category.color) ? category.color : null,
    title: category?.name ?? 'Без категории',
    subtitle: [wallet?.name ?? MISSING_WALLET, note].filter((x) => x !== '').join(' · '),
    currency,
    signedMinor: isExpense ? -tx.amountMinor : tx.amountMinor,
    tone: isExpense ? 'expense' : 'income',
    second: secondLine(tx, wallet?.currency),
  };
}

/** Под суммой обычной операции: сумма на чеке, а у траты в валюте кошелька — сколько это в основной валюте. */
function secondLine(tx: TxLike, walletCurrency: CurrencyCode | undefined): string | null {
  const fc = tx.foreignCurrency ?? null;
  const fa = tx.foreignAmountMinor ?? null;
  if (fc !== null && fa !== null) return `на чеке ${formatMinor(fa, fc)}`;
  if (walletCurrency !== undefined && walletCurrency !== tx.baseCurrency && typeof tx.baseAmountMinor === 'number') {
    return `≈ ${formatMinor(tx.baseAmountMinor, tx.baseCurrency)}`;
  }
  return null;
}
