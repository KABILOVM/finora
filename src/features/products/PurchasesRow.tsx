import { Icon } from '@/components/Icon';
import type { CurrencyCode } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { moneyText } from './productText';
import { totalOfLines, type PurchaseLine } from './purchase';

export interface PurchasesRowProps {
  lines: readonly PurchaseLine[];
  currency: CurrencyCode;
  onOpen: () => void;
}

/**
 * Сводка «Что куплено» в «Новой операции»: когда продукты внесены, она стоит на месте экранной клавиатуры (сумма считается по ним и
 * набирается не руками). Показывает число продуктов и сумму; нажатие открывает список для правки.
 */
export function PurchasesRow({ lines, currency, onOpen }: PurchasesRowProps) {
  const total = totalOfLines(lines, currency);
  const word = pluralRu(lines.length, 'продукт', 'продукта', 'продуктов');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Что куплено: ${lines.length} ${word}, изменить`}
      className="flex min-h-[60px] items-center gap-2.5 rounded-2xl border border-brand/50 bg-brand/10 px-3 text-left transition-colors active:bg-brand/20"
    >
      <Icon name="cart" size={22} className="text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold">Что куплено</span>
        <span className="block truncate text-xs text-muted">
          {lines.length} {word} · сумма считается по ним
        </span>
      </span>
      {total !== null && <span className="money shrink-0 font-bold">{moneyText(total, currency)}</span>}
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </button>
  );
}
