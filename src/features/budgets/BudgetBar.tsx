import type { BudgetLevel } from '@/domain/budgetProgress';
import { cn } from '@/lib/cn';

/** Цвета уровней. Цвет — не единственный признак: рядом всегда слова («Потрачено 78%», «Превышен на …»). */
const FILL: Record<BudgetLevel, string> = {
  ok: 'bg-gradient-to-r from-brand/70 to-brand',
  warn: 'bg-gradient-to-r from-warning/70 to-warning',
  danger: 'bg-gradient-to-r from-danger/70 to-danger',
  over: 'bg-danger',
};

export const LEVEL_TEXT: Record<BudgetLevel, string> = {
  ok: 'text-text',
  warn: 'text-warning',
  danger: 'text-danger',
  over: 'text-danger',
};

/** Штрихи на полосе превышенного лимита: отличается от «почти исчерпан» даже без цвета. */
const OVER_STRIPES = 'repeating-linear-gradient(135deg, rgb(255 255 255 / 0.45) 0 5px, transparent 5px 10px)';

export interface BudgetBarProps {
  percent: number;
  level: BudgetLevel;
  /** Подпись для скринридера: что это за полоса. */
  label: string;
  className?: string;
}

/** Полоса «потрачено от лимита»: доступная (role="progressbar"), заполнение не выходит за 100%. */
export function BudgetBar({ percent, level, label, className }: BudgetBarProps) {
  const shown = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown}
      aria-valuetext={`${percent > 999 ? 'более 999' : percent}%`}
      className={cn('relative h-3 overflow-hidden rounded-full bg-surface-2 shadow-inner', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', FILL[level])}
        style={{ width: `${percent > 0 ? Math.max(shown, 2) : 0}%`, ...(level === 'over' ? { backgroundImage: OVER_STRIPES } : {}) }}
      />
      {/* Отметки 70% и 90%: с них начинаются предупреждения. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-[70%] w-px bg-text/20" />
      <span aria-hidden="true" className="absolute inset-y-0 left-[90%] w-px bg-text/20" />
    </div>
  );
}
