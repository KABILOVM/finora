import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface FieldGroupProps {
  label: string;
  /** Короткая подсказка рядом с названием, например «можно не выбирать». */
  hint?: string;
  error?: string | null;
  /** Подпись только для скринридера: смысл группы и так ясен из места, где она открылась (например, список под чипом). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
}

/** Подпись + содержимое + сообщение об ошибке для групп чипов и составных полей. */
export function FieldGroup({ label, hint, error, hideLabel, children, className }: FieldGroupProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className={hideLabel ? 'sr-only' : 'flex items-baseline gap-2'}>
        <span className="text-sm font-semibold text-text">{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
