import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { Button } from './Button';
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
  /** Кнопка в шапке справа от заголовка (перед «×»), например выбор даты. */
  headerAction?: ReactNode;
  /**
   * 'auto' — снизу на телефоне и по центру на ПК/планшете (≥768px); 'center' — всегда по центру.
   * Эталонный размер: до 92% высоты экрана, прокручивается внутри.
   */
  placement?: 'auto' | 'center';
  /** 'alertdialog' — для подтверждений опасных действий. */
  role?: 'dialog' | 'alertdialog';
  /** Не закрывать по тапу на фон и Esc (например, пока идёт сохранение). */
  dismissible?: boolean;
  /**
   * В окне есть несохранённый ввод: закрытие (×, Esc, фон, «Назад») сначала спрашивает «Закрыть без сохранения?».
   * «Назад» спрашивает только у окон с history (по умолчанию); у окон в адресе (history: false) «Назад» уводит роутер.
   * Сохранение и «Отмена» внутри окна зовут onClose сами и вопроса не вызывают.
   */
  isDirty?: boolean;
  /** Подпись кнопки «×» для скринридера (по умолчанию «Закрыть»). */
  closeLabel?: string;
  /** «Назад» (жест, кнопка браузера) закрывает окно. Выключают у окон, которые живут в адресе (/add, /edit/:id). */
  history?: boolean;
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
  headerAction,
  placement = 'auto',
  role = 'dialog',
  dismissible = true,
  isDirty = false,
  closeLabel = 'Закрыть',
  history = true,
  className,
}: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);

  // Закрыли иначе (после сохранения родитель убрал окно) — вопрос не должен пережить окно и всплыть при следующем открытии.
  useEffect(() => {
    if (!open) setAsking(false);
  }, [open]);

  // Все способы закрыть окно «от человека» идут сюда: с несохранённым вводом сначала вопрос.
  const requestClose = () => {
    if (!dismissible) return;
    if (isDirty) setAsking(true);
    else onClose();
  };

  // Экранная клавиатура на iPhone НЕ уменьшает страницу, а ложится поверх неё и закрывает низ окна (поля и кнопки).
  // Подгоняем подложку под видимую часть экрана (visualViewport): окно «поднимается» над клавиатурой и остаётся целиком на виду.
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    const el = overlayRef.current;
    if (!open || !vv || !el) return;
    const fit = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      if (covered > 80) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.bottom = 'auto';
        el.style.height = `${vv.height}px`;
        // поле ввода, оказавшееся под клавиатурой, — в видимую часть окна
        const active = document.activeElement;
        if (active instanceof HTMLElement && el.contains(active)) active.scrollIntoView?.({ block: 'nearest' });
      } else {
        el.style.top = '';
        el.style.bottom = '';
        el.style.height = '';
      }
    };
    fit();
    // На iPhone клавиатура выезжает с анимацией, а события visualViewport приходят не всегда вовремя (особенно в приложении
    // «на экране Домой»): пересчитываем ещё и при фокусе поля и чуть позже, когда клавиатура уже встала на место.
    const timers = new Set<number>();
    const refit = () => {
      fit();
      for (const ms of [120, 350, 700]) {
        const id = window.setTimeout(() => {
          timers.delete(id);
          fit();
        }, ms);
        timers.add(id);
      }
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    el.addEventListener('focusin', refit);
    el.addEventListener('focusout', refit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      el.removeEventListener('focusin', refit);
      el.removeEventListener('focusout', refit);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [open]);

  useModal({ open, onClose: requestClose, panelRef, initialFocusRoot: bodyRef, history });

  if (!open) return null;

  const centered = placement === 'center';

  const sheet = createPortal(
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex justify-center bg-black/50 animate-fade-in',
        centered ? 'items-center p-4' : 'items-end md:items-center md:p-4',
      )}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Закрываем только если и нажатие, и отпускание были на фоне (выделение текста в шите не закрывает его).
        if (downOnBackdrop.current && e.target === e.currentTarget) requestClose();
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
          'flex max-h-[92%] w-full flex-col bg-surface text-text shadow-sheet outline-none',
          centered ? 'max-w-md rounded-2xl animate-pop-in' : 'rounded-t-3xl animate-sheet-up md:max-w-lg md:rounded-2xl md:animate-pop-in',
          className,
        )}
      >
        {!centered && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong/50 md:hidden" aria-hidden="true" />}
        <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-3">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-bold">
            {title}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            {headerAction}
            {dismissible && <IconButton icon="close" label={closeLabel} onClick={requestClose} className="-mr-2" />}
          </div>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {children}
        </div>
        {footer && <div className="border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
        {!footer && <div className="pb-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );

  if (!asking) return sheet;
  return (
    <>
      {sheet}
      <Sheet
        open
        onClose={() => setAsking(false)}
        title="Закрыть без сохранения?"
        closeLabel="Не закрывать"
        placement="center"
        role="alertdialog"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setAsking(false)} data-autofocus>
              Остаться
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setAsking(false);
                onClose();
              }}
            >
              Закрыть
            </Button>
          </div>
        }
      >
        <p className="text-muted">Введённое пропадёт.</p>
      </Sheet>
    </>
  );
}
