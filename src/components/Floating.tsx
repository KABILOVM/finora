import { useEffect, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';

/**
 * Закрытие всплывающей панели: тап мимо (вне `boundary` — блока, где лежат и кнопка, и сама панель) и Esc.
 * Esc обрабатывается раньше шита и не даёт ему закрыться вместе с панелью.
 */
export function useDismiss(open: boolean, onClose: () => void, boundary: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = boundary.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Поверх окна с панелью открыт другой диалог (подтверждение): Esc закрывает его, а не панель под ним
      const modals = document.querySelectorAll('[aria-modal="true"]');
      const top = modals[modals.length - 1];
      if (top && boundary.current && !top.contains(boundary.current)) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    // на window в фазе перехвата: раньше слушателя шита на document, поэтому Esc не закрывает и окно
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, boundary]);
}

export interface FloatingProps {
  /** Где панель относительно ближайшего родителя с position: relative. */
  side?: 'below' | 'above';
  className?: string;
  children?: ReactNode;
}

/**
 * Всплывающая панель поверх формы: ничего не сдвигает и не удлиняет окно (в отличие от поля, которое «выезжает» в потоке).
 * Родитель обязан быть `relative`.
 */
export function Floating({ side = 'below', className, children }: FloatingProps) {
  return (
    <div
      className={cn(
        'absolute inset-x-0 z-30 rounded-2xl border border-border bg-surface p-2 shadow-float motion-safe:animate-pop-in',
        side === 'below' ? 'top-full mt-2' : 'bottom-full mb-2',
        className,
      )}
    >
      {children}
    </div>
  );
}
