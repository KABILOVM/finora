import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export type SegmentTone = 'brand' | 'income' | 'expense';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Цвет выбранного сегмента: расход — красный, доход — зелёный. */
  tone?: SegmentTone;
  /** Название для скринридера, если видимая подпись короче («%» → «Проценты»). */
  ariaLabel?: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Название группы для скринридера, например «Тип операции». */
  ariaLabel: string;
  /** Тонкий вариант для строки в 48 px: меньше отступы и шрифт, кнопки по-прежнему 44 px. */
  compact?: boolean;
  className?: string;
}

const ACTIVE: Record<SegmentTone, string> = {
  brand: 'bg-brand text-brand-fg',
  income: 'bg-income text-brand-fg',
  expense: 'bg-expense text-on-danger',
};

/** Переключатель из 2–4 вариантов (Расход / Доход / Перевод). Стрелки ←/→ переключают, Tab — выходит из группы. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, compact = false, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const n = options.length;
    const next = options[(from + delta + n) % n];
    if (!next) return;
    onChange(next.value);
    refs.current[(from + delta + n) % n]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, -1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('grid rounded-2xl bg-surface-2', compact ? 'gap-0.5 p-0.5' : 'gap-1 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.ariaLabel}
            // Roving tabindex: в группу заходим одним Tab, внутри — стрелками.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'min-h-[44px] rounded-xl font-semibold transition-colors',
              compact ? 'px-1 text-sm' : 'px-3 text-base',
              selected ? ACTIVE[opt.tone ?? 'brand'] : 'text-muted hover:text-text',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
