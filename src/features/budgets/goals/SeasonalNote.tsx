import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { SEASON_MAX_MONTHS, monthPrepositional, type SeasonalHint } from '@/domain/seasonality';
import type { CurrencyCode } from '@/domain/types';

export interface SeasonalNoteProps {
  hints: readonly SeasonalHint[];
  base: CurrencyCode;
}

/** «52%»; запредельное превышение (больше 999 %) — «более 999%», чтобы строка не ломала вёрстку. */
export const percentText = (percent: number): string => (percent > 999 ? 'более 999%' : `${percent}%`);

/**
 * Сезонные траты: до срока цели впереди месяц, в котором год назад расходов было заметно больше обычного. Это предупреждение со ссылкой
 * на прошлый год и совет заложить запас — числа плана целей оно не меняет (domain/seasonality.ts). Нет подсказок — ничего не рисуем.
 * Суммы идут через MoneyText: «Скрыть суммы» их прячет.
 */
export function SeasonalNote({ hints, base }: SeasonalNoteProps) {
  if (hints.length === 0) return null;
  const shown = hints.slice(0, SEASON_MAX_MONTHS);
  return (
    <div role="note" data-testid="seasonal-note" className="flex items-start gap-2 rounded-2xl bg-warning/10 px-3 py-2.5 text-sm">
      <Icon name="info" size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0">
        <ul className="flex flex-col gap-1">
          {shown.map((h) => (
            <li key={h.month} data-testid="seasonal-row" data-month={h.month}>
              В {monthPrepositional(h.month)} вы обычно тратите больше: в прошлом году на {percentText(h.percent)} выше среднего (
              <MoneyText minor={h.extraMinor} currency={base} tone="none" sign="always" />
              ).
            </li>
          ))}
        </ul>
        <p className="mt-1 font-semibold">Заложите запас.</p>
        <p className="mt-0.5 text-xs text-muted">Числа плана это не меняет.</p>
      </div>
    </div>
  );
}
