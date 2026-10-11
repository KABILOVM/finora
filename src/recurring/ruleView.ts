import type { Category, CurrencyCode, RecurringRule, Wallet } from '@/domain/types';
import { describeTx, type TxView } from '@/features/transactions/txDisplay';

/**
 * Как регулярный платёж выглядит в списке. Название платежа — его заметка («Аренда»); нет заметки — категория
 * (или «Кошелёк → Кошелёк» у перевода). Под названием — категория и кошелёк.
 */
export function viewRule(
  rule: Pick<RecurringRule, 'kind' | 'walletId' | 'toWalletId' | 'categoryId' | 'amountMinor' | 'toAmountMinor' | 'note'>,
  wallets: ReadonlyMap<string, Pick<Wallet, 'name' | 'currency'>>,
  categories: ReadonlyMap<string, Pick<Category, 'name' | 'icon' | 'color'>>,
  base: CurrencyCode,
): TxView {
  const v = describeTx({ ...rule, note: '', baseCurrency: base }, wallets, categories);
  const note = rule.note.trim();
  if (note === '') return v;
  return { ...v, title: note, subtitle: [v.title, v.subtitle].filter((x) => x !== '').join(' · ') };
}
