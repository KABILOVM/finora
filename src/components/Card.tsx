import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Внутренний отступ. 'none' — для списков строк, которые сами тянутся до краёв. */
  padding?: 'none' | 'md' | 'lg';
}

const PADDING = { none: '', md: 'p-4', lg: 'p-5' } as const;

export function Card({ padding = 'md', className, ...rest }: CardProps) {
  return (
    <div
      className={cn('rounded-2xl border border-border bg-surface shadow-card', PADDING[padding], className)}
      {...rest}
    />
  );
}
