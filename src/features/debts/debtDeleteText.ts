import { formatMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Transaction, UUID, Wallet } from '@/domain/types';
import { pluralRu } from '@/lib/plural';

export interface DeletePreview {
  count: number;
  /** Расходы и доходы по валютам кошельков (валюты операций долга обычно одна, но не обязательно). */
  expenses: Map<CurrencyCode, Minor>;
  incomes: Map<CurrencyCode, Minor>;
}

/** Что пропадёт при «Удалить долг и его операции»: только живые операции долга (расход/доход; валюта — по кошельку). */
export function previewDebtDelete(
  txs: ReadonlyMap<UUID, Pick<LocalRow<Transaction>, 'kind' | 'walletId' | 'amountMinor' | 'deletedAt'>>,
  wallets: ReadonlyMap<UUID, Pick<Wallet, 'currency'>>,
  fallback: CurrencyCode,
): DeletePreview {
  const p: DeletePreview = { count: 0, expenses: new Map(), incomes: new Map() };
  for (const t of txs.values()) {
    if (t.deletedAt !== null) continue;
    p.count += 1;
    const cur = wallets.get(t.walletId)?.currency ?? fallback;
    const bucket = t.kind === 'income' ? p.incomes : t.kind === 'expense' ? p.expenses : null;
    if (bucket) bucket.set(cur, (bucket.get(cur) ?? 0) + t.amountMinor);
  }
  return p;
}

const sums = (m: ReadonlyMap<CurrencyCode, Minor>): string => [...m].map(([c, v]) => formatMinor(v, c)).join(' и ');

export const opsCount = (n: number): string => `${n} ${pluralRu(n, 'операция', 'операции', 'операций')}`;

/** «3 операции: расходов на 400 с., доходов на 100 с.» */
export function previewText(p: DeletePreview): string {
  if (p.count === 0) return 'Операций по этому долгу нет.';
  const parts: string[] = [];
  if (p.expenses.size > 0) parts.push(`расходов на ${sums(p.expenses)}`);
  if (p.incomes.size > 0) parts.push(`доходов на ${sums(p.incomes)}`);
  return `${opsCount(p.count)}${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`;
}
