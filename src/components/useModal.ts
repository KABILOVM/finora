import { useEffect, useRef, type RefObject } from 'react';

/**
 * Общее поведение модальных окон: Esc, фокус-ловушка, возврат фокуса, блокировка прокрутки фона.
 * Окна могут накладываться (диалог подтверждения поверх шита): Esc и Tab обрабатывает только верхнее.
 */

// Только то, до чего доходит Tab: элементы с tabindex="-1" (невыбранные сегменты в Segmented) не считаются,
// иначе «последним» окажется элемент, на который Tab никогда не попадает, и фокус выскочит за окно.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(', ');

const stack: symbol[] = [];

let lockCount = 0;
let savedStyles: { overflow: string; paddingRight: string } | null = null;

function lockScroll() {
  if (lockCount++ > 0) return;
  const body = document.body;
  savedStyles = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
  // Полоса прокрутки на ПК исчезает вместе с overflow:hidden — компенсируем, чтобы страница не «прыгала».
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  body.style.overflow = 'hidden';
}

function unlockScroll() {
  if (lockCount === 0) return;
  if (--lockCount > 0) return;
  if (savedStyles) {
    document.body.style.overflow = savedStyles.overflow;
    document.body.style.paddingRight = savedStyles.paddingRight;
    savedStyles = null;
  }
}

function focusables(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden'));
}

export interface UseModalOptions {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** Откуда искать первый элемент для фокуса (по умолчанию — вся панель). */
  initialFocusRoot?: RefObject<HTMLElement | null>;
}

export function useModal({ open, onClose, panelRef, initialFocusRoot }: UseModalOptions): void {
  // onClose храним в ref: смена колбэка между рендерами не должна перезапускать эффект
  // (иначе при каждом рендере фокус «возвращался» бы на кнопку-открывашку).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('modal');
    stack.push(token);
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockScroll();

    const panel = panelRef.current;
    if (panel) {
      const explicit = panel.querySelector<HTMLElement>('[data-autofocus]');
      const root = initialFocusRoot?.current ?? panel;
      // Нет полей ввода — фокус на саму панель (скринридер прочтёт название окна), а не на «×».
      const target = explicit ?? focusables(root)[0] ?? panel;
      target.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const p = panelRef.current;
      if (!p) return;
      const items = focusables(p);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        p.focus();
        return;
      }
      const active = document.activeElement;
      if (!p.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === p)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      // Возвращаем фокус туда, откуда окно открыли (если элемент ещё на странице).
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
    // panelRef/initialFocusRoot — стабильные ref-объекты.
  }, [open]);
}
