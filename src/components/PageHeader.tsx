import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  /** Короткое пояснение под заголовком. */
  subtitle?: string;
  /** Справа: кнопки действий. */
  actions?: ReactNode;
  className?: string;
}

/** Заголовок страницы (единственный h1 на экране). */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-3 pb-4 pt-2', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
