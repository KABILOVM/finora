import { Badge } from '@/components/Badge';
import { cn } from '@/lib/cn';

export interface DebtCategoryBadgesProps {
  /** Категории без повторов и пустых (debtCategoriesOf). Нет ни одной — ничего не рисуем. */
  categories: readonly string[];
  className?: string;
}

/**
 * Категория долга значком: в строке списка и на карточках. У объединённого долга их может быть несколько — показываем две,
 * остальные числом («+1»), чтобы строка не росла. Длинное название обрезается, полное — в подсказке.
 */
export function DebtCategoryBadges({ categories, className }: DebtCategoryBadgesProps) {
  if (categories.length === 0) return null;
  const shown = categories.slice(0, 2);
  const rest = categories.length - shown.length;
  return (
    <>
      {shown.map((c, i) => (
        <Badge key={c} tone="brand" title={c} className={cn('max-w-[10rem] overflow-hidden', className)} data-testid="debt-category">
          {i === 0 && <span className="sr-only">Категория: </span>}
          <span className="truncate">{c}</span>
        </Badge>
      ))}
      {rest > 0 && (
        <Badge tone="brand" title={categories.slice(2).join(', ')} className={className} data-testid="debt-category-more">
          +{rest}
        </Badge>
      )}
    </>
  );
}
