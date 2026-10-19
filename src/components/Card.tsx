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
      // Без backdrop-blur: размытие каждой карточки поверх анимированного фона дорого на слабых телефонах. Размытие оставлено там,
      // где под панелью прокручивается содержимое (нижняя панель, липкая шапка).
      className={cn('rounded-card border border-border/70 bg-surface/85 shadow-card', PADDING[padding], className)}
      {...rest}
    />
  );
}
