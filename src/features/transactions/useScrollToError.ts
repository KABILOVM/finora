import { useEffect, type RefObject } from 'react';
import type { FormErrors } from './txForm';

/**
 * Показалась ошибка у поля, которое может быть ниже клавиатуры (заметка, «Получено») — прокручиваем к ней,
 * чтобы нажатие «Сохранить» никогда не выглядело как «ничего не произошло».
 */
export function useScrollToError(ref: RefObject<HTMLElement | null>, errors: FormErrors): void {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const alert = ref.current?.querySelector('[role="alert"]');
    // в тестовой среде (jsdom) scrollIntoView нет
    alert?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [ref, errors]);
}
