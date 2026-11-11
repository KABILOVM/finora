import { formatMinor } from '@/domain/money';
import type { Category, CurrencyCode, LocalRow, Minor } from '@/domain/types';
import type { CategoryDelta } from './analytics';

/** Сколько категорий показываем отдельными отрезками; остальное складывается в «Остальное». */
const MAX_PARTS = 5;
/** Цвет отрезка, если у категории цвета нет («Без категории», комиссии) или это «Остальное». */
const NEUTRAL = '#94a3b8';

interface Part {
  key: string;
  name: string;
  color: string;
  minor: Minor;
}

export interface SpendSplitBarProps {
  deltas: readonly CategoryDelta[];
  categories: ReadonlyMap<string, LocalRow<Category>>;
  /** Все расходы месяца: от них считаются доли (как у списка ниже). */
  totalMinor: Minor;
  base: CurrencyCode;
}

const nameOf = (d: CategoryDelta, categories: SpendSplitBarProps['categories']): string =>
  d.kind === 'fee' ? 'Комиссии переводов' : d.categoryId === null ? 'Без категории' : (categories.get(d.categoryId)?.name ?? 'Категория удалена');

/**
 * Тонкая полоса «как делятся расходы месяца»: до пяти самых крупных категорий своим цветом и серое «Остальное». Чисел на полосе нет:
 * названия, суммы и доли стоят в списке сразу под ней, а цвет отрезка совпадает с цветом значка категории в этом списке.
 * Для скринридера это одна картинка с подписью-перечнем; подсказка при наведении называет отрезок.
 */
export function SpendSplitBar({ deltas, categories, totalMinor, base }: SpendSplitBarProps) {
  const spent = deltas.filter((d) => d.currentMinor > 0);
  if (totalMinor <= 0 || spent.length < 2) return null;
  const top = spent.slice(0, MAX_PARTS);
  const parts: Part[] = top.map((d) => ({
    key: d.key,
    name: nameOf(d, categories),
    color: (d.categoryId !== null ? categories.get(d.categoryId)?.color : undefined) ?? NEUTRAL,
    minor: d.currentMinor,
  }));
  const restMinor = spent.slice(MAX_PARTS).reduce((sum, d) => sum + d.currentMinor, 0);
  if (restMinor > 0) parts.push({ key: 'rest', name: 'Остальное', color: NEUTRAL, minor: restMinor });
  const share = (minor: Minor): number => Math.max(1, Math.round((minor / totalMinor) * 100));
  const label = parts.map((p) => `${p.name} ${share(p.minor)}%`).join(', ');
  return (
    <div role="img" aria-label={`Доли расходов: ${label}`} data-testid="spend-split" className="mb-4 flex h-2 w-full gap-0.5">
      {parts.map((p, i) => (
        <span
          key={p.key}
          title={`${p.name}: ${formatMinor(p.minor, base)} · ${share(p.minor)}%`}
          style={{ flexGrow: p.minor, backgroundColor: p.color, '--i': i } as React.CSSProperties}
          className="split-part min-w-[3px] basis-0 rounded-full"
        />
      ))}
    </div>
  );
}
