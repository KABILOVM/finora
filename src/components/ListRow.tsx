import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
  /** Если задан — строка становится ссылкой на всю ширину (открывается в новой вкладке, читается как ссылка). Главнее onClick. */
  to?: string;
  /** Стрелка «›» справа (для строк-переходов). */
  chevron?: boolean;
  className?: string;
}

/**
 * Строка списка: минимум 56px высотой, вся строка — область касания.
 * Значок и название идут одной группой с читаемой минимальной шириной (min-w-[9.5rem]): если рядом с ней не помещается
 * длинная сумма (узкий телефон, «1 234 567,89 $»), сумма переносится на вторую строку справа, а не съедает название.
 */
export function ListRow({ leading, title, subtitle, trailing, onClick, to, chevron = false, className }: ListRowProps) {
  const content = (
    <>
      <div className="flex min-w-[9.5rem] flex-1 items-center gap-3">
        {leading && <div className="flex h-10 w-10 shrink-0 items-center justify-center text-xl">{leading}</div>}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-base font-medium text-text">{title}</div>
          {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
        </div>
      </div>
      {trailing && <div className="ml-auto max-w-full shrink-0 text-right">{trailing}</div>}
      {chevron && <Icon name="chevron" size={18} className="shrink-0 text-muted" />}
    </>
  );
  const base = 'flex min-h-[56px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2';
  if (to !== undefined) {
    return (
      <Link to={to} className={cn(base, 'transition-colors hover:bg-surface-2 active:bg-border/60', className)}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'transition-colors hover:bg-surface-2 active:bg-border/60', className)}>
        {content}
      </button>
    );
  }
  return <div className={cn(base, className)}>{content}</div>;
}
