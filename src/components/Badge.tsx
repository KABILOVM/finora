import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'income' | 'expense' | 'warning' | 'danger';

// Текст/фон подобраны так, что контраст ≥ 4.5:1 в обеих темах (цвет текста на 10% его же оттенка поверх фона).
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand/10 text-brand',
  income: 'bg-income/10 text-income',
  expense: 'bg-expense/10 text-expense',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
