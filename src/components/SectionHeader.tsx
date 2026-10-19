import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionHeaderProps {
  /** id заголовка: на него ссылается aria-labelledby раздела. */
  id?: string;
  children: ReactNode;
  /** Справа: счётчик, ссылка «Все». */
  action?: ReactNode;
  className?: string;
}

/** Подзаголовок группы на странице (h2): ПРОПИСНЫМИ мелким шрифтом, один размер и отступ для «Ещё» и Настроек. */
export function SectionHeader({ id, children, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-3 px-1', className)}>
      <h2 id={id} className="text-sm font-bold uppercase tracking-wide text-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}
