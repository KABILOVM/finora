import { Icon } from '@/components/Icon';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { cn } from '@/lib/cn';
import { moneyText } from './productText';
import { totalOfLines, type PurchaseLine } from './purchase';

export interface PurchasesRowProps {
  lines: readonly PurchaseLine[];
  currency: CurrencyCode;
  onOpen: () => void;
  /** Строка из продуктов недоступна (кошелёк не в основной валюте): вместо кнопки — пояснение. */
  unavailable?: string;
}

/**
 * Строка «Что куплено» в «Новой операции» (расход в «Продуктах»): необязательный вход в список продуктов.
 * Пока продуктов нет — приглашение; когда есть — их число и сумма, которая и станет суммой операции.
 */
export function PurchasesRow({ lines, currency, onOpen, unavailable }: PurchasesRowProps) {
  if (unavailable !== undefined) return <p className="px-1 text-sm text-muted">{unavailable}</p>;
  const total = totalOfLines(lines, currency);
  const has = lines.length > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={has ? `Что куплено: ${lines.length} ${pluralRu(lines.length, 'продукт', 'продукта', 'продуктов')}, изменить` : 'Что куплено: добавить продукты'}
      className={cn(
        'flex min-h-[52px] items-center gap-2.5 rounded-2xl border px-3 text-left transition-colors',
        has ? 'border-brand/50 bg-brand/10' : 'border-dashed border-border-strong bg-surface active:bg-surface-2',
      )}
    >
      <Icon name="cart" size={22} className={has ? 'text-brand' : 'text-muted'} />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">Что куплено</span>
        <span className="block truncate text-xs text-muted">
          {has ? `${lines.length} ${pluralRu(lines.length, 'продукт', 'продукта', 'продуктов')} · сумма считается по ним` : 'Необязательно · цены запомнятся'}
        </span>
      </span>
      {has && total !== null && <span className="money shrink-0 font-bold">{moneyText(total, currency)}</span>}
      <Icon name={has ? 'chevron' : 'plus'} size={18} className="shrink-0 text-muted" />
    </button>
  );
}
