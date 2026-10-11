import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';
import { useModal } from './useModal';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок (читается скринридером как название окна). */
  title: string;
  children?: ReactNode;
  /** Закреплённая нижняя часть (кнопки действий). */
  footer?: ReactNode;
  /**
   * 'auto' — снизу на телефоне и по центру на ПК/планшете (≥768px); 'center' — всегда по центру.
   * Эталонный размер: до 92% высоты экрана, прокручивается внутри.
   */
  placement?: 'auto' | 'center';
  /** 'alertdialog' — для подтверждений опасных действий. */
  role?: 'dialog' | 'alertdialog';
  /** Не закрывать по тапу на фон и Esc (например, пока идёт сохранение). */
  dismissible?: boolean;
  className?: string;
}

/**
 * Шит: снизу на телефоне, по центру на ПК. Закрытие по Esc, тапу на фон и кнопке «×».
 * Фокус заперт внутри, фон не прокручивается, после закрытия фокус возвращается на открывшую кнопку.
 * Элемент с атрибутом data-autofocus получает фокус первым.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  placement = 'auto',
  role = 'dialog',
  dismissible = true,
  className,
}: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);

  useModal({
    open,
    onClose: () => {
      if (dismissible) onClose();
    },
    panelRef,
    initialFocusRoot: bodyRef,
  });

  if (!open) return null;

  const centered = placement === 'center';

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/50 animate-fade-in',
        centered ? 'items-center p-4' : 'items-end md:items-center md:p-4',
      )}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Закрываем только если и нажатие, и отпускание были на фоне (выделение текста в шите не закрывает его).
        if (dismissible && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex max-h-[92dvh] w-full flex-col bg-surface text-text shadow-sheet outline-none',
          centered
            ? 'max-w-md rounded-2xl animate-pop-in'
            : 'rounded-t-3xl animate-sheet-up md:max-w-lg md:rounded-2xl md:animate-pop-in',
          className,
        )}
      >
        {!centered && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong/50 md:hidden" aria-hidden="true" />}
        <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-3">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          {dismissible && <IconButton icon="close" label="Закрыть" onClick={onClose} className="-mr-2" />}
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {children}
        </div>
        {footer && (
          <div className="border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>
        )}
        {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}
