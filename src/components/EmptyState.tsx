import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, ICON_NAMES, type IconName } from './Icon';

export interface EmptyStateProps {
  /** Имя встроенной иконки или эмодзи. */
  icon?: IconName | (string & {});
  title: string;
  text?: string;
  /** Кнопка действия под текстом. */
  action?: ReactNode;
  className?: string;
}

const ICON_NAMES_SET = new Set<string>(ICON_NAMES);

/** Пустой экран: иконка, заголовок, пояснение и (необязательно) кнопка. */
export function EmptyState({ icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-3xl text-muted">
          {ICON_NAMES_SET.has(icon) ? <Icon name={icon as IconName} size={30} /> : <span aria-hidden="true">{icon}</span>}
        </div>
      )}
      <h2 className="text-lg font-bold text-text">{title}</h2>
      {text && <p className="mt-1 max-w-xs text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
