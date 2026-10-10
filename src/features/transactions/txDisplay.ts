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
  /** Перевод между разными валютами: «→ 1 090 с.» */
  second: string | null;
}

type TxLike = Pick<
  Transaction,
  'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'amountMinor' | 'toAmountMinor' | 'note' | 'baseCurrency'
>;

const HEX = /^#[0-9a-f]{6}$/i;
export const MISSING_WALLET = 'Кошелёк удалён';

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
    return {
      icon: '↔️',
      color: null,
      title: `${wallet?.name ?? MISSING_WALLET} → ${to?.name ?? MISSING_WALLET}`,
      subtitle: note,
      currency,
      signedMinor: tx.amountMinor,
      tone: 'none',
      second: crossCurrency && to && tx.toAmountMinor !== null ? `→ ${formatMinor(tx.toAmountMinor, to.currency)}` : null,
    };
  }

  const category = tx.categoryId === null ? undefined : categories.get(tx.categoryId);
  const isExpense = tx.kind === 'expense';
  return {
    icon: category?.icon ?? (isExpense ? '➖' : '➕'),
    color: category && HEX.test(category.color) ? category.color : null,
    title: category?.name ?? 'Без категории',
    subtitle: [wallet?.name ?? MISSING_WALLET, note].filter((x) => x !== '').join(' · '),
    currency,
    signedMinor: isExpense ? -tx.amountMinor : tx.amountMinor,
    tone: isExpense ? 'expense' : 'income',
    second: null,
  };
}
