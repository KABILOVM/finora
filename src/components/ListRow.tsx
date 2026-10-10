import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './Icon';

export interface ListRowProps {
  /** Слева: эмодзи/иконка в кружке и т.п. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Справа: сумма, бейдж и т.п. */
  trailing?: ReactNode;
  /** Если задан — строка становится кнопкой на всю ширину. */
  onClick?: () => void;
  /** Стрелка «›» справа (для строк-переходов). */
  chevron?: boolean;
  className?: string;
}

/** Строка списка: минимум 56px высотой, вся строка — область касания. */
export function ListRow({ leading, title, subtitle, trailing, onClick, chevron = false, className }: ListRowProps) {
  const content = (
    <>
      {leading && <div className="flex h-10 w-10 shrink-0 items-center justify-center text-xl">{leading}</div>}
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-base font-medium text-text">{title}</div>
        {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {chevron && <Icon name="chevron" size={18} className="shrink-0 text-muted" />}
    </>
  );
  const base = 'flex min-h-[56px] w-full items-center gap-3 px-4 py-2';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'transition-colors hover:bg-surface-2 active:bg-border/60', className)}>
        {content}
      </button>
    );
  }
  return <div className={cn(base, className)}>{content}</div>;
}
