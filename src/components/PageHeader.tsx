import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { BackLink, type BackLinkProps } from './BackLink';

export interface PageHeaderProps {
  title: string;
  /** Короткое пояснение под заголовком. */
  subtitle?: string;
  /** Справа: кнопки действий. */
  actions?: ReactNode;
  /** Вложенный экран: «‹ Родитель» над заголовком. */
  back?: BackLinkProps;
  className?: string;
}

/** Заголовок страницы (единственный h1 на экране). */
export function PageHeader({ title, subtitle, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cn('pb-4 pt-2', className)}>
      {back && <BackLink {...back} />}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
