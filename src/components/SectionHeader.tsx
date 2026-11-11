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

/** Подзаголовок группы на странице (h2): один размер и отступ для «Ещё» и Настроек. Вид задаёт класс section-title (src/styles/look.css): у «Классики (прежней)» он мелкий и прописными. */
export function SectionHeader({ id, children, action, className }: SectionHeaderProps) {
  return (
    <div className={cn('mb-2.5 flex items-center justify-between gap-3 px-1', className)}>
      <h2 id={id} className="section-title">
        {children}
      </h2>
      {action}
    </div>
  );
}
