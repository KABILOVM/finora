import type { FilterField, FilterValues } from '@/components/filters/filterState';
import { valueOf } from '@/components/filters/filterState';
import type { CurrencyCode, Wallet } from '@/domain/types';
import { WALLET_KINDS, WALLET_KIND_LABELS } from './walletUi';

/** Фильтры списка кошельков (чистая логика): по виду и по валюте. «Всего» вверху от фильтра не зависит. */

type FilterableWallet = Pick<Wallet, 'kind' | 'currency'>;

/**
 * Поля фильтра под нынешние кошельки: виды и валюты только те, что есть; поле, где выбирать не из чего (один вид, одна валюта),
 * не показывается. Валюты: основная первой, остальные по алфавиту.
 */
export function walletFilterFields(wallets: readonly FilterableWallet[], base?: CurrencyCode): FilterField[] {
  const kinds = WALLET_KINDS.filter((k) => wallets.some((w) => w.kind === k));
  const currencies = [...new Set(wallets.map((w) => w.currency))].sort((a, b) => Number(b === base) - Number(a === base) || a.localeCompare(b));
  const fields: FilterField[] = [];
  if (kinds.length > 1) fields.push({ key: 'kind', label: 'Вид кошелька', type: 'chips', anyLabel: 'Все виды', options: kinds.map((k) => ({ value: k, label: WALLET_KIND_LABELS[k] })) });
  if (currencies.length > 1) fields.push({ key: 'currency', label: 'Валюта', type: 'chips', anyLabel: 'Все валюты', options: currencies.map((c) => ({ value: c, label: c })) });
  return fields;
}

/** Кошельки, подходящие под выбор. Пустой выбор — все; порядок сохраняется. */
export function filterWallets<T extends FilterableWallet>(wallets: readonly T[], values: FilterValues): T[] {
  const kind = valueOf(values, 'kind');
  const currency = valueOf(values, 'currency');
  return wallets.filter((w) => (kind === '' || w.kind === kind) && (currency === '' || w.currency === currency));
}
