import { Link, useLocation } from 'react-router-dom';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import type { Category, CurrencyCode, IsoDate, LocalRow } from '@/domain/types';
import { formatDayLabel } from '@/lib/dates';
import type { TopExpense } from './analytics';

export interface TopExpensesListProps {
  items: readonly TopExpense[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
  today: IsoDate;
}

/** Самые крупные расходы месяца; строка открывает правку операции поверх этого экрана. */
export function TopExpensesList({ items, categories, base, today }: TopExpensesListProps) {
  const location = useLocation();
  return (
    <ol className="flex flex-col divide-y divide-border" aria-label="Самые крупные расходы">
      {items.map((t) => {
        const cat = t.categoryId === null ? undefined : categories.get(t.categoryId);
        const note = t.note.trim();
        return (
          <li key={t.id}>
            <Link
              to={`/edit/${t.id}`}
              state={{ background: location }}
              className="flex min-h-[56px] items-center gap-3 py-2 transition-colors hover:bg-surface-2/60"
            >
              <Glyph value={cat?.icon ?? '➖'} color={cat?.color} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{note !== '' ? note : (cat?.name ?? 'Без категории')}</span>
                <span className="block truncate text-xs text-muted">
                  {formatDayLabel(t.occurredOn, today)}
                  {note !== '' && ` · ${cat?.name ?? 'Без категории'}`}
                </span>
              </span>
              <MoneyText minor={-t.amountMinor} currency={base} tone="expense" className="shrink-0 font-semibold" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
