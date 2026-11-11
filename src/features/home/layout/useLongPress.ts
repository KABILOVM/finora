import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** Сколько держать палец, чтобы нажатие стало долгим. */
export const LONG_PRESS_MS = 500;
/** На сколько пикселей можно сдвинуть палец: дальше это уже прокрутка, а не нажатие. */
const MOVE_LIMIT = 10;

/**
 * Долгое нажатие пальцем (или пером) внутри контейнера: возвращает обработчики для него. Мышь не считается — у неё нет «долгого
 * нажатия», а правую кнопку оставляем браузеру. Палец поехал (прокрутка), отпустили раньше или касание отменил браузер — не
 * считается. Когда нажатие сработало, отпускание пальца не должно «нажать» ссылку или кнопку под ним, а браузер — показать своё
 * меню ссылки: следующий click внутри контейнера и contextmenu гасятся.
 */
export function useLongPress(onLongPress: (target: Element) => void) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = () => {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      swallow.current = false;
      cancel();
      if (e.pointerType === 'mouse' || !(e.target instanceof Element)) return;
      const target = e.target;
      const timer = setTimeout(() => {
        press.current = null;
        swallow.current = true;
        callback.current(target);
      }, LONG_PRESS_MS);
      press.current = { timer, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_LIMIT) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (e: MouseEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: MouseEvent) => {
      if (press.current || swallow.current) e.preventDefault();
    },
  };
}
