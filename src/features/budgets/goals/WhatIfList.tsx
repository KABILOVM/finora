import { useMemo, useState } from 'react';
import { ChipPicker } from '@/components/ChipPicker';
import { Glyph } from '@/components/Glyph';
import type { CategoryAdvice } from '@/domain/savingsPlan';
import { WHATIF_PERCENTS, whatIfRows } from '@/domain/savingsWhatIf';
import type { Category, CurrencyCode, LocalRow, Minor, UUID } from '@/domain/types';
import { budgetLabel } from '../budgetText';
import { whatIfLine } from './goalsText';

export interface WhatIfListProps {
  base: CurrencyCode;
  categories: ReadonlyMap<UUID, LocalRow<Category>>;
  /** Разбор плана по категориям (DayPlan.categories). */
  advice: readonly CategoryAdvice[];
  /** Сколько ещё накопить по всем активным целям. */
  remainingMinor: Minor;
  /** Сколько откладывается в месяц по плану (сумма месячной потребности активных целей). */
  monthlyNeedMinor: Minor;
}

const DEFAULT_PERCENT = 20;

/**
 * «Что если сократить»: на сколько раньше накопятся цели, если часть привычных трат необязательной категории откладывать сверх плана.
 * Сравнение — с планом (каждый месяц откладывается ровно нужное). Ничего не меняет: только показывает выгоду.
 */
export function WhatIfList({ base, categories, advice, remainingMinor, monthlyNeedMinor }: WhatIfListProps) {
  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  const rows = useMemo(() => whatIfRows(advice, percent, remainingMinor, monthlyNeedMinor), [advice, percent, remainingMinor, monthlyNeedMinor]);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Что если сократить" data-testid="goal-whatif">
      <h4 className="mb-1 px-1 text-sm font-semibold text-muted">Что если сократить траты</h4>
      <ChipPicker
        ariaLabel="На сколько процентов сократить"
        value={String(percent)}
        onChange={(v) => setPercent(Number(v))}
        options={WHATIF_PERCENTS.map((p) => ({ value: String(p), label: `−${p}%` }))}
        className="mb-2"
      />
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border/70">
        {rows.map((r) => {
          const label = budgetLabel(r.categoryId, categories);
          return (
            <li key={r.categoryId} className="flex items-center gap-3 px-4 py-2.5" data-testid="goal-whatif-row">
              <Glyph value={label.icon} color={label.color ?? undefined} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{label.name}</p>
                <p className="text-sm text-muted">{whatIfLine(r, base)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 px-1 text-xs text-muted">Если сэкономленное откладывать на цели сверх плана. Ничего не меняется, пока вы сами не переведёте деньги.</p>
    </section>
  );
}
