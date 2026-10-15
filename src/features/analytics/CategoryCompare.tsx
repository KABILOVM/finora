import { Link } from 'react-router-dom';
import { Glyph } from '@/components/Glyph';
import { MoneyText } from '@/components/MoneyText';
import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, LocalRow } from '@/domain/types';
import { transactionsLink } from '@/features/transactions/txFilters';
import { pluralRu } from '@/lib/plural';
import type { CategoryDelta } from './analytics';

/** Сколько категорий показываем списком; остальные — одной строкой «ещё N». */
export const COMPARE_ROWS = 8;

/** «▲ +50%», «▼ −20%», «новая», «нет трат», «столько же». Рост расходов красный (хуже), снижение зелёное (лучше). */
export function deltaLabel(d: Pick<CategoryDelta, 'status' | 'percent'>): { text: string; tone: 'expense' | 'income' | 'muted'; aria: string } {
  const pct = d.percent;
  switch (d.status) {
    case 'new':
      return { text: 'новая', tone: 'expense', aria: 'в прошлом месяце трат не было' };
    case 'gone':
      return { text: 'нет трат', tone: 'income', aria: 'в этом месяце трат нет' };
    case 'up':
      return { text: `▲ +${pct}%`, tone: 'expense', aria: `на ${pct}% больше, чем в прошлом месяце` };
    case 'down':
      return { text: `▼ −${Math.abs(pct ?? 0)}%`, tone: 'income', aria: `на ${Math.abs(pct ?? 0)}% меньше, чем в прошлом месяце` };
    default:
      return { text: 'столько же', tone: 'muted', aria: 'как в прошлом месяце' };
  }
}

const TONE = { expense: 'text-expense', income: 'text-income', muted: 'text-muted' } as const;

export interface CategoryCompareProps {
  deltas: readonly CategoryDelta[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  base: CurrencyCode;
  month: string;
}

/** Расходы по категориям против прошлого месяца. Строка — ссылка на операции этой категории за выбранный месяц. */
export function CategoryCompare({ deltas, categories, base, month }: CategoryCompareProps) {
  const shown = deltas.slice(0, COMPARE_ROWS);
  const rest = deltas.slice(COMPARE_ROWS);
  return (
    <ul className="flex flex-col divide-y divide-border" aria-label="Расходы по категориям">
      {shown.map((d) => {
        const fee = d.kind === 'fee';
        const cat = d.categoryId === null ? undefined : categories.get(d.categoryId);
        const name = fee ? 'Комиссии' : (cat?.name ?? 'Без категории');
        const label = deltaLabel(d);
        const href = fee ? transactionsLink({ month, kind: 'transfer' }) : transactionsLink({ month, categoryId: d.categoryId, kind: 'expense' });
        return (
          <li key={d.key}>
            <Link to={href} className="flex min-h-[56px] items-center gap-3 py-2 transition-colors hover:bg-surface-2/60" data-testid={`compare-${d.key}`}>
              <Glyph value={fee ? '🏦' : (cat?.icon ?? '➖')} color={fee ? undefined : cat?.color} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{name}</span>
                <span className="block text-xs text-muted">
                  {d.previousMinor > 0 ? `В прошлом месяце ${formatMinor(d.previousMinor, base)}` : 'В прошлом месяце трат не было'}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <MoneyText minor={d.currentMinor} currency={base} tone="none" className="block font-semibold" />
                <span className={`block text-xs font-semibold ${TONE[label.tone]}`} aria-label={label.aria}>
                  {label.text}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
      {rest.length > 0 && (
        <li className="py-2 text-sm text-muted">
          ещё {rest.length} {pluralRu(rest.length, 'категория', 'категории', 'категорий')}
        </li>
      )}
    </ul>
  );
}
