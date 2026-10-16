import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Блок плавно раскрывается и сворачивается по высоте (стили .fold в index.css). Свёрнутое содержимое недоступно ни касанию, ни
 * клавиатуре, ни скринридеру (атрибут inert).
 */
export function Collapsible({ open, children, className }: CollapsibleProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.toggleAttribute('inert', !open);
  }, [open]);
  return (
    <div ref={ref} className={cn('fold', className)} data-open={open} aria-hidden={!open}>
      <div className="fold-inner">{children}</div>
    </div>
  );
}
