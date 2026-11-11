import type { CategoryTotal } from '@/db/queries';
import { addMinor } from '@/domain/money';
import type { Category, Minor, UUID } from '@/domain/types';

/** Чистый расчёт для блока «Расходы за месяц» (без React и базы). */

export interface SpendingRow {
  key: string;
  name: string;
  /** Значок категории (поле icon) или эмодзи для служебных строк. */
  icon: string;
  color: string | null;
  totalMinor: Minor;
  /** Доля от всех расходов месяца, целые проценты вниз. */
  percent: number;
}

type Cat = Pick<Category, 'name' | 'icon' | 'color' | 'parentId'>;

/** Корневая категория: подкатегории считаются вместе с родителем. Петля в parentId (испорченные данные) обрывается. */
function rootOf(id: UUID, categories: ReadonlyMap<string, Cat>): UUID {
  const seen = new Set<UUID>();
  let cur = id;
  for (;;) {
    seen.add(cur);
    const parent = categories.get(cur)?.parentId ?? null;
    if (parent === null || seen.has(parent) || !categories.has(parent)) return cur;
    cur = parent;
  }
}

const share = (part: Minor, total: Minor): number => (total > 0 && part > 0 ? Number((BigInt(part) * 100n) / BigInt(total)) : 0);

/**
 * Самые большие статьи расходов: категории вместе со своими подкатегориями, «Без категории» и комиссии переводов — отдельными
 * строками. От большего к меньшему, не больше `limit`. Бросает RangeError, если суммы не помещаются в безопасное целое.
 */
export function topSpending(byCategory: readonly CategoryTotal[], categories: ReadonlyMap<string, Cat>, limit: number): SpendingRow[] {
  const sums = new Map<string, Minor>();
  let total = 0;
  for (const row of byCategory) {
    const key = row.kind === 'fee' ? 'fee' : row.categoryId === null ? 'none' : rootOf(row.categoryId, categories);
    sums.set(key, addMinor(sums.get(key) ?? 0, row.totalMinor));
    total = addMinor(total, row.totalMinor);
  }
  return [...sums]
    .filter(([, minor]) => minor > 0)
    .sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : 1))
    .slice(0, limit)
    .map(([key, totalMinor]) => {
      const cat = categories.get(key);
      const percent = share(totalMinor, total);
      if (key === 'fee') return { key, name: 'Комиссии', icon: '💸', color: null, totalMinor, percent };
      return { key, name: cat?.name ?? 'Без категории', icon: cat?.icon ?? '🏷️', color: cat?.color ?? null, totalMinor, percent };
    });
}
